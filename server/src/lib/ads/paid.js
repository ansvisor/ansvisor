import supabaseAdmin from '../../config/supabase.js';
import { readAllRpcRows } from '../rpc-pages.js';
import { matchSearchTerms } from './paid-match.js';

/**
 * What a brand pays on Google for its tracked prompts (ADS-01 §3.3, Phase 1
 * P2): the Google search terms its ad accounts paid for in a date range
 * (ads_search_term_totals, 00561), matched to the prompts (paid-match.js).
 *
 * - Measured once one of the brand's Google accounts has been read
 *   (synced_through): from then on a prompt with no matched cost is "we
 *   don't pay on Google for it", not "not measured".
 * - ChatGPT Ads report spend per campaign, never the question an ad showed
 *   on, so ChatGPT spend isn't matched to prompts: it stays on Campaigns.
 * - Money stays in each account's currency, never converted or added across
 *   currencies.
 * - Accounts are read by the brand and its organization (CLAUDE.md rule 3):
 *   only their ids reach the function.
 */

/** A prompt shows its costliest terms, up to this many. */
export const TOP_TERMS = 5;

const ACCOUNT_STATUSES = ['active', 'error'];

/** Micros as a currency amount, to the cent. */
const amount = (micros) => Math.round(micros / 10_000) / 100;

/** { currency → micros } as amounts, the largest first. */
function spendList(byCurrency) {
  return [...byCurrency]
    .map(([currencyCode, micros]) => ({ currencyCode, amount: amount(micros) }))
    .sort((a, b) => b.amount - a.amount || String(a.currencyCode).localeCompare(b.currencyCode));
}

/** Adds `micros` in `currency` (null when the account's isn't known) to a map. */
const add = (byCurrency, currency, micros) =>
  byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + micros);

/**
 * Sums paid spend lists (the prompts' `spend`) per currency.
 * @param {Array<Array<{ currencyCode: string | null, amount: number }> | null | undefined>} lists
 */
export function sumSpend(lists) {
  const byCurrency = new Map();
  for (const list of lists) {
    for (const s of list ?? []) add(byCurrency, s.currencyCode, Math.round(s.amount * 1e6));
  }
  return spendList(byCurrency);
}

/**
 * @param {{ orgId: string, brandId: string, from: string, to: string,
 *   prompts: Array<{ promptId: string, text: string, keywords?: string[] }> }} input
 *   from / to: the period's first and last day, YYYY-MM-DD
 * @returns {Promise<{
 *   measured: boolean,
 *   byPrompt: Map<string, {
 *     channel: 'google',
 *     spend: Array<{ currencyCode: string | null, amount: number }>,
 *     clicks: number, impressions: number, conversions: number,
 *     termCount: number,
 *     terms: Array<{ term: string, currencyCode: string | null, amount: number, clicks: number }>,
 *   }>,
 *   unmatched: Array<{ currencyCode: string | null, amount: number }>,
 * }>}
 */
export async function readPaid({ orgId, brandId, from, to, prompts }, { db = supabaseAdmin } = {}) {
  const none = { measured: false, byPrompt: new Map(), unmatched: [] };
  const { data: accounts, error } = await db
    .from('ads_accounts')
    .select('id, currency_code, synced_through')
    .eq('organization_id', orgId)
    .eq('brand_id', brandId)
    .eq('platform', 'google')
    .in('status', ACCOUNT_STATUSES)
    .not('synced_through', 'is', null);
  if (error) throw new Error(`ads_accounts read: ${error.code ?? 'error'}`);
  if (!accounts?.length) return none;

  const { data: totals, error: totalsError } = await readAllRpcRows(
    'ads_search_term_totals',
    (start, end) =>
      db
        .rpc('ads_search_term_totals', {
          p_account_ids: accounts.map((a) => a.id),
          p_from: from,
          p_to: to,
        })
        .order('account_id')
        .order('search_term')
        .range(start, end),
  );
  if (totalsError) throw new Error(`ads_search_term_totals: ${totalsError.code ?? 'error'}`);

  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency_code ?? null]));
  const rows = (totals ?? []).map((t) => ({
    term: String(t.search_term),
    currencyCode: currencyOf.get(t.account_id) ?? null,
    micros: Number(t.cost_micros) || 0,
    clicks: Number(t.clicks) || 0,
    impressions: Number(t.impressions) || 0,
    conversions: Number(t.conversions) || 0,
  }));
  const promptOf = matchSearchTerms(
    rows.map((r) => r.term),
    prompts,
  );

  const sums = new Map();
  const unmatched = new Map();
  for (const r of rows) {
    const promptId = promptOf.get(r.term);
    if (!promptId) {
      add(unmatched, r.currencyCode, r.micros);
      continue;
    }
    const p = sums.get(promptId) ?? {
      spend: new Map(),
      clicks: 0,
      impressions: 0,
      conversions: 0,
      terms: [],
    };
    add(p.spend, r.currencyCode, r.micros);
    p.clicks += r.clicks;
    p.impressions += r.impressions;
    p.conversions += r.conversions;
    p.terms.push(r);
    sums.set(promptId, p);
  }

  const byPrompt = new Map();
  for (const [promptId, p] of sums) {
    const terms = p.terms.sort((a, b) => b.micros - a.micros || a.term.localeCompare(b.term));
    byPrompt.set(promptId, {
      channel: 'google',
      spend: spendList(p.spend),
      clicks: p.clicks,
      impressions: p.impressions,
      conversions: Math.round(p.conversions * 100) / 100,
      termCount: new Set(terms.map((t) => t.term)).size,
      terms: terms.slice(0, TOP_TERMS).map((t) => ({
        term: t.term,
        currencyCode: t.currencyCode,
        amount: amount(t.micros),
        clicks: t.clicks,
      })),
    });
  }
  return { measured: true, byPrompt, unmatched: spendList(unmatched) };
}
