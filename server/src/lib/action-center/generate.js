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
 *  - an OPEN action is refreshed: payload recounted, newly detected signals
 *    linked (logged as a signals_linked event);
 *  - a DISMISSED action stays dismissed;
 *  - a COMPLETED action stays completed while fresh — but if its condition
 *    is still (or again) firing REOPEN_AFTER_DAYS after completion, it
 *    reopens: the outcome did not hold, and hiding that would be lying.
 *
 * `baseline` snapshots the linked signals' measured values at creation —
 * the "before" half of the future validation comparison.
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';

const REOPEN_AFTER_DAYS = 14;
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

  const { data: existingRows, error: actionsErr } = await supabaseAdmin
    .from('actions')
    .select('id, dedup_key, status, completed_at')
    .eq('brand_id', brandId)
    .limit(1000);
  if (actionsErr) throw new Error(actionsErr.message);
  const existing = new Map((existingRows ?? []).map((row) => [row.dedup_key, row]));

  const nowIso = now.toISOString();
  let created = 0;
  let refreshed = 0;
  let reopened = 0;

  for (const rule of ACTION_RULES) {
    const matched = (openSignals ?? []).filter((signal) => rule.signalKinds.includes(signal.kind));
    if (matched.length === 0) continue;

    const impact = matched
      .map((signal) => signal.impact)
      .sort((a, b) => IMPACT_RANK[b] - IMPACT_RANK[a])[0];
    const kpiKeys = [...new Set(matched.flatMap((signal) => signal.kpi_keys ?? []))];
    const payload = buildPayload(rule, matched);
    const current = existing.get(rule.kind);

    if (!current) {
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

    if (current.status === 'dismissed') continue;

    if (current.status === 'completed') {
      const completedAt = current.completed_at ? Date.parse(current.completed_at) : 0;
      if (now.getTime() - completedAt < REOPEN_AFTER_DAYS * DAY_MS) continue;
      const { error } = await supabaseAdmin
        .from('actions')
        .update({
          status: 'new',
          impact,
          payload,
          kpi_keys: kpiKeys,
          completed_at: null,
          updated_at: nowIso,
        })
        .eq('id', current.id);
      if (error) throw new Error(error.message);
      await logEvent(current.id, 'reopened', { signalCount: matched.length });
      await linkSignals(current.id, matched);
      reopened += 1;
      continue;
    }

    // Open in some form (new / in_progress / on_hold / no_improvement):
    // refresh the measured context, quietly — an event only when the
    // evidence actually grew.
    const { error } = await supabaseAdmin
      .from('actions')
      .update({ impact, payload, kpi_keys: kpiKeys, updated_at: nowIso })
      .eq('id', current.id);
    if (error) throw new Error(error.message);
    const linked = await linkSignals(current.id, matched);
    if (linked > 0) await logEvent(current.id, 'signals_linked', { count: linked });
    refreshed += 1;
  }

  const summary = { created, refreshed, reopened };
  logger.info({ brandId, ...summary }, '[actions] generated');
  return summary;
}
