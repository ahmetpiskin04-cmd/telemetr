// AI analist servisi: DB analizi + portföy + haberler -> prompt -> model -> doğrulama.
import { analyzeAll } from '../analysis.js';
import { buildAdvisorContext } from './context.js';
import { SYSTEM_PROMPT, REPORT_SCHEMA, buildUserMessage } from './prompt.js';
import { generateStructured } from './providers.js';
import { verifyReport } from './grounding.js';

/** Modele gidecek her şeyi hazırlar; ağ çağrısı yapmaz (--dry-run bunu kullanır). */
export async function prepareAdvisorRequest(db, { portfolio, news = [], days = 30, shareAmounts = false, asOf } = {}) {
  const analyses = await analyzeAll(db, { days });
  const context = buildAdvisorContext({ analyses, portfolio, news, shareAmounts, asOf, analysisDays: days });
  return { context, system: SYSTEM_PROMPT, user: buildUserMessage(context), schema: REPORT_SCHEMA };
}

export async function runAdvisor(db, { provider = 'openai', model, apiKey, fetchImpl, ...prepareOptions } = {}) {
  const request = await prepareAdvisorRequest(db, prepareOptions);
  const result = await generateStructured({
    provider,
    model,
    apiKey,
    fetchImpl,
    system: request.system,
    user: request.user,
    schema: request.schema,
    schemaName: 'portfolio_report',
  });
  return {
    report: result.data,
    verification: verifyReport(result.data, request.context),
    context: request.context,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
  };
}
