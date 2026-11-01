import type { RecentAudit, StartSiteAuditsResult } from '@/lib/actions/audits';

/**
 * Starting Site Audit's audits of a brand's pages through the API (Chat's
 * run_site_audit): the request, and what its answer means. Shared by the
 * person's own start (startSiteAudits) and a run's start for its person
 * with no session (lib/chat/actor/api-writes.ts), so both read the API the
 * same way.
 */

/** The API's RECENT_AUDIT_MINUTES (routes/audits.js): a page audited since asks first. */
const RECENT_AUDIT_MINUTES = 10;

/** One page as Run audit starts it, several as the Pages tab's Re-audit (the bulk route). */
export function auditStartRequest(brandId: string, urls: string[], force: boolean) {
  const many = urls.length > 1;
  return {
    path: `/api/audits${many ? '/bulk' : ''}` as const,
    body: {
      brandId,
      ...(many ? { urls } : { url: urls[0] }),
      ...(force ? { force: true } : {}),
    },
  };
}

/** The API's answer to a start, in run_site_audit's result. */
export function auditStartResult(
  urls: string[],
  res: { status: number; ok: boolean },
  body: {
    error?: string;
    message?: string;
    audit?: { id: string; url: string };
    audits?: { id: string; url: string }[];
    recent?: RecentAudit | RecentAudit[];
  },
): StartSiteAuditsResult {
  const many = urls.length > 1;
  // A page audited in the last minutes isn't started again: said back, so Chat asks first.
  if (res.status === 409 && body.error === 'recently_audited' && body.recent) {
    return recentResult([], [{ ...(body.recent as RecentAudit), url: urls[0] }]);
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: body.error === 'quota_exceeded' ? 'quota_exceeded' : 'failed',
      message: body.message || `Server error: ${res.status}`,
    };
  }
  const audits = (many ? (body.audits ?? []) : body.audit ? [body.audit] : []).map((a) => ({
    id: a.id,
    url: a.url,
  }));
  return recentResult(audits, Array.isArray(body.recent) ? body.recent : []);
}

/** A start's result, saying which pages were audited minutes ago and not started. */
function recentResult(
  audits: { id: string; url: string }[],
  recent: RecentAudit[],
): StartSiteAuditsResult {
  if (recent.length === 0) return { ok: true, started: audits.length, audits };
  const pages = recent
    .map((r) => `${r.url} (audit ${r.auditId}, finished ${r.finishedAt})`)
    .join(', ');
  return {
    ok: true,
    started: audits.length,
    audits,
    recent,
    message: `Not started, audited in the last ${RECENT_AUDIT_MINUTES} minutes: ${pages}. Ask whether to open that audit or audit again; to audit again, run this again with force.`,
  };
}
