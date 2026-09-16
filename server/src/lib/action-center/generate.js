/**
 * Action generation (Action Center, prioritization layer).
 *
 * Consolidates a brand's OPEN signals into a handful of actions — many
 * signals → one action, deterministically. Each rule below names the signal
 * kinds that constitute one outcome; if a brand has six open page
 * opportunities they become ONE "capture AI traffic" action with six linked
 * signals, never six rows. The count of actions therefore follows what the
 * detectors actually found: four important things yield four actions, per
 * the quality-over-quantity rule. A future scoring/clustering engine can
 * replace this module without touching the schema.
 *
 * Lifecycle across nights, mirroring signals:
 *  - an ACTIVE action keeps its scope. Newly detected signals are linked to
 *    it as evidence, but its payload is not rewritten: it is a work package
 *    someone may already be executing against, and silently changing what it
 *    covers is worse than leaving a new problem for the next cycle;
 *  - a CLOSED action — completed or dismissed — is finished. It is never
 *    written to again and never resurrected; it is the historical record of
 *    one execution cycle;
 *  - closing frees the kind's slot. Once the rest window has passed, a still
 *    firing condition opens a NEW action beside the old one, with its own
 *    baseline, tasks and outcome.
 *
 * `baseline` snapshots the linked signals' measured values at creation —
 * the "before" half of the future validation comparison (#818, phase 2).
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';

/**
 * How long a kind rests after a cycle closes before a new one may open.
 *
 * Without it, a condition that is still firing would produce a fresh action
 * the night after someone closed the last one — a treadmill. The old code
 * used this window to decide whether to resurrect the completed row; now it
 * decides when the next cycle may begin, and the completed row is never
 * touched again.
 */
const REST_AFTER_CLOSE_DAYS = 14;
const DAY_MS = 86_400_000;

const IMPACT_RANK = { high: 3, medium: 2, low: 1 };

/**
 * The consolidation rules. `kind` keys the i18n templates and task list
 * web-side (web/src/lib/action-center/registry.ts); `signalKinds` decides
 * which open signals constitute the action.
 */
const ACTION_RULES = [
  {
    kind: 'recover_visibility',
    category: 'recover',
    signalKinds: ['sharp_drop', 'lost_citations'],
    taskKeys: ['analyze_losses', 'coverage_gaps', 'update_content', 'internal_links', 'validate'],
  },
  {
    kind: 'capture_ai_traffic',
    category: 'growth',
    signalKinds: ['page_opportunity'],
    taskKeys: ['review_pages', 'coverage_gaps', 'optimize_content', 'validate'],
  },
  {
    kind: 'convert_mentions',
    category: 'growth',
    signalKinds: ['uncited_mentions'],
    taskKeys: ['identify_prompts', 'create_citable_content', 'strengthen_sources'],
  },
  {
    kind: 'fix_low_scores',
    category: 'fix',
    signalKinds: ['audit_low_score'],
    taskKeys: ['review_audits', 'fix_issues', 'revalidate'],
  },
  {
    kind: 'close_competitor_gap',
    category: 'compete',
    signalKinds: ['competitor_surge', 'competitor_crossed'],
    taskKeys: ['analyze_competitor', 'coverage_gaps', 'strengthen_content', 'validate'],
  },
];

function buildPayload(rule, signals) {
  const byKind = new Map();
  for (const signal of signals) {
    byKind.set(signal.kind, [...(byKind.get(signal.kind) ?? []), signal]);
  }
  const payload = { signalCount: signals.length };

  switch (rule.kind) {
    case 'recover_visibility': {
      payload.promptCount = (byKind.get('lost_citations') ?? []).length;
      const drop = (byKind.get('sharp_drop') ?? [])[0];
      if (drop) {
        payload.dropFrom = drop.previous_value;
        payload.dropTo = drop.current_value;
      }
      break;
    }
    case 'capture_ai_traffic':
      payload.pageCount = (byKind.get('page_opportunity') ?? []).length;
      break;
    case 'convert_mentions':
      payload.promptCount = Number((byKind.get('uncited_mentions') ?? [])[0]?.current_value ?? 0);
      break;
    case 'fix_low_scores':
      payload.pageCount = Number((byKind.get('audit_low_score') ?? [])[0]?.current_value ?? 0);
      break;
    case 'close_competitor_gap': {
      const names = new Set();
      for (const signal of signals) {
        const name = signal.payload?.competitorName;
        if (name) names.add(name);
      }
      payload.competitorNames = [...names].slice(0, 3);
      break;
    }
  }
  return payload;
}

function buildBaseline(signals) {
  return {
    capturedAt: new Date().toISOString(),
    signals: signals.map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      previousValue: signal.previous_value,
      currentValue: signal.current_value,
      changeValue: signal.change_value,
    })),
  };
}

async function logEvent(actionId, event, data = {}) {
  const { error } = await supabaseAdmin
    .from('action_events')
    .insert({ action_id: actionId, event, data });
  if (error) throw new Error(error.message);
}

