/**
 * What a piece of AI work typically costs, for the pages that say before it
 * runs how much of the month's AI usage it takes (customer priorities item
 * 9): getAiUsage turns each into a share of the plan's budget, so dollars
 * stay on the server. Typical, not a promise: a longer page takes more.
 */

import { LLM_SIGNALS_TYPICAL_TOKENS, auditLlmModel } from './audit/llm-signals.js';
import { contentReadModelId, contentWriteModelId } from './content-brief.js';
import { generationCostUsd, searchCostUsd } from './improve-cost.js';

/**
 * A typical Write this (content-writer.js briefThenWrite): the brief, read
 * from the opportunity's prompts and fan-outs; the page written from it; and
 * the searches its facts pass runs.
 */
const WRITE_THIS = {
  brief: { inputTokens: 12_000, outputTokens: 3_000 },
  page: { inputTokens: 20_000, outputTokens: 8_000 },
  searches: 5,
};

/** Each estimate's cost in USD, by the key the web reads it under. */
export function aiEstimateCosts() {
  return {
    writeThis:
      generationCostUsd(contentReadModelId(), WRITE_THIS.brief) +
      generationCostUsd(contentWriteModelId(), WRITE_THIS.page) +
      searchCostUsd(WRITE_THIS.searches),
    // A draft's Site Audit estimate with its AI checks: its views' calls (llm-signals.js).
    auditAiChecks: generationCostUsd(auditLlmModel(), LLM_SIGNALS_TYPICAL_TOKENS),
  };
}
