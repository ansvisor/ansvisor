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
 * Two questions, answered in that order (#818 phase 6). *What did we find?*
 * writes a candidate for every definition that matched, every night, whether
 * or not anything can be done about it. *What should we act on?* promotes
 * from that queue. Keeping them apart is what stopped findings disappearing:
 * a condition detected while the slot was busy used to be linked as evidence
 * and then forgotten, because the next cycle was built from whatever happened
 * to be open on the night the slot freed up.
 *
 * Three things stop a candidate being promoted, and they are counted
 * separately so a quiet night is legible: the brand lacks the data the
 * definition needs (`ineligible`), the last cycle closed too recently
 * (`resting`), or the brand has already had its day's worth (`capped`). None
 * of them loses the finding — it stays in the queue, and its wait is what
 * lifts it up the order.
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
import { orderByPriority, scoreCandidate } from './candidates.js';

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

function startOfUtcDay(now) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

async function openCycle({ brandId, definition, signals, impact, available, payload }) {
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
  return inserted.id;
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

  // What the queue already holds. `first_seen_at` is the only thing here that
  // cannot be recomputed — it is how long a finding has been waiting, which
  // is the term that stops a low-impact one starving behind a brand with a
  // steady stream of urgent ones.
  const { data: waitingRows, error: waitingErr } = await supabaseAdmin
    .from('action_candidates')
    .select('id, definition_id, first_seen_at, signal_ids')
    .eq('brand_id', brandId)
    .eq('status', 'waiting')
    .limit(1000);
  if (waitingErr) throw new Error(waitingErr.message);
  const waiting = new Map((waitingRows ?? []).map((row) => [row.definition_id, row]));

  const ready = [];
  const seen = new Set();
  let refreshed = 0;
  let resting = 0;
  let ineligible = 0;
  let queued = 0;

  for (const definition of definitions) {
    const matched = (openSignals ?? []).filter((signal) =>
      definition.signalKinds.includes(signal.kind),
    );
    if (matched.length === 0) continue;

    const current = active.get(definition.id);
    if (current) {
      // An active action keeps the scope it was created with. Signals that
      // arrived since are linked as evidence — they are why this action
      // exists — but `payload` is the work package someone may already be
      // executing against, and rewriting it nightly turned a recovery for six
      // prompts into a recovery for a different nine without telling anyone.
      //
      // Those newcomers are not dropped any more, which is this phase: they
      // stay in the queue below and are what the next cycle covers.
      const linked = await linkSignals(current.id, matched);
      if (linked > 0) {
        await supabaseAdmin.from('actions').update({ updated_at: nowIso }).eq('id', current.id);
        await logEvent(current.id, 'signals_linked', { count: linked });
      }
      refreshed += 1;
    }

    // A candidate covers exactly the matched signals no action has claimed.
    // Recomputed rather than accumulated: a signal that resolved leaves the
    // queue by itself, and one the active action has taken as evidence is
    // already accounted for. The queue therefore cannot drift out of step
    // with what is actually true tonight.
    const unclaimed = matched.filter((signal) => !signal.action_id);
    if (unclaimed.length === 0) continue;

    const impact = unclaimed
      .map((signal) => signal.impact)
      .sort((a, b) => IMPACT_RANK[b] - IMPACT_RANK[a])[0];
    const payload = {
      signalCount: unclaimed.length,
      ...definition.payload(groupByKind(unclaimed)),
    };

    const existing = waiting.get(definition.id);
    const firstSeenAt = existing?.first_seen_at ?? nowIso;
    const score = scoreCandidate({ impact, signalCount: unclaimed.length, firstSeenAt }, now);
    const row = {
      brand_id: brandId,
      definition_id: definition.id,
      status: 'waiting',
      signal_ids: unclaimed.map((signal) => signal.id),
      impact,
      payload,
      priority: score,
      first_seen_at: firstSeenAt,
      last_seen_at: nowIso,
      updated_at: nowIso,
    };

    let candidateId = existing?.id;
    if (candidateId) {
      const { error } = await supabaseAdmin
        .from('action_candidates')
        .update(row)
        .eq('id', candidateId);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from('action_candidates')
        .insert(row)
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      candidateId = inserted.id;
      queued += 1;
    }
    seen.add(definition.id);

    // Whether it can be promoted tonight is a separate question from whether
    // it is real, and it is asked after the queue is written — so a finding
    // that cannot be acted on now is still recorded as found.
    if (current) continue;

    if (!isEligible(definition, available)) {
      ineligible += 1;
      continue;
    }

    const closedAt = lastClosedAt.get(definition.id) ?? 0;
    if (closedAt && now.getTime() - closedAt < noise.restAfterCloseDays * DAY_MS) {
      resting += 1;
      continue;
    }

    ready.push({
      candidateId,
      definitionId: definition.id,
      definition,
      signals: unclaimed,
      impact,
      // What the score reads. Named rather than derived from `signals` inside
      // the scorer so the same shape can be scored straight out of the
      // database, where the signals themselves are just ids.
      signalCount: unclaimed.length,
      payload,
      firstSeenAt,
    });
  }

  // A candidate nothing detected tonight no longer describes anything true.
  // Stale rather than deleted: it is the record of something the engine once
  // found, and re-detection brings it back as a new waiting row with a fresh
  // clock — the same lifecycle a signal has.
  const gone = (waitingRows ?? []).filter((row) => !seen.has(row.definition_id));
  if (gone.length > 0) {
    const { error } = await supabaseAdmin
      .from('action_candidates')
      .update({ status: 'stale', updated_at: nowIso })
      .in(
        'id',
        gone.map((row) => row.id),
      );
    if (error) throw new Error(error.message);
  }

  const room = Math.max(0, noise.maxNewActionsPerDay - createdToday);
  const ordered = orderByPriority(ready, now);
  const opening = ordered.slice(0, room);

  for (const candidate of opening) {
    const actionId = await openCycle({ brandId, available, ...candidate });
    const { error } = await supabaseAdmin
      .from('action_candidates')
      .update({
        status: 'promoted',
        promoted_at: nowIso,
        promoted_action_id: actionId,
        updated_at: nowIso,
      })
      .eq('id', candidate.candidateId);
    if (error) throw new Error(error.message);
  }

  const summary = {
    created: opening.length,
    refreshed,
    resting,
    ineligible,
    capped: ordered.length - opening.length,
    queued,
    waiting: (waitingRows ?? []).length - gone.length + queued - opening.length,
    stale: gone.length,
  };
  logger.info({ brandId, ...summary }, '[actions] generated');
  return summary;
}
