/**
 * "Send to Action Center" from a Site Audit report (learning D2): the page
 * and the checks it fails, sent as one Fix action.
 *
 * The audit is read again here, by its id, within the brand: the page, its
 * score and its failing checks as the database has them, not as a client
 * says they are. The action names its page and those checks as its target,
 * so the Action Center can tell whether the fix took once the page is
 * audited again, as it does for a nightly Site Audit fix. Measured
 * afterwards on its page like any person-sent action (basket-metrics.js):
 * its citations and AI-referred sessions.
 */

import supabaseAdmin from '../../config/supabase.js';
import { resolve } from '../../config/action-engine.js';
import { describeSignal } from '../audit/rubric.js';
import { opportunityKey } from '../audit/opportunities.js';
import fixLowScores from './definitions/f01-fix-low-scores.js';
import { priorityOnCreate } from './priority-data.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';

export const AUDIT_PAGE_ACTION_KIND = 'audit_page';

const ACTIVE = ['new', 'in_progress', 'on_hold'];
const KPI_KEYS = ['citations', 'ai_referral_traffic'];

const { detection } = resolve();

function httpError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

/** A check's status that says the page fails it: as the Action Center's page check reads it. */
export function failing(key, status) {
  return status === 'fail' || (status === 'warn' && key === 'json-ld-validity');
}

/** One open action per page: the same page sent again finds it. */
export function auditDedupKey(url) {
  return `${AUDIT_PAGE_ACTION_KIND}:${opportunityKey(url) ?? url}`;
}

/** High below the low-score line the nightly F01 is raised under; more failures, more urgent. */
export function auditImpact(score, failures) {
  if (score != null && Number(score) * 100 < detection.auditLowScore) return 'high';
  return failures >= 3 ? 'medium' : 'low';
}

/**
 * Creates the action, or returns the one open for the page.
 *
 * @param {string} brandId - checked against the caller's org by the route
 * @param {{ auditId: string, userId: string }} opts
 * @returns {Promise<{ actionId: string, actionNo: number, created: boolean }>}
 */
export async function sendAuditToActionCenter(brandId, { auditId, userId }) {
  const { data: audit, error: auditErr } = await supabaseAdmin
    .from('site_audits')
    .select('id, brand_id, url, final_url, status, total_score')
    .eq('id', auditId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (auditErr) throw new Error(auditErr.message);
  if (!audit) throw httpError('Audit not found', 404, 'not_found');
  if (audit.status !== 'completed') {
    throw httpError('The audit hasn’t finished', 409, 'not_completed');
  }

  const { data: results, error: resultsErr } = await supabaseAdmin
    .from('audit_signal_results')
    .select('signal_key, status')
    .eq('audit_id', audit.id);
  if (resultsErr) throw new Error(resultsErr.message);
  const checks = (results ?? [])
    .filter((r) => failing(r.signal_key, r.status))
    .map((r) => ({
      key: r.signal_key,
      label: describeSignal(r.signal_key)?.label ?? r.signal_key,
    }));
  if (!checks.length) throw httpError('The page passes its checks', 409, 'nothing_to_fix');

  const url = audit.final_url || audit.url;
  const dedupKey = auditDedupKey(url);
  const openAction = async () => {
    const { data } = await supabaseAdmin
      .from('actions')
      .select('id, action_no')
      .eq('brand_id', brandId)
      .eq('dedup_key', dedupKey)
      .in('status', ACTIVE)
      .maybeSingle();
    return data;
  };
  const open = await openAction();
  if (open) return { actionId: open.id, actionNo: Number(open.action_no), created: false };

  const score = audit.total_score == null ? null : Number(audit.total_score);
  const impact = auditImpact(score, checks.length);
  let path = url;
  try {
    path = new URL(url).pathname || '/';
  } catch {
    // Kept as given.
  }
  const payload = {
    source: AUDIT_PAGE_ACTION_KIND,
    auditId: audit.id,
    url,
    score,
    checks,
    // Measured on this page once done (basket-metrics.js).
    pages: [url],
    targetEntity: 'pages',
    targetCount: 1,
    targetIds: [url],
    // The page and the checks it fails: what an audit run on it again reads.
    targets: [{ id: url, label: path, checks: checks.map((c) => c.key) }],
  };

  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category: 'fix',
      kind: AUDIT_PAGE_ACTION_KIND,
      definition_version: 1,
      impact,
      payload,
      kpi_keys: KPI_KEYS,
      baseline: { score, failing: checks.length },
      dedup_key: dedupKey,
      ...(await priorityOnCreate({
        kind: AUDIT_PAGE_ACTION_KIND,
        category: 'fix',
        impact,
        payload,
      })),
    })
    .select('id, action_no')
    .single();
  if (error) {
    // Two sends at once: the other one opened it (the open-action dedup index, 00084).
    if (error.code === '23505') {
      const winner = await openAction();
      if (winner) {
        return { actionId: winner.id, actionNo: Number(winner.action_no), created: false };
      }
    }
    throw new Error(error.message);
  }

  const sources = await resolveBrandSources(brandId);
  const plan = planTasks(
    { id: AUDIT_PAGE_ACTION_KIND, tasks: fixLowScores.tasks },
    { sources, payload },
  );
  const { error: tasksErr } = await supabaseAdmin.from('action_tasks').insert(
    plan.map((item) => ({
      action_id: action.id,
      position: item.position,
      task_key: item.taskKey,
      task_version: item.version,
      mode: item.mode,
      permission: item.permission,
      depends_on: item.dependsOn,
      title_params: item.titleParams,
      details: item.details,
      status: 'todo',
    })),
  );
  if (tasksErr) throw new Error(tasksErr.message);

  await supabaseAdmin.from('action_events').insert({
    action_id: action.id,
    event: 'created',
    actor_id: userId,
    data: { source: AUDIT_PAGE_ACTION_KIND, checks: checks.length, taskCount: plan.length },
  });

  return { actionId: action.id, actionNo: Number(action.action_no), created: true };
}
