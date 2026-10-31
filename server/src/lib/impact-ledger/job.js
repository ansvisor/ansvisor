/**
 * The impact ledger's nightly job (CHAT-22 §2, 00421), behind CHAT_AGENTIC:
 * each shipped change measured at 7, 14, 30 and 90 days against a control
 * set (method.js), from the Insights rollups of scheduled tracking only. No
 * engine query, no model call, no usage_ledger row (Addendum 2 G).
 *
 * Each run:
 *   1. seeds a Pending measurement for each ship event written in the last
 *      SEED_DAYS that has none (a writer that didn't, or failed to);
 *   2. reads the measurements due (next_check_at passed) with their ship
 *      events and workspaces, only those Chat is on for with an active plan
 *      (filtered in the query): a read-only workspace's stay due;
 *   3. per brand, in a few batched reads: its prompts (topics, active), the
 *      changes it shipped around the windows (overlaps, controls), and each
 *      window's rollup rows, read once and shared;
 *   4. per measurement, each checkpoint due: the targets (active, not
 *      shared with another change), the controls, the metrics and the
 *      outcome; writes the control sets, then the measurement, only as it
 *      was read (another server's run writes it once);
 *   5. closes, Not measurable (plan_inactive), what is still open
 *      CLOSE_AFTER_DAYS after ship for a workspace that can't be measured
 *      (no active plan, or Chat no longer on for it);
 *   6. brings the agent runs whose changes were measured in the last
 *      RUN_SYNC_DAYS in step (chat_agent_runs.outcome, CHAT-21 §I item 43),
 *      so a write that failed is made the next night.
 * A brand, a measurement or a run that fails is counted and logged, and the
 * next goes on. Logs carry counts and codes only, never a customer's names,
 * prompts or pages.
 */

import cron from 'node-cron';
import supabaseAdmin from '../../config/supabase.js';
import { getPlan, isCloud, isSubscriptionActive } from '../../config/plans.js';
import { chatAgenticDeployed, chatAgenticEnabled, chatAgenticOrgs } from '../chat-flag.js';
import { chunkIds } from '../chunked-in.js';
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
/**
 * Days after ship a measurement still open is closed for a workspace that
 * can't be measured: day 90's check (the morning after day 90), then 30 days.
 */
export const CLOSE_AFTER_DAYS = 91 + 30;
/** Days back the agent runs of measured changes are brought in step: a failed write is retried. */
export const RUN_SYNC_DAYS = 3;
/** Subscription states with an active plan (config/plans.js isSubscriptionActive). */
const ACTIVE_STATUSES = ['active', 'trialing'];
/** A measurement's ship event and workspace, embedded by their foreign keys' names. */
const SHIP_OF = 'ship_events!impact_measurements_ship_event_id_fkey!inner';
const ORG_OF = 'organizations!ship_events_organization_id_fkey!inner';

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

/** The plan limits a workspace's engines are read on (§2 item 15): self-hosted has every one. */
function limitsOf(org) {
  if (!isCloud()) return getPlan('self_hosted').limits;
  return applyPlanOverrides(getPlan(org?.plan), org ?? {}).limits;
}

/**
 * Ship events written lately with no measurement yet, for the workspaces
 * Chat is on for with an active plan (in the query).
 */
