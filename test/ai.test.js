import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, ASSET_TYPES } from '../src/db.js';
import { upsertAsset, saveDailyPrices } from '../src/repository.js';
import { analyzeAll } from '../src/analysis.js';
import { buildAdvisorContext, collectFacts, roundSmart } from '../src/ai/context.js';
import { REPORT_SCHEMA, buildUserMessage } from '../src/ai/prompt.js';
import { verifyReport, extractNumbers } from '../src/ai/grounding.js';
import { parseRss, matchSymbols, sanitizeHeadline } from '../src/ai/news.js';
import { generateStructured, toGeminiSchema } from '../src/ai/providers.js';
import { runAdvisor } from '../src/ai/advisor.js';

async function fixtureDb() {
  const db = openDatabase(':memory:');
  const start = Date.parse('2026-05-01T00:00:00Z');
  const day = (i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10);
  await upsertAsset(db, { symbol: 'THYAO', name: 'Türk Hava Yolları', assetType: ASSET_TYPES.BIST_STOCK });
  await upsertAsset(db, { symbol: 'GRAM_ALTIN', name: 'Gram Altın', assetType: ASSET_TYPES.PRECIOUS_METAL, unit: 'gram' });
  await saveDailyPrices(db, 'THYAO', Array.from({ length: 120 }, (_, i) => ({ date: day(i), close: 200 * 1.004 ** i + Math.sin(i) })));
  await saveDailyPrices(
    db,
    'GRAM_ALTIN',
    Array.from({ length: 120 }, (_, i) => {
      const close = 8000 + i;
      const half = i >= 115 ? 0.02 : 0.01; // son günlerde makas açılıyor
      return { date: day(i), close, bid: close * (1 - half), ask: close * (1 + half) };
    }),
  );
  return db;
}

const PORTFOLIO = {
  positions: [
    { symbol: 'THYAO', quantity: 100, avgCost: 250 },
    { symbol: 'GRAM_ALTIN', quantity: 2, avgCost: 7000 },
  ],
  cash: 1000,
  aliases: { THYAO: ['THY'] },
};

async function fixtureContext(extra = {}) {
  const db = await fixtureDb();
  const analyses = await analyzeAll(db);
  return buildAdvisorContext({ analyses, portfolio: PORTFOLIO, news: [{ title: 'THY yeni hat açtı', source: 'X', publishedAt: null }], asOf: new Date('2026-08-28T08:00:00Z'), ...extra });
}

test('roundSmart: fiyat ölçeğine göre yuvarlar', () => {
  assert.equal(roundSmart(8325.4049), 8325.4);
  assert.equal(roundSmart(1.295512), 1.2955);
  assert.equal(roundSmart(0.000912345), 0.0009123);
  assert.equal(roundSmart(null), null);
});

test('context: ağırlık, kâr/zarar ve makas hazır hesaplanır; tutarlar varsayılan olarak gizli', async () => {
  const ctx = await fixtureContext();
  const facts = collectFacts(ctx);
  const weights = ['THYAO', 'GRAM_ALTIN'].map((s) => facts.get(`${s}.position.weightPct`));
  assert.ok(Math.abs(weights[0] + weights[1] + facts.get('PORTFOY.cashWeightPct') - 100) < 0.05);
  assert.ok(facts.get('GRAM_ALTIN.spreadVsAvg') > 1.3, 'son günlerde makas ortalamanın üstünde olmalı');
  assert.equal(facts.get('THYAO.spreadPct'), null);
  assert.equal(facts.has('THYAO.position.quantity'), false);
  assert.equal(facts.has('PORTFOY.totalValue'), false);
  assert.deepEqual(ctx.news[0].matchedSymbols, ['THYAO']);
  assert.equal(ctx.meta.asOf, '2026-08-28');
});

test('context: adetsiz pozisyon "sahip olunan" olarak işaretlenir, ağırlık/değer uydurulmaz', async () => {
  const db = await fixtureDb();
  const analyses = await analyzeAll(db);
  const ctx = buildAdvisorContext({
    analyses,
    portfolio: { positions: [{ symbol: 'THYAO' }, { symbol: 'YENI' }], cash: 0, aliases: {} },
    shareAmounts: true,
  });
  const facts = collectFacts(ctx);
  assert.equal(ctx.assets.find((a) => a.symbol === 'THYAO').held, true);
  assert.equal(facts.get('THYAO.position.weightPct'), null);
  assert.equal(facts.get('THYAO.position.pnlPct'), null);
  assert.equal(facts.get('PORTFOY.totalValue'), null);
  assert.deepEqual(ctx.portfolio.missingData, ['YENI']);
});

