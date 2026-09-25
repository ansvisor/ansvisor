/**
 * Action generation (Action Center, prioritization layer).
 *
 * Consolidates a brand's OPEN signals into a handful of actions — many
 * signals → one action, deterministically. A definition names the signal
 * kinds that constitute one outcome; if a brand has six open page
 * opportunities they become ONE "capture AI traffic" action with six linked
 * signals, never six rows. The count of actions therefore follows what the
 * detectors actually found: four important things yield four actions, per
 * the quality-over-quantity rule.
 *
 * This module is the matching engine and knows no definition by name. What
 * exists, what it needs, and what it puts in its payload is each definition's
 * own business — see definitions/index.js. The engine's job is the part every
 * definition shares: match, decide whether a new cycle may open, and write.
 *
 * Lifecycle across nights, mirroring signals:
 *  - an ACTIVE action keeps its scope. Newly detected signals are linked to
 *    it as evidence, but its payload is not rewritten: it is a work package
 *    someone may already be executing against, and silently changing what it
 *    covers is worse than leaving a new problem for the next cycle;
 *  - a CLOSED action — completed or dismissed — is finished. It is never
 *    written to again and never resurrected; it is the historical record of
 *    one execution cycle;
 *  - closing frees the definition's slot. Once the rest window has passed, a
 *    still firing condition opens a NEW action beside the old one, with its
 *    own baseline, tasks and outcome.
 *
 * Three things stop an action being raised, and they are counted separately
 * so a quiet night is legible: the brand lacks the data the definition needs
 * (`ineligible`), the last cycle closed too recently (`resting`), or the
 * brand has already had its day's worth (`capped`).
 *
 * `baseline` snapshots the linked signals' measured values at creation —
 * the "before" half of the validation comparison (#818, phase 2).
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { resolve } from '../../config/action-engine.js';
import { isEligible, loadDefinitions } from './definitions/index.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';

const DAY_MS = 86_400_000;

// Thresholds live in config/action-engine.js (#818 phase 2.5).
const { noise } = resolve();

const IMPACT_RANK = { high: 3, medium: 2, low: 1 };

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

function groupByKind(signals) {
  const byKind = new Map();
  for (const signal of signals) {
    byKind.set(signal.kind, [...(byKind.get(signal.kind) ?? []), signal]);
  }
  return byKind;
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

/**
 * Which candidate gets the day's remaining room.
 *
 * The same order the Action Center sorts by: impact, then weight of
 * evidence, then something stable. Phase 6 replaces this with scoring across
 * candidates; until definitions compete for the room there is nothing for a
 * score to say that this does not.
 */
function comparePriority(a, b) {
  return (
    IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] ||
    b.signals.length - a.signals.length ||
    a.definition.id.localeCompare(b.definition.id)
  );
}

function startOfUtcDay(now) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

async function openCycle({ brandId, definition, signals, impact, available }) {
  const payload = { signalCount: signals.length, ...definition.payload(groupByKind(signals)) };

  const { data: inserted, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category: definition.category,
      kind: definition.id,
      definition_version: definition.version,
      impact,
      payload,
      kpi_keys: [...new Set(signals.flatMap((signal) => signal.kpi_keys ?? []))],
      baseline: buildBaseline(signals),
      dedup_key: definition.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // The plan follows from what this brand has and what this action is about
  // — not from the kind alone (#818 phase 5). Two brands with the same
  // problem and different integrations get different lists here.
  const plan = planTasks(definition, { sources: available, payload });
  const { error: tasksErr } = await supabaseAdmin.from('action_tasks').insert(
    plan.map((item) => ({
      action_id: inserted.id,
      position: item.position,
      task_key: item.taskKey,
      task_version: item.version,
      mode: item.mode,
      permission: item.permission,
      depends_on: item.dependsOn,
      title_params: item.titleParams,
    })),
  );
  if (tasksErr) throw new Error(tasksErr.message);

  await logEvent(inserted.id, 'created', {
    impact,
    signalCount: signals.length,
    definitionVersion: definition.version,
    taskCount: plan.length,
  });
  await linkSignals(inserted.id, signals);
}

export async function generateActionsForBrand(brandId, { now = new Date(), sources } = {}) {
  const definitions = await loadDefinitions();
  const available = sources ?? (await resolveBrandSources(brandId));

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
    .select('id, dedup_key, status, created_at')
    .eq('brand_id', brandId)
    .not('status', 'in', '("completed","dismissed")')
    .limit(1000);
  if (actionsErr) throw new Error(actionsErr.message);
  const active = new Map((activeRows ?? []).map((row) => [row.dedup_key, row]));

  // How recently each definition was closed, so a condition that is still
  // firing does not reopen as a fresh action the very next night.
  const { data: closedRows, error: closedErr } = await supabaseAdmin
    .from('actions')
    .select('dedup_key, completed_at, updated_at, created_at')
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

  // The day's budget, counted from rows already fetched rather than asked
  // for separately. An action raised this morning and dismissed by lunch
  // still spent its slot: the brand was told about it.
  const dayStart = startOfUtcDay(now);
  const createdToday = [...(activeRows ?? []), ...(closedRows ?? [])].filter(
    (row) => (Date.parse(row.created_at ?? '') || 0) >= dayStart,
  ).length;

  const nowIso = now.toISOString();
  const candidates = [];
  let refreshed = 0;
  let resting = 0;
  let ineligible = 0;

  for (const definition of definitions) {
    const matched = (openSignals ?? []).filter((signal) =>
      definition.signalKinds.includes(signal.kind),
    );
    if (matched.length === 0) continue;

    const current = active.get(definition.id);
    if (current) {
      // An active action (new / in_progress / on_hold) keeps the scope it was
      // created with. Signals that arrived since are linked as evidence —
      // they are why this action exists — but `payload` is the work package
      // someone may already be executing against, and rewriting it nightly
      // turned a recovery for six prompts into a recovery for a different
      // nine without telling anyone. New targets wait for the next cycle.
      const linked = await linkSignals(current.id, matched);
      if (linked > 0) {
        await supabaseAdmin.from('actions').update({ updated_at: nowIso }).eq('id', current.id);
        await logEvent(current.id, 'signals_linked', { count: linked });
      }
      refreshed += 1;
      continue;
    }

    // Eligibility gates opening a cycle, not maintaining one: a brand that
    // disconnects an integration mid-cycle keeps the action it was given.
    if (!isEligible(definition, available)) {
      ineligible += 1;
      continue;
    }

    // The slot is open. Leave it open a while after a cycle closed, so a
    // condition that is still firing does not produce a fresh action every
    // night — the same restraint the old reopen window provided, minus the
    // resurrection.
    const closedAt = lastClosedAt.get(definition.id) ?? 0;
    if (closedAt && now.getTime() - closedAt < noise.restAfterCloseDays * DAY_MS) {
      resting += 1;
      continue;
    }

    candidates.push({
      definition,
      signals: matched,
      impact: matched
        .map((signal) => signal.impact)
        .sort((a, b) => IMPACT_RANK[b] - IMPACT_RANK[a])[0],
    });
  }

  const room = Math.max(0, noise.maxNewActionsPerDay - createdToday);
  candidates.sort(comparePriority);
  const opening = candidates.slice(0, room);

  for (const candidate of opening) {
    await openCycle({ brandId, available, ...candidate });
  }

  const summary = {
    created: opening.length,
    refreshed,
    resting,
    ineligible,
    capped: candidates.length - opening.length,
  };
  logger.info({ brandId, ...summary }, '[actions] generated');
  return summary;
}
