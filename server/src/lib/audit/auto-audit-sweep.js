/**
 * The daily auto-audit sweep (SA-006). For each organization whose run is
 * due, it claims the run (one site_audit_auto_runs row per org, period and
 * run day, so a second sweep the same day does nothing), audits the top
 * pages of its brands' Opportunities inboxes, and once every audit has
 * finished, records the run and, when the team asked for it, e-mails them.
 *
 * The inbox read and the audit start live in routes/audits.js; they're
 * passed in, so this module doesn't import a route (and tests stand them in).
 */

import supabaseAdmin from '../../config/supabase.js';
import { getSiteAuditQuotaStatus, PlanLimitError } from '../plan-guard.js';
import { readAllRpcRows } from '../rpc-pages.js';
import { logger } from '../logger.js';
import { AUTO_AUDIT, pickRunPages } from './auto-audit.js';
import { sendAutoAuditEmail } from './auto-audit-email.js';
import { opportunityKey } from './opportunities.js';

/**
 * @typedef {object} SweepDeps
 * @property {(brandId: string) => Promise<{ opportunities: object[] }>} readInbox
 * @property {(brandId: string, urls: string[], orgId: string) => Promise<{ auditIds: string[], done: Promise<unknown> }>} startAudits
 * @property {Date} [now]
 * @property {string[]} [orgIds]  only these organizations (the manual script)
 */

/**
 * Start every due run; resolves when they have all finished.
 *
 * @param {SweepDeps} deps
 * @returns {Promise<{ runs: number }>}
 */
export async function sweepAutoAudits({ readInbox, startAudits, now = new Date(), orgIds }) {
  const { data: brands, error } = await readAllRpcRows('brands', (from, to) => {
    let query = supabaseAdmin
      .from('brands')
      .select('id, name, organization_id')
      .eq('is_active', true);
    if (orgIds) query = query.in('organization_id', orgIds);
    return query.order('id', { ascending: true }).range(from, to);
  });
  if (error) throw new Error(error.message);

  const byOrg = new Map();
  const seen = new Set();
  for (const brand of brands ?? []) {
    // A slice boundary can repeat a row (rpc-pages.js).
    if (!brand.organization_id || seen.has(brand.id)) continue;
    seen.add(brand.id);
    if (!byOrg.has(brand.organization_id)) byOrg.set(brand.organization_id, []);
    byOrg.get(brand.organization_id).push(brand);
  }

  // Runs are started one org at a time, then finish together: their audits
  // share the auto pool, so starting is quick and finishing is not.
  const finishing = [];
  for (const [orgId, orgBrands] of byOrg) {
    try {
      const run = await startRun(orgId, orgBrands, { readInbox, startAudits, now });
      if (run) finishing.push(run.finished);
    } catch (err) {
      logger.error({ err, orgId }, '[auto-audit] run failed to start');
    }
  }
  await Promise.all(finishing);
  return { runs: finishing.length };
}

/**
 * Claim and start the org's due run. Returns { finished }, a promise that
 * settles once the run is recorded (wrapped, so awaiting the start doesn't
 * wait for it), or null when nothing is due.
 */