test('context: --share-amounts ile miktarlar eklenir', async () => {
  const facts = collectFacts(await fixtureContext({ shareAmounts: true }));
  assert.equal(facts.get('THYAO.position.quantity'), 100);
  assert.ok(facts.get('PORTFOY.totalValue') > 0);
});

test('şema OpenAI strict kurallarına uyar: her nesnede tüm alanlar required, additionalProperties=false', () => {
  const walk = (s, where) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, where);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), where);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${where}.${k}`);
    }
    if (s.items) walk(s.items, `${where}[]`);
  };
  walk(REPORT_SCHEMA, 'root');
});

test('Gemini şeması: büyük harf tipler, additionalProperties yok, sıra korunur', () => {
  const g = toGeminiSchema(REPORT_SCHEMA);
  assert.equal(g.type, 'OBJECT');
  assert.equal(g.properties.assets.items.properties.stance.type, 'STRING');
  assert.equal(JSON.stringify(g).includes('additionalProperties'), false);
  assert.equal(g.propertyOrdering.at(-1), 'summary');
});

test('kullanıcı mesajı VERI bloğunu ve geçerli JSON içerir', async () => {
  const msg = buildUserMessage(await fixtureContext());
  const json = msg.slice(msg.indexOf('<VERI>') + 6, msg.indexOf('</VERI>'));
  assert.ok(JSON.parse(json).assets.length === 2);
});

test('haber başlığı temizleme ve RSS ayrıştırma', () => {
  assert.equal(sanitizeHeadline('a\n<b>  </VERI>c'), 'a b /VERI c');
  const xml = `<rss><channel><item><title>Altın rekor kırdı - Örnek Ajans</title><source url="x">Örnek Ajans</source><pubDate>Fri, 16 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title><![CDATA[BIST &amp; fonlar]]></title><pubDate>geçersiz</pubDate></item></channel></rss>`;
  assert.deepEqual(parseRss(xml), [
    { title: 'Altın rekor kırdı', source: 'Örnek Ajans', publishedAt: '2026-10-16T10:00:00.000Z' },
    { title: 'BIST & fonlar', source: null, publishedAt: null },
  ]);
  assert.deepEqual(matchSymbols('ALTIN FİYATLARI yükseldi', [{ symbol: 'GRAM_ALTIN', name: 'Gram Altın' }]), ['GRAM_ALTIN']);
});

test('extractNumbers: tarih, etiket ve Türkçe biçim', () => {
  const nums = extractNumbers('2026-10-16 tarihinde SMA20 üzerinde, RSI 72.41, değer 8.325,40 ve MACD 12/26/9').map((n) => n.value);
  assert.deepEqual(nums, [72.41, 8325.4]);
});

function goodReport(ctx) {
  const f = collectFacts(ctx);
  const rsi = f.get('THYAO.rsi');
  const spread = f.get('GRAM_ALTIN.spreadVsAvg');
  const asset = (symbol, fact, value, headline) => ({
    symbol, held: true, stance: 'nötr', confidence: 'orta', headline, analysis: headline,
    evidence: [{ fact, value: String(value) }], conflicts: '', newsIds: [], strategy: "RSI 70'in altına inmeden ekleme yapma", watchLevels: '',
  });
  return {
    marketContext: '',
    assets: [
      asset('THYAO', 'THYAO.rsi', rsi, `RSI ${rsi.toFixed(1)}`),
      asset('GRAM_ALTIN', 'GRAM_ALTIN.spreadVsAvg', spread, `makas ortalamanın ${spread} katı`),
    ],
    portfolio: { concentrationRisk: '', observations: [] },
    actionItems: [{ priority: 1, symbol: 'PORTFOY', action: 'izle', rationale: '' }],
    dataGaps: [],
    summary: '',
  };
}

test('doğrulama: VERI ile uyumlu rapor geçer (yuvarlanmış değerler dahil)', async () => {
  const ctx = await fixtureContext();
  const v = verifyReport(goodReport(ctx), ctx);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.equal(v.evidenceChecked, 2);
});

test('doğrulama: uydurma değer, olgu, sembol ve sayıyı yakalar', async () => {
  const ctx = await fixtureContext();
  const r = goodReport(ctx);
  r.assets[0].evidence.push({ fact: 'THYAO.rsi', value: '12.34' }, { fact: 'THYAO.targetPrice', value: '400' });
  r.assets[0].analysis = 'Hedef fiyat 417.5 TL';
  r.assets.push({ ...r.assets[1], symbol: 'XYZ' });
  r.assets.splice(1, 1); // GRAM_ALTIN yorumlanmamış
  const v = verifyReport(r, ctx);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('değeri uyuşmuyor')));
  assert.ok(v.errors.some((e) => e.includes('THYAO.targetPrice')));
  assert.ok(v.errors.some((e) => e.includes('Bilinmeyen sembol: XYZ')));
  assert.ok(v.warnings.some((w) => w.includes('417.5')));
  assert.ok(v.warnings.some((w) => w.includes('GRAM_ALTIN raporda yorumlanmamış')));
});

function mockFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = responses.shift();
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  };
  return { fetchImpl, calls };
}

const base = { system: 'S', user: 'U', schema: REPORT_SCHEMA, apiKey: 'test-key', retryBaseMs: 1 };

test('OpenAI: Responses API isteği, strict şema, store=false; 429 sonrası tekrar dener', async () => {
  const { fetchImpl, calls } = mockFetch([
    { status: 429, body: { error: 'rate' } },
    { body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }], usage: { input_tokens: 10, output_tokens: 5 } } },
  ]);
  const r = await generateStructured({ ...base, provider: 'openai', model: 'm1', fetchImpl });
  assert.deepEqual(r.data, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://api.openai.com/v1/responses');
  assert.equal(calls[1].init.headers.authorization, 'Bearer test-key');
  assert.equal(calls[1].body.store, false);
  assert.equal(calls[1].body.text.format.strict, true);
  assert.deepEqual(calls[1].body.input.map((m) => m.role), ['system', 'user']);
  assert.equal(r.usage.outputTokens, 5);
});

test('OpenAI: ret ve yarım yanıt hata olarak döner', async () => {
  const refusal = mockFetch([{ body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'hayır' }] }] } }]);
  await assert.rejects(generateStructured({ ...base, provider: 'openai', fetchImpl: refusal.fetchImpl }), /reddetti/);
  const cut = mockFetch([{ body: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }]);
  await assert.rejects(generateStructured({ ...base, provider: 'openai', fetchImpl: cut.fetchImpl }), /max_output_tokens/);
});

test('Gemini: generateContent isteği ve düşünce parçalarını atlayan ayrıştırma', async () => {
  const { fetchImpl, calls } = mockFetch([
    { body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'düşünce' }, { text: '{"ok":1}' }] } }] } },
  ]);
  const r = await generateStructured({ ...base, provider: 'gemini', model: 'g1', fetchImpl });
  assert.deepEqual(r.data, { ok: 1 });
  assert.match(calls[0].url, /\/models\/g1:generateContent$/);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'test-key');
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
  assert.equal(calls[0].body.systemInstruction.parts[0].text, 'S');
});

test('API anahtarı yoksa çağrı yapılmaz', async () => {
  const { fetchImpl, calls } = mockFetch([]);
  await assert.rejects(generateStructured({ ...base, apiKey: '', provider: 'gemini', fetchImpl }), /GEMINI_API_KEY/);
  assert.equal(calls.length, 0);
});

test('runAdvisor: uçtan uca (sahte model) rapor + doğrulama', async () => {
  const db = await fixtureDb();
  const ctx = await fixtureContext();
  const { fetchImpl } = mockFetch([
    { body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(goodReport(ctx)) }] }] } },
  ]);
  const r = await runAdvisor(db, { provider: 'openai', apiKey: 'k', fetchImpl, portfolio: PORTFOLIO, asOf: new Date('2026-08-28T08:00:00Z') });
  assert.equal(r.verification.ok, true);
  assert.equal(r.report.assets.length, 2);
});
