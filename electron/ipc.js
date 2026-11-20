// Arayüzün çağırabileceği tüm IPC kanalları. Her yanıt { ok, data } veya { ok: false, error }.
import { BrowserWindow, ipcMain } from 'electron';
import { openDatabase } from '../src/db.js';
import { analyzeAll } from '../src/analysis.js';
import { getChartData } from '../src/chart-data.js';
import { deleteAsset, getLastSyncRun } from '../src/repository.js';
import { ASSET_TYPES } from '../src/db.js';
import { normalizeCode, verifyAsset, addToWatchlist, setPosition, removeEverywhere } from '../src/user-config.js';
import { runSync } from '../src/sync.js';
import { buildAdvisorContext } from '../src/ai/context.js';
import { PROVIDERS } from '../src/ai/providers.js';
import { loadAdvisorInputs, generateAndSaveReport, loadLatestReport } from '../src/ai/service.js';

const SYMBOL_RE = /^[A-Z0-9_]{1,24}$/i;

/** Arayüzden gelen sayı: boş -> null, değilse sonlu sayı olmalı */
function optionalNumber(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} geçerli bir sayı değil`);
  return n;
}

function assertSymbol(symbol) {
  if (typeof symbol !== 'string' || !SYMBOL_RE.test(symbol)) throw new Error(`Geçersiz sembol: ${symbol}`);
  return symbol;
}

/** Arayüze gönderilecek sade senkronizasyon özeti */
function slimRun(run) {
  if (!run) return null;
  return {
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    ok: run.ok,
    results: (run.summary?.results ?? run.results ?? []).map(({ symbol, kind, ok, error, rows, latest, note }) => ({
      symbol,
      kind,
      ok,
      error,
      rows,
      latest,
      note,
    })),
  };
}

const broadcast = (channel, payload) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
};

/** Kanalları kaydeder: yalnızca uygulamanın kendi arayüzünden gelen çağrılar kabul edilir, hatalar zarfa sarılır. */
export function registerHandlers(handlers, allowedOrigin) {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args) => {
      const origin = event.senderFrame?.url ?? '';
      if (!origin.startsWith(allowedOrigin)) return { ok: false, error: 'Yetkisiz kaynak' };
      try {
        return { ok: true, data: await handler(...args) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
  }
}

export function registerIpc({ allowedOrigin }) {
  const db = openDatabase();
  let generating = null; // aynı anda tek rapor üretimi
  let syncing = null; // aynı anda tek senkronizasyon

  /** Senkronizasyonu başlatır; zaten çalışıyorsa aynı işi bekler. */
  const syncNow = (trigger) => {
    syncing ??= (async () => {
      broadcast('sync:event', { type: 'started', trigger });
      try {
        const result = await runSync(db, { log: (message) => broadcast('sync:event', { type: 'log', message }) });
        broadcast('sync:event', { type: 'finished', run: slimRun(result) });
        return result;
      } catch (err) {
        broadcast('sync:event', { type: 'failed', error: err.message });
        throw err;
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  };

  const handlers = {
    // Watchlist + üst bar: AI'a giden VERI ile aynı hesaplar (tutarlar lokal olduğu için dahil).
    'dashboard:overview': async () => {
      const [{ portfolio }, analyses] = await Promise.all([loadAdvisorInputs(), analyzeAll(db)]);
      const context = buildAdvisorContext({ analyses, portfolio, shareAmounts: true });
      return { meta: context.meta, portfolio: context.portfolio, assets: context.assets };
    },

    'chart:get': (symbol, { bars = 250 } = {}) =>
      getChartData(db, assertSymbol(symbol), { bars: Math.min(Math.max(Number(bars) || 250, 30), 2000) }),

    'report:latest': () => loadLatestReport(),

    'report:generate': async ({ provider = process.env.AI_PROVIDER ?? 'openai', rss = true } = {}) => {
      if (!PROVIDERS[provider]) throw new Error(`Bilinmeyen sağlayıcı: ${provider}`);
      if (generating) throw new Error('Bir rapor zaten üretiliyor');
      generating = (async () => {
        const { portfolio, news } = await loadAdvisorInputs({ rss: Boolean(rss) });
        await generateAndSaveReport(db, { provider, portfolio, news });
        return loadLatestReport();
      })();
      try {
        return await generating;
      } finally {
        generating = null;
      }
    },

    'sync:status': async () => ({ running: Boolean(syncing), last: slimRun(await getLastSyncRun(db)) }),

    'sync:run': async () => slimRun(await syncNow('manual')),

    // Yeni varlık: kod biçimi ve kaynakta varlığı doğrulanır, sonra listeye yazılır ve
    // geçmişi indirmek için güncelleme başlatılır (beklenmez; ilerleme sync olaylarıyla gelir).
    'assets:add': async ({ type, symbol, name, held = false, quantity, avgCost } = {}) => {
      if (!Object.values(ASSET_TYPES).includes(type)) throw new Error('Geçersiz varlık türü');
      const code = normalizeCode(type, symbol);
      const sourceName = await verifyAsset(type, code);
      const displayName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : undefined;
      await addToWatchlist({ type, symbol: code, name: displayName });
      if (held) await setPosition({ symbol: code, held: true, quantity: optionalNumber(quantity, 'Adet'), avgCost: optionalNumber(avgCost, 'Maliyet') });
      syncNow('add').catch(() => {});
      return { symbol: code, name: displayName ?? sourceName ?? code };
    },

    'position:save': async ({ symbol, held, quantity, avgCost } = {}) => {
      await setPosition({
        symbol: assertSymbol(symbol).toUpperCase(),
        held: Boolean(held),
        quantity: optionalNumber(quantity, 'Adet'),
        avgCost: optionalNumber(avgCost, 'Maliyet'),
      });
      return true;
    },

    'assets:remove': async (symbol) => {
      const code = assertSymbol(symbol).toUpperCase();
      await removeEverywhere(code);
      await deleteAsset(db, code);
      return true;
    },
  };

  registerHandlers(handlers, allowedOrigin);

  /**
   * Arka plan güncelleme döngüsü: açılışta veri `intervalMinutes`'tan eskiyse hemen,
   * sonra her `intervalMinutes` dakikada bir. 0 = kapalı.
   */
  function startSyncLoop(intervalMinutes) {
    if (!(intervalMinutes > 0)) return () => {};
    const intervalMs = intervalMinutes * 60_000;
    const tick = (trigger) => syncNow(trigger).catch(() => {}); // hata zaten arayüze yayınlandı
    getLastSyncRun(db).then((last) => {
      const age = last ? Date.now() - Date.parse(last.finishedAt) : Infinity;
      if (age >= intervalMs) setTimeout(() => tick('startup'), 1_500); // pencere açılsın, sonra
    });
    const timer = setInterval(() => tick('schedule'), intervalMs);
    return () => clearInterval(timer);
  }

  return { startSyncLoop, db };
}
