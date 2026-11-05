import type { ReportAuditScore } from '@/lib/actions/reports';

/** How many of the brand's latest audits are read to find the page's audit before. */
export const AUDIT_SNAPSHOT_ROWS = 100;

/** A `site_audits` row as the report's snapshot reads it, newest first. */
export interface AuditSnapshotRow {
  url: string;
  final_url: string | null;
  total_score: number | string | null;
  created_at: string;
}

/**
 * One key per page, the way the Pages list groups audits (server
 * `lib/audit/history.js`): the final URL after a redirect, the host without
 * www, and the path without a trailing slash. Query and fragment are ignored.
 */
export function auditPageKey(row: Pick<AuditSnapshotRow, 'url' | 'final_url'>): string {
  const url = row.final_url ?? row.url;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return url;
  }
}

/** A stored 0–1 audit score as the 0–100 points the audit report shows. */
function toPoints(score: AuditSnapshotRow['total_score']): number | null {
  return score === null ? null : Math.round(Number(score) * 100);
}

/**
 * The report's Site Audit section from the brand's latest complete audits,
 * newest first: the latest audit's score and the score of the same page's
 * audit before it, both on the 0–100 scale. Null when there is no audit.
 */
export function auditSnapshotFrom(rows: AuditSnapshotRow[]): ReportAuditScore | null {
  const [latest, ...older] = rows;
  if (!latest) return null;
  const page = auditPageKey(latest);
  const prior = older.find((r) => r.total_score !== null && auditPageKey(r) === page);
  return {
    url: latest.url,
    totalScore: toPoints(latest.total_score),
    previousScore: prior ? toPoints(prior.total_score) : null,
    auditedAt: latest.created_at,
    scale: 100,
  };
}

/** What the report's Site Audit section shows. */
export interface AuditScoreView {
  /** The score as shown: "64", "~60" on a report saved before the 0–100 scale, or "—". */
  score: string;
  /** Points since the same page's audit before; null when there is none to compare. */
  change: number | null;
}

/**
 * The Site Audit section of a saved report. Reports saved before the 0–100
 * scale stored the 0–1 score rounded to one decimal, so their score is shown
 * as about that many points ("~60" for 0.6), and their previous score, which
 * could be another page's, isn't compared.
 */
export function auditScoreView(audit: ReportAuditScore): AuditScoreView {
  if (audit.scale === 100) {
    return {
      score: audit.totalScore === null ? '—' : String(audit.totalScore),
      change:
        audit.totalScore !== null && audit.previousScore !== null
          ? audit.totalScore - audit.previousScore
          : null,
    };
  }
  return {
    score: audit.totalScore === null ? '—' : `~${Math.round(audit.totalScore * 100)}`,
    change: null,
  };
}
