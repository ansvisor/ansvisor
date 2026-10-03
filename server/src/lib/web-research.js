import { generateText } from 'ai';
import { resolveModel, webSearchTools } from './ai-provider.js';

/**
 * The research phase of the suggestion routes: one generateText call with the
 * provider's web search attached when it has one.
 *
 * Returns the text plus how many sources the answer drew on, so callers can
 * log it — a research step that silently stops searching (as the old
 * `useSearchGrounding` flag did) shows up as `sources: 0` instead of as
 * suggestions that are quietly worse.
 *
 * @param {string} modelString - "provider/model"
 * @param {string} prompt
 * @returns {Promise<{ text: string, searched: boolean, sources: number }>}
 */
export async function webResearch(modelString, prompt) {
  const tools = webSearchTools(modelString);
  const result = await generateText({
    model: resolveModel(modelString),
    prompt,
    ...(tools ? { tools } : {}),
  });
  return { text: result.text, searched: Boolean(tools), sources: result.sources?.length ?? 0 };
}
