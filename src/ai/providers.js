// OpenAI (Responses API) ve Gemini (generateContent) için şemaya bağlı JSON üretimi.
// SDK yerine doğrudan fetch kullanılır; ikisi de aynı { data, text, usage } biçimini döner.
import { setTimeout as sleep } from 'node:timers/promises';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class ProviderError extends Error {
  constructor(message, { status, provider } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.provider = provider;
  }
}

async function postJson(url, { headers, body, provider, fetchImpl, timeoutMs, retries, retryBaseMs }) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < retries) {
        await sleep(retryBaseMs * 2 ** attempt);
        continue;
      }
      throw new ProviderError(`${provider} bağlantı hatası: ${err.message}`, { provider });
    }
    if (res.ok) return res.json();

    const detail = (await res.text()).slice(0, 800);
    if (attempt < retries && RETRYABLE_STATUS.has(res.status)) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : retryBaseMs * 2 ** attempt);
      continue;
    }
    throw new ProviderError(`${provider} HTTP ${res.status}: ${detail}`, { status: res.status, provider });
  }
}

function parseJsonText(text, provider) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new ProviderError(`${provider} geçerli JSON döndürmedi: ${cleaned.slice(0, 200)}`, { provider });
  }
}

// --- OpenAI -----------------------------------------------------------------

export function buildOpenAIRequest({ model, system, user, schema, schemaName, maxOutputTokens }) {
  return {
    model,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
    max_output_tokens: maxOutputTokens,
    store: false, // portföy verisi OpenAI tarafında yanıt geçmişinde saklanmasın
  };
}

export function parseOpenAIResponse(json) {
  if (json.status === 'incomplete') {
    throw new ProviderError(`openai yanıtı yarıda kesildi: ${json.incomplete_details?.reason ?? 'bilinmiyor'}`, { provider: 'openai' });
  }
  const parts = (json.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
  const refusal = parts.find((p) => p.type === 'refusal');
  if (refusal) throw new ProviderError(`openai isteği reddetti: ${refusal.refusal}`, { provider: 'openai' });
  const text = parts.filter((p) => p.type === 'output_text').map((p) => p.text).join('');
  if (!text) throw new ProviderError('openai boş yanıt döndürdü', { provider: 'openai' });
  return {
    text,
    usage: { inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens },
  };
}

// --- Gemini -----------------------------------------------------------------

/**
 * Gemini responseSchema, JSON Schema'nın OpenAPI alt kümesini kullanır:
 * tip adları büyük harf, additionalProperties desteklenmez. Alan sırası propertyOrdering ile korunur.
 */
export function toGeminiSchema(schema) {
  const out = { type: schema.type.toUpperCase() };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
    out.propertyOrdering = Object.keys(schema.properties);
    out.required = schema.required;
  }
  return out;
}

export function buildGeminiRequest({ system, user, schema, maxOutputTokens }) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(schema),
      maxOutputTokens,
    },
  };
}

export function parseGeminiResponse(json) {
  if (json.promptFeedback?.blockReason) {
    throw new ProviderError(`gemini isteği engelledi: ${json.promptFeedback.blockReason}`, { provider: 'gemini' });
  }
  const candidate = json.candidates?.[0];
  if (!candidate) throw new ProviderError('gemini aday yanıt döndürmedi', { provider: 'gemini' });
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new ProviderError(`gemini yanıtı tamamlanmadı: ${candidate.finishReason}`, { provider: 'gemini' });
  }
  const text = (candidate.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('');
  return {
    text,
    usage: {
      inputTokens: json.usageMetadata?.promptTokenCount,
      outputTokens: json.usageMetadata?.candidatesTokenCount,
    },
  };
}

// --- Ortak giriş noktası -------------------------------------------------------

export const PROVIDERS = {
  openai: {
    apiKeyEnv: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL',
    defaultModel: 'gpt-6.1-sol',
    async call({ model, apiKey, ...rest }, http) {
      const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
      const json = await postJson(`${base}/responses`, {
        ...http,
        provider: 'openai',
        headers: { authorization: `Bearer ${apiKey}` },
        body: buildOpenAIRequest({ model, ...rest }),
      });
      return parseOpenAIResponse(json);
    },
  },
  gemini: {
    apiKeyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-3.8-flash',
    async call({ model, apiKey, ...rest }, http) {
      const base = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';
      const json = await postJson(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
        ...http,
        provider: 'gemini',
        headers: { 'x-goog-api-key': apiKey },
        body: buildGeminiRequest(rest),
      });
      return parseGeminiResponse(json);
    },
  },
};

export function resolveProvider(name, { model, apiKey } = {}) {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Bilinmeyen sağlayıcı: ${name} (openai | gemini)`);
  return {
    name,
    model: model ?? process.env[provider.modelEnv] ?? provider.defaultModel,
    apiKey: apiKey ?? process.env[provider.apiKeyEnv],
    apiKeyEnv: provider.apiKeyEnv,
  };
}

/** Şemaya uyan JSON üretir ve ayrıştırılmış nesneyi döner. */
export async function generateStructured({
  provider,
  model,
  apiKey,
  system,
  user,
  schema,
  schemaName = 'report',
  maxOutputTokens = 16_000,
  fetchImpl = fetch,
  timeoutMs = 180_000,
  retries = 2,
  retryBaseMs = 1_000,
}) {
  const resolved = resolveProvider(provider, { model, apiKey });
  if (!resolved.apiKey) throw new Error(`${resolved.apiKeyEnv} tanımlı değil (.env dosyasına ekleyin)`);

  const { text, usage } = await PROVIDERS[provider].call(
    { model: resolved.model, apiKey: resolved.apiKey, system, user, schema, schemaName, maxOutputTokens },
    { fetchImpl, timeoutMs, retries, retryBaseMs },
  );
  return { data: parseJsonText(text, provider), text, usage, provider, model: resolved.model };
}