async function startRun(orgId, brands, { readInbox, startAudits, now }) {
  let quota;
  try {
    quota = await getSiteAuditQuotaStatus(orgId, { now });
  } catch (err) {
    // An org without an active subscription has nothing to run.
    if (err instanceof PlanLimitError) return null;
    throw err;
  }
  const { auto } = quota;
  if (!auto.enabled || !auto.due) return null;

  // The run's share, or what's left of the whole quota when that's less.
  const free = quota.limit === -1 ? auto.perRun : quota.limit - quota.used - quota.running;
  const slots = Math.max(0, Math.min(auto.perRun, free));

  const { data: claimed, error } = await supabaseAdmin
    .from('site_audit_auto_runs')
    .upsert(
      {
        organization_id: orgId,
        period_start: auto.periodStart,
        run_day: auto.due.day,
        slots,
        started_at: now.toISOString(),
      },
      { onConflict: 'organization_id,period_start,run_day', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(error.message);
  const runId = claimed?.[0]?.id;
  // Another sweep claimed it first.
  if (!runId) return null;

  const inboxes = [];
  let triedKeys = new Set();
  if (slots > 0) {
    triedKeys = await recentlyTriedPages(brands, now);
    for (const brand of brands) {
      try {
        const { opportunities } = await readInbox(brand.id);
        inboxes.push({ brandId: brand.id, opportunities });
      } catch (err) {
        logger.warn({ err, orgId, brandId: brand.id }, '[auto-audit] inbox read failed');
      }
    }
  }
  const pages = pickRunPages(inboxes, slots, now, triedKeys);

  const auditIds = [];
  const audits = [];
  for (const brand of brands) {
    const urls = pages.filter((p) => p.brandId === brand.id).map((p) => p.url);
    if (urls.length === 0) continue;
    try {
      const started = await startAudits(brand.id, urls, orgId);
      auditIds.push(...started.auditIds);
      audits.push(started.done);
    } catch (err) {
      // The quota filled up meanwhile (a user's audits): the run keeps what it started.
      logger.warn({ err, orgId, brandId: brand.id }, '[auto-audit] audits not started');
    }
  }
  if (auditIds.length > 0) {
    const { error: idsErr } = await supabaseAdmin
      .from('site_audit_auto_runs')
      .update({ audit_ids: auditIds })
      .eq('id', runId);
    if (idsErr) throw new Error(idsErr.message);
  }

  const nextRunAt = auto.runs.find((r) => r.day > auto.due.day)?.at ?? auto.periodEnd;
  const finished = Promise.all(audits)
    .then(() =>
      finishRun({ runId, orgId, brands, auditIds, emailAfterRun: auto.emailAfterRun, nextRunAt }),
    )
    .catch((err) => logger.error({ err, orgId, runId }, '[auto-audit] run failed to finish'));
  return { finished };
}

/** Pages the org's runs audited in the last 30 days, completed or not. */
async function recentlyTriedPages(brands, now) {
  const since = new Date(now.getTime() - AUTO_AUDIT.freshDays * 24 * 60 * 60 * 1000);
  const { data, error } = await supabaseAdmin
    .from('site_audits')
    .select('url')
    .in(
      'brand_id',
      brands.map((b) => b.id),
    )
    .eq('source', 'auto')
    .gte('created_at', since.toISOString());
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => opportunityKey(row.url)).filter(Boolean));
}

/** Record the finished run and, when the org asked for it, e-mail what it found. */
async function finishRun({ runId, orgId, brands, auditIds, emailAfterRun, nextRunAt }) {
  const { data: rows, error } = auditIds.length
    ? await supabaseAdmin.from('site_audits').select('id, brand_id, status').in('id', auditIds)
    : { data: [], error: null };
  if (error) throw new Error(error.message);

  const perBrand = [];
  for (const brand of brands) {
    const own = (rows ?? []).filter((r) => r.brand_id === brand.id);
    if (own.length === 0) continue;
    const completed = own.filter((r) => r.status === 'completed').map((r) => r.id);
    let criticalIssues = 0;
    if (completed.length > 0) {
      // Critical issues: the signals the audits failed.
      const { count, error: countErr } = await supabaseAdmin
        .from('audit_signal_results')
        .select('audit_id', { count: 'exact', head: true })
        .in('audit_id', completed)
        .eq('status', 'fail');
      if (countErr) throw new Error(countErr.message);
      criticalIssues = count ?? 0;
    }
    perBrand.push({
      name: brand.name,
      pages: own.length,
      completed: completed.length,
      criticalIssues,
    });
  }

  const { error: doneErr } = await supabaseAdmin
    .from('site_audit_auto_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString() })
    .eq('id', runId);
  if (doneErr) throw new Error(doneErr.message);

  const emailed =
    emailAfterRun && perBrand.length > 0
      ? await sendAutoAuditEmail(orgId, { brands: perBrand, nextRunAt })
      : false;
  logger.info({ orgId, runId, brands: perBrand, emailed }, '[auto-audit] run finished');
}