async function linkSignals(actionId, signals) {
  const unlinked = signals.filter((signal) => !signal.action_id);
  if (unlinked.length === 0) return 0;
  const { error } = await supabaseAdmin
    .from('signals')
    .update({ action_id: actionId })
    .in(
      'id',
      unlinked.map((signal) => signal.id),
    );
  if (error) throw new Error(error.message);
  return unlinked.length;
}

export async function generateActionsForBrand(brandId, { now = new Date() } = {}) {
  const { data: openSignals, error: signalsErr } = await supabaseAdmin
    .from('signals')
    .select(
      'id, kind, impact, kpi_keys, payload, previous_value, current_value, change_value, action_id',
    )
    .eq('brand_id', brandId)
    .in('status', ['new', 'acknowledged'])
    .limit(1000);
  if (signalsErr) throw new Error(signalsErr.message);

  // Only the active ones. A completed or dismissed action is a finished
  // cycle: it neither blocks a new one nor is ever written to again, so it
  // has no bearing on what happens tonight beyond the rest window below.
  const { data: activeRows, error: actionsErr } = await supabaseAdmin
    .from('actions')
    .select('id, dedup_key, status')
    .eq('brand_id', brandId)
    .not('status', 'in', '("completed","dismissed")')
    .limit(1000);
  if (actionsErr) throw new Error(actionsErr.message);
  const active = new Map((activeRows ?? []).map((row) => [row.dedup_key, row]));

  // How recently each kind was closed, so a condition that is still firing
  // does not reopen as a fresh action the very next night.
  const { data: closedRows, error: closedErr } = await supabaseAdmin
    .from('actions')
    .select('dedup_key, completed_at, updated_at')
    .eq('brand_id', brandId)
    .in('status', ['completed', 'dismissed'])
    .order('created_at', { ascending: false })
    .limit(1000);
  if (closedErr) throw new Error(closedErr.message);
  const lastClosedAt = new Map();
  for (const row of closedRows ?? []) {
    const closed = Date.parse(row.completed_at ?? row.updated_at ?? '') || 0;
    if (closed > (lastClosedAt.get(row.dedup_key) ?? 0)) {
      lastClosedAt.set(row.dedup_key, closed);
    }
  }

  const nowIso = now.toISOString();
  let created = 0;
  let refreshed = 0;
  let resting = 0;

  for (const rule of ACTION_RULES) {
    const matched = (openSignals ?? []).filter((signal) => rule.signalKinds.includes(signal.kind));
    if (matched.length === 0) continue;

    const impact = matched
      .map((signal) => signal.impact)
      .sort((a, b) => IMPACT_RANK[b] - IMPACT_RANK[a])[0];
    const kpiKeys = [...new Set(matched.flatMap((signal) => signal.kpi_keys ?? []))];
    const payload = buildPayload(rule, matched);
    const current = active.get(rule.kind);

    if (!current) {
      // The slot is open. Leave it open a while after a cycle closed, so a
      // condition that is still firing does not produce a fresh action every
      // night — the same restraint the old reopen window provided, minus the
      // resurrection.
      const closedAt = lastClosedAt.get(rule.kind) ?? 0;
      if (closedAt && now.getTime() - closedAt < REST_AFTER_CLOSE_DAYS * DAY_MS) {
        resting += 1;
        continue;
      }

      const { data: inserted, error } = await supabaseAdmin
        .from('actions')
        .insert({
          brand_id: brandId,
          category: rule.category,
          kind: rule.kind,
          impact,
          payload,
          kpi_keys: kpiKeys,
          baseline: buildBaseline(matched),
          dedup_key: rule.kind,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);

      const { error: tasksErr } = await supabaseAdmin.from('action_tasks').insert(
        rule.taskKeys.map((taskKey, index) => ({
          action_id: inserted.id,
          position: index + 1,
          task_key: taskKey,
        })),
      );
      if (tasksErr) throw new Error(tasksErr.message);

      await logEvent(inserted.id, 'created', { impact, signalCount: matched.length });
      await linkSignals(inserted.id, matched);
      created += 1;
      continue;
    }

    // An active action (new / in_progress / on_hold) keeps the scope it was
    // created with. Signals that arrived since are linked as evidence — they
    // are why this action exists — but `payload` is the work package someone
    // may already be executing against, and rewriting it nightly turned a
    // recovery for six prompts into a recovery for a different nine without
    // telling anyone. New targets wait for the next cycle.
    const linked = await linkSignals(current.id, matched);
    if (linked > 0) {
      await supabaseAdmin.from('actions').update({ updated_at: nowIso }).eq('id', current.id);
      await logEvent(current.id, 'signals_linked', { count: linked });
    }
    refreshed += 1;
  }

  const summary = { created, refreshed, resting };
  logger.info({ brandId, ...summary }, '[actions] generated');
  return summary;
}
