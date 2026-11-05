import type { SupabaseClient } from '@supabase/supabase-js';
import { auditPageKey } from '@/lib/reports/audit-score';
import { SCORE_RANGE, scoreRange, type ScoreRange } from './score-range';

/**
 * A page's earlier audits, read on the web side for the score's range
 * (customer priorities item 1): Chat's and MCP's get_site_audit and the
 * Reports' Site Audit section. They're the audits GET /api/audits/:id reads
 * for its `pageTrend` (server `lib/audit/history.js`): the same page as the
 * Pages list groups it (auditPageKey), complete (completed, scored and not
 * partial) and created before the audit.
 */

/** A `site_audits` row as the read gives it. */
export interface PageAuditRow {
  url: string;
  final_url: string | null;
  total_score: number | string | null;
  created_at: string;
}

/** The brand's complete audits read at a time while looking for the page's. */
export const PAGE_AUDITS_SLICE = 200;

/** Where it stops looking: a bound for a page audited once among thousands of the brand's audits. */
export const PAGE_AUDITS_MAX_ROWS = 5000;

/**
 * The page's complete audits before `audit`, nearest first, at most `limit`
 * (by default the ones the range reads besides the audit itself). It reads
 * the brand's complete audits newest first, a slice at a time, until it has
 * them or none are left.
 */
export async function readEarlierPageAudits(
  client: Pick<SupabaseClient, 'from'>,
  brandId: string,
  audit: Pick<PageAuditRow, 'url' | 'final_url' | 'created_at'>,
  limit: number = SCORE_RANGE.audits - 1,
): Promise<PageAuditRow[]> {
  const page = auditPageKey(audit);
  const found: PageAuditRow[] = [];
  for (let from = 0; from < PAGE_AUDITS_MAX_ROWS; from += PAGE_AUDITS_SLICE) {
    const { data, error } = await client
      .from('site_audits')
      .select('url, final_url, total_score, created_at')
      .eq('brand_id', brandId)
      .eq('status', 'completed')
      .eq('partial', false)
      .not('total_score', 'is', null)
      .lt('created_at', audit.created_at)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_AUDITS_SLICE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as PageAuditRow[];
    for (const row of rows) {
      if (auditPageKey(row) !== page) continue;
      found.push(row);
      if (found.length >= limit) return found;
    }
    if (rows.length < PAGE_AUDITS_SLICE) break;
  }
  return found;
}

/** A `site_audits` row as `readScoreRange` needs it. */
export interface RangedAuditRow extends PageAuditRow {
  brand_id: string;
  status: string;
  partial?: boolean | null;
}

/**
 * An audit's score range ("64 ± 2") from its page's last complete audits up
 * to it, by the rule Site Audit's report uses (scoreRange). Null for an audit
 * that isn't compared (unfinished, unscored or partial) and with fewer than
 * SCORE_RANGE.minAudits audits.
 */
export async function readScoreRange(
  client: Pick<SupabaseClient, 'from'>,
  audit: RangedAuditRow,
): Promise<ScoreRange | null> {
  if (audit.status !== 'completed' || audit.total_score == null || audit.partial === true) {
    return null;
  }
  const earlier = await readEarlierPageAudits(client, audit.brand_id, audit);
  // The page's trend as scoreRange reads it: oldest first, ending with this audit.
  const trend = [...earlier].reverse().concat(audit);
  return scoreRange(trend.map((row) => Number(row.total_score)));
}
