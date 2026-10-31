/**
 * The impact ledger's nightly job (CHAT-22 §2, 00421), behind CHAT_AGENTIC:
 * each shipped change measured at 7, 14, 30 and 90 days against a control
 * set (method.js), from the Insights rollups of scheduled tracking only. No
 * engine query, no model call, no usage_ledger row (Addendum 2 G).
 *
 * Each run:
 *   1. seeds a Pending measurement for each ship event written in the last
 *      SEED_DAYS that has none (a writer that didn't, or failed to);
 *   2. reads the measurements due (next_check_at passed) and their ship
 *      events, for the workspaces Chat is on for, and skips read-only
 *      workspaces (no active plan): they stay due;
 *   3. per brand, in a few batched reads: its prompts (topics, active), the
 *      changes it shipped around the windows (overlaps, controls), and each
 *      window's rollup rows, read once and shared;
 *   4. per measurement, each checkpoint due: the targets (active, not
 *      shared with another change), the controls, the metrics and the
 *      outcome; writes the control sets, then the measurement, only as it
 *      was read (another server's run writes it once);
 *   5. per brand, the outcome of the agent runs whose changes were measured
 *      (chat_agent_runs.outcome, CHAT-21 §I item 43).
 * A brand, or a measurement, that fails is counted and logged, and the next
 * goes on. Logs carry counts and codes only, never a customer's names,
 * prompts or pages.
 */

import cron from 'node-cron';
import supabaseAdmin from '../../config/supabase.js';
import { getPlan, isCloud, isSubscriptionActive } from '../../config/plans.js';
import { chatAgenticDeployed, chatAgenticEnabled, chatAgenticOrgs } from '../chat-flag.js';
import { logger } from '../logger.js';
import { applyPlanOverrides } from '../plan-guard.js';
import {
  aggregateCells,
  addDays,
  checkpointEntry,
  checkpointWindow,
  dueCheckpoints,
  measureCells,
  nextCheckAt,
  OVERLAP_SHARE,
  primaryMetric,
  runOutcome,
  shippedInWindow,
  utcDay,
} from './method.js';
import { ImpactDbError, readAll, readChunks, seedMeasurements } from './ship.js';

/** Daily at 07:53 UTC: yesterday's rollups are in by then (the daily sweep refreshes them). */
export const SCHEDULE = '53 7 * * *';
/** Ship events written this many days back are checked for a missing measurement. */
export const SEED_DAYS = 30;
/** Most other changes a measurement lists in concurrent_changes. */
const MAX_CONCURRENT = 50;

const DAY_MS = 86_400_000;
const errInfo = (err) => ({ name: err?.name, code: err?.code ?? null });

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

/** The prompt ids among a measurement's targets. */
const targetPromptIds = (targets) =>
  (Array.isArray(targets) ? targets : [])
    .filter((t) => t?.type === 'prompt' && typeof t.id === 'string')
    .map((t) => t.id);

// ─── Reads ──────────────────────────────────────────────────────────────────

/** Ship events written lately (for the workspaces Chat is on for) with no measurement yet. */
async function loadUnseeded(db, now) {
  const orgs = chatAgenticOrgs();
  const since = new Date(now.getTime() - SEED_DAYS * DAY_MS).toISOString();
  const ships = (
    await readAll('new ship events read', () => {
      let query = db
        .from('ship_events')
        .select('id, organization_id, brand_id, action_id, content_draft_id, url, shipped_at')
        .gte('created_at', since)
        .order('id');
      if (orgs.length) query = query.in('organization_id', orgs);
      return query;
    })
  ).filter((ship) => chatAgenticEnabled(ship.organization_id));
  const seeded = new Set(
    (
      await readChunks(
        'seeded measurements read',
        ships.map((s) => s.id),
        (chunk) =>
          db
            .from('impact_measurements')
            .select('ship_event_id')
            .in('ship_event_id', chunk)
            .order('ship_event_id'),
      )
    ).map((m) => m.ship_event_id),
  );
  return ships.filter((ship) => !seeded.has(ship.id));
}

/** The measurements due now, each with its ship event, for the workspaces Chat is on for. */
async function loadDue(db, now) {
  const measurements = await readAll('due measurements read', () =>
    db
      .from('impact_measurements')
      .select('id, ship_event_id, targets, checkpoints_json, next_check_at')
      .lte('next_check_at', now.toISOString())
      .order('id'),
  );
  const ships = new Map(
    (
      await readChunks(
        'ship events read',
        measurements.map((m) => m.ship_event_id),
        (chunk) =>
          db
            .from('ship_events')
            .select(
              'id, organization_id, brand_id, kind, change_type, shipped_at, agent_run_id, title',
            )
            .in('id', chunk)
            .order('id'),
      )
    ).map((s) => [s.id, s]),
  );
  return measurements
    .map((measurement) => ({ measurement, ship: ships.get(measurement.ship_event_id) }))
    .filter(({ ship }) => ship && chatAgenticEnabled(ship.organization_id));
}

