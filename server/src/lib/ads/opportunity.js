import supabaseAdmin from '../../config/supabase.js';
import { stripEntityMarkup } from '../entity-markup.js';
import { extractHostname } from '../response-parser.js';
import { readOpportunities, readsEveryOpportunity } from './opportunities.js';
import { ADS_PERIODS, NotFound } from './standing.js';

/**
 * One opportunity's drawer (ADS-01 §3.2, "What AI answers today"): the
 * latest answer on each platform over the period, with who it names and the
 * domains it cites, the fan-out queries those answers ran, and the prompt's
 * keyword seeds. Read with the service role, always by the brand and its
 * organization: a prompt outside them reads as not found. The answer text is
 * data, cut to an excerpt of plain text; nothing here reads it as markup.
 */

export const EXCERPT_CHARS = 600;
const TOP_DOMAINS = 5;
const FAN_OUTS = 10;
/** The newest answers looked through for each platform's latest. */
const ANSWERS_SCANNED = 500;

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

/** The answer as plain text: links to their words, no URLs or markdown marks, cut on a word. */
export function answerExcerpt(text, max = EXCERPT_CHARS) {
  const clean = stripEntityMarkup(String(text ?? ''))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s)>\]]+/g, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[*+-][ \t]+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;
  const space = clean.lastIndexOf(' ', max);
  return `${clean.slice(0, space > max / 2 ? space : max).trim()}…`;
}

/** The domains an answer cites most, then first. */
function topDomains(citations) {
  const counts = new Map();
  for (const cite of Array.isArray(citations) ? citations : []) {
    const domain = extractHostname(cite?.url);
    if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_DOMAINS)
    .map(([domain]) => domain);
}

/** The competitors an answer names, in the order it names them. */
const named = (mentions) =>
  (Array.isArray(mentions) ? mentions : [])
    .filter((m) => m?.mention_count > 0 && m.name)
    .map((m) => ({ name: m.name, position: m.mention_position ?? null }))
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

/**
 * The drawer's read, or null when the plan doesn't open this prompt:
 * Starter and the trial read only the rows Opportunities gives them.
 */
export async function readOpportunity({ brand, orgId, promptId, period, now = new Date() }) {
  const brandId = brand.id;
  const prompt = supabaseAdmin
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id, brands!inner(organization_id))')
    .eq('id', promptId)
    .eq('prompt_sets.brand_id', brandId);
  if (!must(await prompt.eq('prompt_sets.brands.organization_id', orgId).maybeSingle(), 'prompt')) {
    throw new NotFound('Prompt not found');
  }
  if (!(await readsEveryOpportunity(orgId, brand))) {
    const { rows } = await readOpportunities({ brand, orgId, period, now });
    if (!rows.some((r) => r.promptId === promptId)) return null;
  }

  const answers = (columns) =>
    supabaseAdmin
      .from('prompt_results')
      .select(`${columns}, brands!inner(organization_id)`)
      .eq('brand_id', brandId)
      .eq('brands.organization_id', orgId)
      .eq('prompt_id', promptId);
  const days = ADS_PERIODS[period] ?? ADS_PERIODS['30d'];
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const [recent, volume] = await Promise.all([
    answers('id, platform')
      .neq('platform', 'chatgpt-shopping')
      .neq('response', '')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(ANSWERS_SCANNED),
    supabaseAdmin
      .from('prompt_volumes')
      .select('keywords')
      .eq('prompt_id', promptId)
      .order('fetched_at', { ascending: false })
      .limit(1),
  ]);
  // Oldest first, so each platform keeps its newest.
  const latest = new Map();
  for (const r of (must(recent, 'answers') ?? []).toReversed()) latest.set(r.platform, r.id);
  const rows = latest.size
    ? must(
        await answers(
          'id, platform, region, created_at, response, citations, competitor_mentions, mention_position, search_queries',
        ).in('id', [...latest.values()]),
        'answer',
      )
    : [];

  const fanOuts = new Map();
  const list = (rows ?? [])
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((r) => {
      for (const q of Array.isArray(r.search_queries) ? r.search_queries : []) {
        const query = typeof q?.query === 'string' ? q.query.trim() : '';
        if (query && !fanOuts.has(query.toLowerCase())) {
          fanOuts.set(query.toLowerCase(), { query, platform: r.platform });
        }
      }
      return {
        platform: r.platform,
        region: r.region ?? null,
        at: r.created_at,
        excerpt: answerExcerpt(r.response),
        mentionPosition: r.mention_position ?? null,
        competitors: named(r.competitor_mentions),
        domains: topDomains(r.citations),
      };
    });
  const keywords = must(volume, 'prompt_volumes')?.[0]?.keywords;
  return {
    promptId,
    period,
    answers: list,
    fanOuts: [...fanOuts.values()].slice(0, FAN_OUTS),
    keywords: (Array.isArray(keywords) ? keywords : []).filter((k) => typeof k === 'string'),
  };
}