async function loadUnseeded(db, now) {
  const orgs = chatAgenticOrgs();
  const since = new Date(now.getTime() - SEED_DAYS * DAY_MS).toISOString();
  const ships = (
    await readAll('new ship events read', () => {
      let query = db
        .from('ship_events')
        .select(
          `id, organization_id, brand_id, action_id, content_draft_id, url, shipped_at, ${ORG_OF}(subscription_status)`,
        )
        .gte('created_at', since);
      if (orgs.length) query = query.in('organization_id', orgs);
      if (isCloud()) query = query.in('organizations.subscription_status', ACTIVE_STATUSES);
      return query.order('id');
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

/**
 * The measurements due now, each with its ship event and its workspace's
 * plan limits: only workspaces Chat is on for (CHAT_AGENTIC_ORGS) with an
 * active plan, filtered in the query.
 */
async function loadDue(db, now) {
  const orgs = chatAgenticOrgs();
  const rows = await readAll('due measurements read', () => {
    let query = db
      .from('impact_measurements')
      .select(
        `id, ship_event_id, targets, checkpoints_json, next_check_at, ${SHIP_OF}(id, organization_id, brand_id, kind, change_type, shipped_at, agent_run_id, title, ${ORG_OF}(plan, subscription_status, plan_overrides))`,
      )
      .lte('next_check_at', now.toISOString());
    if (orgs.length) query = query.in('ship_events.organization_id', orgs);
    if (isCloud()) {
      query = query.in('ship_events.organizations.subscription_status', ACTIVE_STATUSES);
    }
    return query.order('id');
  });
  return rows
    .filter((row) => row.ship_events && chatAgenticEnabled(row.ship_events.organization_id))
    .map(({ ship_events: ship, ...measurement }) => ({
      measurement,
      ship,
      limits: limitsOf(ship.organizations),
    }));
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
 * OVERLAP_SHARE of them, or other changes on all of them together
 * (overlapping_change); else measured on the targets no other change
 * shares, against controls no change in the window targets.
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
  const own = active.filter((id) => !shared.has(id));
  // Other changes share them all, or half or more for one: Not measurable.
  if (overlapping || own.length === 0) {
    return { window, result: { reason: 'overlapping_change' }, concurrent };
  }

  const excluded = new Set(targetIds);
  for (const other of others) other.promptIds.forEach((id) => excluded.add(id));
  const [pre, post] = [
    await windowOf(window.pre_start, window.pre_end),
    await windowOf(window.post_start, window.post_end),
  ];
  const result = measureCells({
    seed: `${measurement.id}:${cp.key}`,
    primary: primaryMetric(ship),
    targetIds: own,
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
 * Closes, Not measurable (plan_inactive), the measurements still open
 * CLOSE_AFTER_DAYS after ship whose workspace can't be measured: no active
 * plan, or Chat no longer on for it. Their next check goes, so they are
 * read no more. A workspace that can be measured keeps its own: a late run
 * still reads them.
 */
async function closeStale(db, now, tally) {
  const cutoff = new Date(now.getTime() - CLOSE_AFTER_DAYS * DAY_MS).toISOString();
  const rows = await readAll('stale measurements read', () =>
    db
      .from('impact_measurements')
      .select(`id, ${SHIP_OF}(organization_id, shipped_at, ${ORG_OF}(subscription_status))`)
      .not('next_check_at', 'is', null)
      .lt('ship_events.shipped_at', cutoff)
      .order('id'),
  );
  const closing = rows
    .filter(({ ship_events: ship }) => {
      if (!ship) return false;
      return (
        !chatAgenticEnabled(ship.organization_id) ||
        !isSubscriptionActive(ship.organizations?.subscription_status)
      );
    })
    .map((row) => row.id);
  for (const chunk of chunkIds(closing)) {
    const { data, error } = await db
      .from('impact_measurements')
      .update({
        outcome: 'not_measurable',
        confidence: null,
        not_measurable_reason: 'plan_inactive',
        checkpoint: 'd90',
        next_check_at: null,
        measured_at: now.toISOString(),
      })
      .in('id', chunk)
      .not('next_check_at', 'is', null)
      .select('id');
    if (error) throw new ImpactDbError('stale measurements close', error);
    tally.closed += (data ?? []).length;
  }
}

/**
 * The agent runs' outcomes from what they shipped (CHAT-21 §I item 43), for
 * the runs one of whose changes was measured in the last RUN_SYNC_DAYS:
 * written only when they changed, and only within the run's own workspace.
 * A run whose write fails is counted, and made again the next night.
 */
async function syncAgentRuns(db, now, tally) {
  const since = new Date(now.getTime() - RUN_SYNC_DAYS * DAY_MS).toISOString();
  const recent = await readAll('measured runs read', () =>
    db
      .from('impact_measurements')
      .select(`id, ${SHIP_OF}(agent_run_id, organization_id)`)
      .gte('measured_at', since)
      .not('ship_events.agent_run_id', 'is', null)
      .order('id'),
  );
  const orgOf = new Map();
  for (const { ship_events: ship } of recent) {
    if (ship?.agent_run_id && chatAgenticEnabled(ship.organization_id)) {
      orgOf.set(ship.agent_run_id, ship.organization_id);
    }
  }
  const runIds = [...orgOf.keys()];
  if (runIds.length === 0) return;
  const ships = await readChunks('run ship events read', runIds, (chunk) =>
    db
      .from('ship_events')
      .select('id, agent_run_id, organization_id')
      .in('agent_run_id', chunk)
      .order('id'),
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
      .select('id, organization_id, outcome, outcome_confidence')
      .in('id', chunk)
      .order('id'),
  );
  const shipsOf = groupBy(ships, 'agent_run_id');
  for (const run of runs) {
    const org = orgOf.get(run.id);
    if (run.organization_id !== org) continue;
    const next = runOutcome(
      (shipsOf.get(run.id) ?? [])
        .filter((s) => s.organization_id === org)
        .map((s) => measured.get(s.id))
        .filter(Boolean),
    );
    if (!next) continue;
    if (next.outcome === run.outcome && next.confidence === (run.outcome_confidence ?? null)) {
      continue;
    }
    const { error } = await db
      .from('chat_agent_runs')
      .update({ outcome: next.outcome, outcome_confidence: next.confidence })
      .eq('id', run.id)
      .eq('organization_id', org);
    if (error) {
      tally.failed++;
      logger.error(
        { err: errInfo(new ImpactDbError('agent run outcome write', error)) },
        '[impact-ledger] agent run not updated',
      );
      continue;
    }
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

  for (const item of items) {
    try {
      await measureOne(db, { ...item, prompts, shipped, windowOf, now, tally });
    } catch (err) {
      tally.failed++;
      logger.error({ err: errInfo(err) }, '[impact-ledger] measurement failed');
    }
  }
}

// ─── The run ────────────────────────────────────────────────────────────────

/**
 * One run of the job (the nightly tick). Never throws: a brand or a
 * measurement that fails is counted and logged, and the next goes on. With
 * CHAT_AGENTIC off it reads and writes nothing.
 *
 * @param {{ db?: object, now?: Date }} [options]
 * @returns {Promise<{ seeded: number, brands: number, measured: number, checkpoints: number,
 *   notMeasurable: number, runsUpdated: number, closed: number, failed: number }>}
 */
export async function runImpactLedger({ db = supabaseAdmin, now = new Date() } = {}) {
  const tally = {
    seeded: 0,
    brands: 0,
    measured: 0,
    checkpoints: 0,
    notMeasurable: 0,
    runsUpdated: 0,
    closed: 0,
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

    for (const [brandId, items] of groupBy(
      due.map((item) => ({ ...item, brandId: item.ship.brand_id })),
      'brandId',
    )) {
      try {
        await runBrand(db, { brandId, items, limits: items[0].limits, now, tally });
        tally.brands++;
      } catch (err) {
        tally.failed++;
        logger.error({ err: errInfo(err) }, '[impact-ledger] brand failed');
      }
    }

    // Their own steps: one that fails is tried again tomorrow.
    try {
      await closeStale(db, now, tally);
    } catch (err) {
      tally.failed++;
      logger.error({ err: errInfo(err) }, '[impact-ledger] closing failed');
    }
    try {
      await syncAgentRuns(db, now, tally);
    } catch (err) {
      tally.failed++;
      logger.error({ err: errInfo(err) }, '[impact-ledger] agent runs failed');
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
