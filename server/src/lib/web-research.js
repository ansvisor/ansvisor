import { generateText } from 'ai';
import { logger } from './logger.js';
import { resolveModel, webSearchTools } from './ai-provider.js';

/**
 * Research via Tavily when `TAVILY_API_KEY` is set. Provider search tools are
 * quota-gated on free keys — Google Search grounding 429s the whole suggestion
 * flow — so Tavily carries the search instead: one cheap plain-model call
 * distills the research prompt into a short query, Tavily fetches results, and
 * a plain-model call synthesizes them. Any failure returns null so the caller
 * falls back to the provider tools or no-search research.
 * @param {string} modelString - "provider/model"
 * @param {string} prompt
 * @returns {Promise<{ text: string, searched: boolean, sources: number } | null>}
 */
async function tavilyResearch(modelString, prompt) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  try {
    const { text: queryText } = await generateText({
      model: resolveModel(modelString),
      prompt: `Return ONE web search query (max 8 words, no quotes, no punctuation) to research this request:\n\n${prompt.slice(0, 500)}`,
    });
    const query = queryText
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .split('\n')[0]
      .slice(0, 120);
    if (!query) throw new Error('empty search query');
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 8, search_depth: 'basic' }),
    });
    if (!res.ok) throw new Error(`Tavily search HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    if (!results.length) throw new Error('Tavily returned no results');
    const context = results.map((r) => `[${r.title}](${r.url})\n${r.content || ''}`).join('\n\n');
    const { text } = await generateText({
      model: resolveModel(modelString),
      prompt: `${prompt}\n\nUse these web research results:\n${context}`,
    });
    return { text, searched: true, sources: results.length };
  } catch (err) {
    logger.warn({ err: err?.message }, 'tavily research failed; falling back');
    return null;
  }
}

/**
 * The research phase of the suggestion routes: one generateText call, with web
 * search attached when available — Tavily first, then the provider's own tool.
 * Returns the text plus how many sources the answer drew on, so callers can
 * log it — a research step that silently stops searching shows up as
 * `sources: 0` instead of as suggestions that are quietly worse.
 *
 * A quota failure on the provider's grounded call falls back to research from
 * the model's own knowledge: a suggestion flow that survives beats one that
 * 500s, and `searched: false` keeps the downgrade visible in the logs.
 *
 * @param {string} modelString - "provider/model"
 * @param {string} prompt
 * @returns {Promise<{ text: string, searched: boolean, sources: number }>}
 */
export async function webResearch(modelString, prompt) {
  const tavily = await tavilyResearch(modelString, prompt);
  if (tavily) return tavily;

  const tools = webSearchTools(modelString);
  if (tools) {
    try {
      const result = await generateText({
        model: resolveModel(modelString),
        prompt,
        ...(tools ? { tools } : {}),
      });
      return { text: result.text, searched: Boolean(tools), sources: result.sources?.length ?? 0 };
    } catch (err) {
      logger.warn(
        { err: err?.message },
        'provider search-grounded research failed; falling back to no-search research',
      );
    }
  }
  const result = await generateText({ model: resolveModel(modelString), prompt });
  return { text: result.text, searched: false, sources: 0 };
}
