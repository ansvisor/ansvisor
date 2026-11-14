/**
 * Site Audit's estimate of a Content Editor draft (customer priorities item
 * 9): the page as it goes out, read by the audit's own checks before it is
 * published, so the person sees about where it will land.
 *
 * - The checks that read the page itself run on the draft, for free.
 * - The checks of the site around it (robots.txt, llms.txt, HTTPS, the
 *   theme's head tags, the footer's links) are the same on every page: they
 *   come from the brand's latest completed audit, and are left out when it
 *   has none.
 * - The checks AI reads run only on request, on the workspace's AI usage
 *   (Quality's); a verdict given before is sent back with each reading, so
 *   the score keeps it while the page changes.
 * - The Wikidata lookup is left out: it reads the brand, not the page.
 *
 * Estimates like this ran about 6 points under the full audit (30 dev
 * audits, AI checks left out; plan §7).
 */

import supabaseAdmin from '../../config/supabase.js';
import { LLM_SIGNAL_KEYS } from './llm-signals.js';
import { categories, isScored, signalsByKey } from './rubric.js';
import { scoreAudit } from './scorer.js';

/** The checks of the site around a page, rather than of the page: the same on each of its pages. */
export const SITE_SIGNALS = new Set([
  'structural-depth',
  'page-weight',
  'open-graph',
  'date-markup',
  'freshness',
  'ai-bot-access',
  'llms-txt-presence',
  'https',
  'canonical',
  'viewport',
  'twitter-card',
  'privacy-terms',
  'contact-info',
]);

const AI_SIGNALS = new Set(LLM_SIGNAL_KEYS);

const na = (key) => ({ key, status: 'na', score: null });

/** How many of the lowest checks the estimate names as why it is low. */
const TOP_ISSUES = 3;
const categoryWeight = new Map(categories.map((c) => [c.key, c.weight]));

/**
 * The checks that cost the estimate most: what each takes off the total
 * (its category's weight, shared by the checks read in it), the biggest
 * first. `scope` says where it is fixed: the draft ('page', the AI's too),
 * or Site Audit ('site').
 */
function topIssues(results, categoryScores) {
  return results
    .filter(
      (r) => r.status !== 'na' && typeof r.score === 'number' && r.score < 1 && isScored(r.key),
    )
    .map((r) => {
      const { category, label } = signalsByKey[r.key];
      const share =
        (categoryWeight.get(category) ?? 0) / (categoryScores[category]?.evaluated || 1);
      return {
        key: r.key,
        label,
        scope: SITE_SIGNALS.has(r.key) ? 'site' : 'page',
        loss: (1 - r.score) * share,
      };
    })
    .filter((i) => i.loss > 0)
    .sort((a, b) => b.loss - a.loss)
    .slice(0, TOP_ISSUES)
    .map(({ loss: _loss, ...issue }) => issue);
}

/**
 * The estimate from the draft's own readings: the page's checks as run on
 * the draft, the site's from its latest audit (none: left out), and the AI
 * checks' verdicts when there are any. `score` and each category's are
 * 0–100, whole; null where nothing was read. `issues` are the
 * three checks that cost it most: { key, label, scope: 'page' | 'site' }.
 *
 * @param {{ page: Array<{ key: string, status: string, score: number|null }>,
 *   site: Array<{ key: string, status: string, score: number|null }>,
 *   ai?: Array<{ key: string, status: string, score: number|null }> }} readings
 */
export function draftEstimate({ page, site, ai = [] }) {
  const siteByKey = new Map(site.filter((r) => SITE_SIGNALS.has(r.key)).map((r) => [r.key, r]));
  const aiByKey = new Map(ai.filter((r) => AI_SIGNALS.has(r.key)).map((r) => [r.key, r]));
  const results = page.map((r) => {
    if (SITE_SIGNALS.has(r.key)) return siteByKey.get(r.key) ?? na(r.key);
    return r;
  });
  for (const key of AI_SIGNALS) results.push(aiByKey.get(key) ?? na(key));
  const { totalScore, categoryScores } = scoreAudit(results);
  const read = (rows) => rows.filter((r) => r.status !== 'na' && typeof r.score === 'number');
  const whole = (n) => (typeof n === 'number' ? Math.round(n * 100) : null);
  return {
    score: whole(totalScore),
    categories: Object.fromEntries(
      Object.entries(categoryScores).map(([key, c]) => [key, whole(c.score)]),
    ),
    checks: {
      page: read(results.filter((r) => !SITE_SIGNALS.has(r.key) && !AI_SIGNALS.has(r.key))).length,
      site: read([...siteByKey.values()]).length,
      ai: read([...aiByKey.values()]).length,
    },
    issues: topIssues(results, categoryScores),
  };
}

/**
 * The site's checks from the brand's latest completed audit: none when it
 * has no audit, or its results can't be read (the estimate leaves them out).
 */
export async function readSiteSignals(brandId) {
  const { data: audit, error } = await supabaseAdmin
    .from('site_audits')
    .select('id')
    .eq('brand_id', brandId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !audit) return [];
  const { data: rows, error: rowsError } = await supabaseAdmin
    .from('audit_signal_results')
    .select('signal_key, status, score')
    .eq('audit_id', audit.id)
    .in('signal_key', [...SITE_SIGNALS]);
  if (rowsError) return [];
  return (rows ?? []).map((r) => ({
    key: r.signal_key,
    status: r.status,
    score: r.score === null ? null : Number(r.score),
  }));
}