/** The workspaces' plan limits and whether they may be measured (an active plan, or off the cloud). */
async function loadPlans(db, orgIds) {
  const plans = new Map();
  if (!isCloud()) {
    for (const id of orgIds) plans.set(id, { active: true, limits: getPlan('self_hosted').limits });
    return plans;
  }
  const orgs = await readChunks('organizations read', orgIds, (chunk) =>
    db
      .from('organizations')
      .select('id, plan, subscription_status, plan_overrides')
      .in('id', chunk)
      .order('id'),
  );
  for (const org of orgs) {
    plans.set(org.id, {
      active: isSubscriptionActive(org.subscription_status),
      limits: applyPlanOverrides(getPlan(org.plan), org).limits,
    });
  }
  return plans;
}

/** The brand's prompts: topic and whether they are tracked, by id. */
async function loadPrompts(db, brandId) {
  const rows = await readAll('prompts read', () =>
    db
      .from('prompts')
      .select('id, topic_id, is_active, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId)
      .order('id'),
  );
  return new Map(
    rows.map((p) => [p.id, { topic_id: p.topic_id ?? null, is_active: !!p.is_active }]),
  );
}

/** The brand's changes shipped between two days, each with its target prompts. */
async function loadShipped(db, brandId, from, to) {
  const ships = await readAll('shipped changes read', () =>
    db
      .from('ship_events')
      .select('id, title, shipped_at')
      .eq('brand_id', brandId)
      .gte('shipped_at', `${from}T00:00:00.000Z`)
      .lt('shipped_at', `${addDays(to, 1)}T00:00:00.000Z`)
      .order('id'),
  );
  const targets = new Map(
    (
      await readChunks(
        'shipped targets read',
        ships.map((s) => s.id),
        (chunk) =>
          db
            .from('impact_measurements')
            .select('ship_event_id, targets')
            .in('ship_event_id', chunk)
            .order('ship_event_id'),
      )
    ).map((m) => [m.ship_event_id, new Set(targetPromptIds(m.targets))]),
  );
  return ships.map((s) => ({ ...s, promptIds: targets.get(s.id) ?? new Set() }));
}

/** One window's rollup rows for the brand, as cells on the plan's engines. */
async function loadWindow(db, brandId, from, to, limits) {
  const rows = await readAll('rollups read', () =>
    db
      .from('insights_prompt_daily')
      .select('day, prompt_id, platform, model_used, region, has_mention, has_citation')
      .eq('brand_id', brandId)
      .gte('day', from)
      .lte('day', to)
      .order('day')
      .order('prompt_id')
      .order('platform')
      .order('model_used')
      .order('region'),
  );
  return aggregateCells(rows, limits);
}

// ─── One measurement ────────────────────────────────────────────────────────

/**
 * One checkpoint of one change (CHAT-22 §2 items 7, 10, 11): Not measurable
 * without targets (no_targets), with every target out of tracking
 * (targets_removed), or with another change shipped in the window on
 * OVERLAP_SHARE of them (overlapping_change); else measured on the targets
 * no other change shares, against controls no change in the window targets.
 */
async function measureCheckpoint({ measurement, ship, cp, prompts, shipped, windowOf }) {
  const window = checkpointWindow(ship.shipped_at, cp.day);
  const targetIds = targetPromptIds(measurement.targets);
  if (targetIds.length === 0) return { window, result: { reason: 'no_targets' }, concurrent: [] };
  const active = targetIds.filter((id) => prompts.get(id)?.is_active);
  if (active.length === 0) {
    return { window, result: { reason: 'targets_removed' }, concurrent: [] };
  }

  const others = shipped.filter((s) => s.id !== ship.id && shippedInWindow(s.shipped_at, window));
  const shared = new Set();
  const concurrent = [];
  let overlapping = false;
  for (const other of others) {
    const common = active.filter((id) => other.promptIds.has(id));
    if (common.length === 0) continue;
    common.forEach((id) => shared.add(id));
    if (common.length / active.length >= OVERLAP_SHARE) overlapping = true;
    concurrent.push({
      type: 'ship_event',
      id: other.id,
      title: other.title,
      shipped_at: other.shipped_at,
      shared_targets: common.length,
    });
  }
  concurrent.splice(MAX_CONCURRENT);
  if (overlapping) return { window, result: { reason: 'overlapping_change' }, concurrent };

  const excluded = new Set(targetIds);
  for (const other of others) other.promptIds.forEach((id) => excluded.add(id));
  const [pre, post] = [
    await windowOf(window.pre_start, window.pre_end),
    await windowOf(window.post_start, window.post_end),
  ];
  const result = measureCells({
    seed: `${measurement.id}:${cp.key}`,
    primary: primaryMetric(ship),
    targetIds: active.filter((id) => !shared.has(id)),
    pre,
    post,
    excluded,
    prompts,
  });
  return { window, result, concurrent };
}

/**
 * Every checkpoint due for one measurement, then its writes: the control
 * sets (one per checkpoint, written again unchanged by a second run), then
 * the measurement itself, only while its next_check_at is as read. Says
 * whether it wrote the measurement.
 */
async function measureOne(db, { measurement, ship, due, prompts, shipped, windowOf, now, tally }) {
  const measuredAt = now.toISOString();
  const entries = Array.isArray(measurement.checkpoints_json)
    ? [...measurement.checkpoints_json]
    : [];
  const controls = [];
  let latest = null;
  for (const cp of due) {
    const { window, result, concurrent } = await measureCheckpoint({
      measurement,
      ship,
      cp,
      prompts,
      shipped,
      windowOf,
    });
    const entry = checkpointEntry({ cp, window, result, earlier: entries, measuredAt });
    entries.push(entry);
    if (result.control) {
      controls.push({
        impact_measurement_id: measurement.id,
        checkpoint: cp.key,
        entities: result.control.cells.map((cell) => ({
          type: 'prompt',
          id: cell.pre.promptId,
          platform: cell.pre.platform,
          region: cell.pre.region,
        })),
        match_rules_json: result.control.rules,
        cell_count: result.control.cells.length,
      });
    }
    latest = { cp, window, result, entry, concurrent };
    tally.checkpoints++;
  }
  if (!latest) return false;

  if (controls.length) {
    const { error } = await db
      .from('impact_control_sets')
      .upsert(controls, { onConflict: 'impact_measurement_id,checkpoint' });
    if (error) throw new ImpactDbError('control sets write', error);
  }

  const { cp, window, result, entry, concurrent } = latest;
  const verdict = cp.key !== 'd7';
  const { data, error } = await db
    .from('impact_measurements')
    .update({
      window_json: window,
      metrics: result.metrics ?? [],
      outcome: entry.outcome,
      confidence: entry.confidence,
      checkpoint: cp.key,
      checkpoints_json: entries,
      not_measurable_reason: verdict ? entry.not_measurable_reason : null,
      concurrent_changes: concurrent,
      next_check_at: nextCheckAt(ship.shipped_at, cp.key),
      measured_at: measuredAt,
    })
    .eq('id', measurement.id)
    .eq('next_check_at', measurement.next_check_at)
    .select('id');
  if (error) throw new ImpactDbError('measurement write', error);
  if (!data?.length) return false;
  tally.measured++;
  if (entry.outcome === 'not_measurable') tally.notMeasurable++;
  return true;
}

/**
 * The agent runs' outcomes from what they shipped (CHAT-21 §I item 43), for
 * the runs one of whose changes was just measured; written only when they
 * changed.
 */
async function updateAgentRuns(db, runIds, tally) {
  if (runIds.length === 0) return;
  const ships = await readChunks('run ship events read', runIds, (chunk) =>
    db.from('ship_events').select('id, agent_run_id').in('agent_run_id', chunk).order('id'),
  );
  const measured = new Map(
    (
      await readChunks(
        'run measurements read',
        ships.map((s) => s.id),
        (chunk) =>
          db
            .from('impact_measurements')
            .select('ship_event_id, outcome, confidence')
            .in('ship_event_id', chunk)
            .order('ship_event_id'),
      )
    ).map((m) => [m.ship_event_id, m]),
  );
  const runs = await readChunks('agent runs read', runIds, (chunk) =>
    db
      .from('chat_agent_runs')
      .select('id, outcome, outcome_confidence')
      .in('id', chunk)
      .order('id'),
  );
  const shipsOf = groupBy(ships, 'agent_run_id');
  for (const run of runs) {
    const next = runOutcome(
      (shipsOf.get(run.id) ?? []).map((s) => measured.get(s.id)).filter(Boolean),
    );
    if (!next) continue;
    if (next.outcome === run.outcome && next.confidence === (run.outcome_confidence ?? null)) {
      continue;
    }
    const { error } = await db
      .from('chat_agent_runs')
      .update({ outcome: next.outcome, outcome_confidence: next.confidence })
      .eq('id', run.id);
    if (error) throw new ImpactDbError('agent run outcome write', error);
    tally.runsUpdated++;
  }
}

/**
 * One brand's due measurements. Its prompts and shipped changes are read
 * once, each window's rollups once, whatever the number of measurements;
 * a measurement that fails is counted and the next goes on.
 */
async function runBrand(db, { brandId, items, limits, now, tally }) {
  let from = null;
  let to = null;
  for (const { ship, due } of items) {
    for (const cp of due) {
      const window = checkpointWindow(ship.shipped_at, cp.day);
      if (!from || window.pre_start < from) from = window.pre_start;
      if (!to || window.post_end > to) to = window.post_end;
    }
  }
  const prompts = await loadPrompts(db, brandId);
  const shipped = await loadShipped(db, brandId, from, to);
  const windows = new Map();
  const windowOf = (start, end) => {
    const key = `${start}|${end}`;
    if (!windows.has(key)) windows.set(key, loadWindow(db, brandId, start, end, limits));
    return windows.get(key);
  };

  const runIds = new Set();
  for (const item of items) {
    try {
      const wrote = await measureOne(db, { ...item, prompts, shipped, windowOf, now, tally });
      if (wrote && item.ship.agent_run_id) runIds.add(item.ship.agent_run_id);
    } catch (err) {
      tally.failed++;
      logger.error({ err: errInfo(err) }, '[impact-ledger] measurement failed');
    }
  }
  await updateAgentRuns(db, [...runIds], tally);
}

// ─── The run ────────────────────────────────────────────────────────────────

/**
 * One run of the job (the nightly tick). Never throws: a brand or a
 * measurement that fails is counted and logged, and the next goes on. With
 * CHAT_AGENTIC off it reads and writes nothing.
 *
 * @param {{ db?: object, now?: Date }} [options]
 * @returns {Promise<{ seeded: number, brands: number, measured: number, checkpoints: number,
 *   notMeasurable: number, runsUpdated: number, skipped: number, failed: number }>}
 */
export async function runImpactLedger({ db = supabaseAdmin, now = new Date() } = {}) {
  const tally = {
    seeded: 0,
    brands: 0,
    measured: 0,
    checkpoints: 0,
    notMeasurable: 0,
    runsUpdated: 0,
    skipped: 0,
    failed: 0,
  };
  if (!chatAgenticDeployed()) return tally;

  try {
    // Its own step: a seed that fails is tried again tomorrow, and what is due is measured.
    try {
      tally.seeded = await seedMeasurements(db, await loadUnseeded(db, now));
    } catch (err) {
      tally.failed++;
      logger.error({ err: errInfo(err) }, '[impact-ledger] seeding failed');
    }

    const due = (await loadDue(db, now))
      .map((item) => ({
        ...item,
        due: dueCheckpoints(item.measurement.checkpoints_json, item.ship.shipped_at, now),
      }))
      .filter((item) => item.due.length > 0);
    const plans = await loadPlans(db, [...new Set(due.map((item) => item.ship.organization_id))]);

    for (const [brandId, items] of groupBy(
      due.map((item) => ({ ...item, brandId: item.ship.brand_id })),
      'brandId',
    )) {
      const plan = plans.get(items[0].ship.organization_id);
      if (!plan?.active) {
        tally.skipped += items.length;
        continue;
      }
      try {
        await runBrand(db, { brandId, items, limits: plan.limits, now, tally });
        tally.brands++;
      } catch (err) {
        tally.failed++;
        logger.error({ err: errInfo(err) }, '[impact-ledger] brand failed');
      }
    }
  } catch (err) {
    tally.failed++;
    logger.error({ err: errInfo(err) }, '[impact-ledger] run failed');
  }
  logger.info({ ...tally, day: utcDay(now) }, '[impact-ledger] run done');
  return tally;
}

/**
 * Started with the server while CHAT_AGENTIC is on (server.js): the run
 * daily at SCHEDULE. A run still going when the next comes is left to
 * finish; that one is skipped.
 */
export function startImpactLedger({ schedule = SCHEDULE, run = runImpactLedger } = {}) {
  let running = false;
  cron.schedule(schedule, async () => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (err) {
      logger.error({ err: errInfo(err) }, '[impact-ledger] run crashed');
    } finally {
      running = false;
    }
  });
  logger.info({ schedule }, '[impact-ledger] nightly measuring scheduled');
}
