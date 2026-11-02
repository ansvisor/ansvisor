/**
 * Follow-up checks at work (CHAT-20 §13, CHAT-12 v2; W3-05), behind
 * CHAT_AGENTIC: a one-time re-check of a target on its date, set by a
 * person's click, a Full auto run or an agent run that shipped something
 * (chat_schedules, kind followup_check). Read from scheduled tracking data
 * only: no engine query, no model call, no usage row (Addendum 2 G). Hourly,
 * beside the impact ledger's nightly job.
 *
 * Each run reads the checks due (next_run_at passed), claims each by moving
 * its next_run_at from what was read (two servers check it once), and:
 *
 *   - a check on shipped changes (an agent's, or a page or an action that
 *     has a ship event) reads the impact ledger's measurement of them, the
 *     latest checkpoint measured, in its own vocabulary: it never measures
 *     again. While every one is still Pending it waits, up to
 *     WAIT_FOR_DATA_DAYS after its date;
 *   - a check on prompts reads the Insights rollups: the first tracked day
 *     on or after its date against the BASELINE_DAYS before it was set,
 *     the brand's share of answers (visibility) or of citing answers
 *     (citations), on the platforms it names. A change under
 *     MIN_EFFECT_PTS points is No meaningful change. No control set:
 *     correlation, not causation. No tracked day yet: it waits, as above;
 *   - anything else is Not measurable.
 *
 * The result goes to the chat that set the check (an assistant message) and
 * to its creator's Inbox (a followup_result notice), and is the check's one
 * run (chat_schedule_runs, done): Scheduled shows it ran, and its Undo is
 * closed (last_run_at). A check that fails is tried again in RETRY_MS.
 * Logs carry counts and codes only, never a customer's names or pages.
 */

import cron from 'node-cron';
import supabaseAdmin from '../../config/supabase.js';
import { chatAgenticDeployed, chatAgenticEnabled } from '../chat-flag.js';
import { logger } from '../logger.js';
import { BASELINE_DAYS, MIN_EFFECT_PTS, addDays, runOutcome, utcDay } from './method.js';

/** Hourly at :17: a check due at 09:00 reads that day's tracking once it is in. */
export const FOLLOW_UP_SCHEDULE = '17 * * * *';
/** Days after its date a check waits for its tracking data (or its checkpoint) before it says Not measurable. */
export const WAIT_FOR_DATA_DAYS = 3;
/** How long a check waits before it reads again: for data, or after a failure. */
export const RETRY_MS = 6 * 60 * 60 * 1000;
/** Most checks one run reads. */
const TICK_ROWS = 100;
/** Days after its date the first tracked day may be. */
const FIRST_DAY_WITHIN = 7;

const DAY_MS = 86_400_000;
const COLUMNS =
  'id, organization_id, brand_id, title, due_at, next_run_at, created_by, conversation_id, target_json, metric, created_at';
const errInfo = (err) => ({ name: err?.name, code: err?.code ?? null });

/** The outcome vocabulary's words (CHAT-22 §2 item 10). */
export const OUTCOME_WORDS = Object.freeze({
  pending: 'Pending',
  improved: 'Improved',
  no_meaningful_change: 'No meaningful change',
  declined: 'Declined',
  not_measurable: 'Not measurable',
});

class FollowUpDbError extends Error {
  constructor(what, error) {
    super(`${what}: ${error?.message ?? 'no row'}`);
    this.name = 'FollowUpDbError';
    this.code = error?.code ?? null;
  }
}

const check = (what, { data, error }) => {
  if (error) throw new FollowUpDbError(what, error);
  return data;
};

// ─── What a check reads ─────────────────────────────────────────────────────

/** The changes a check is about: its own (an agent's), its action's, or its page's, newest first. */
async function shipsOf(db, job) {
  const target = job.target_json ?? {};
  if (Array.isArray(target.ship_event_ids) && target.ship_event_ids.length) {
    return check(
      'ship events read',
      await db
        .from('ship_events')
        .select('id, shipped_at')
        .in('id', target.ship_event_ids.slice(0, 20))
        .eq('organization_id', job.organization_id),
    );
  }
  if (!job.brand_id) return [];
  if (typeof target.action_id === 'string') {
    return check(
      'ship events read',
      await db
        .from('ship_events')
        .select('id, shipped_at')
        .eq('brand_id', job.brand_id)
        .eq('action_id', target.action_id)
        .order('shipped_at', { ascending: false })
        .limit(20),
    );
  }
  if (typeof target.url === 'string') {
    return check(
      'ship events read',
      await db
        .from('ship_events')
        .select('id, shipped_at')
        .eq('brand_id', job.brand_id)
        .eq('url', target.url)
        .order('shipped_at', { ascending: false })
        .limit(1),
    );
  }
  return [];
}

/** A measurement's latest checkpoint measured by `now` (checkpoints_json is oldest first). */
function latestCheckpoint(measurement, now) {
  const entries = Array.isArray(measurement.checkpoints_json) ? measurement.checkpoints_json : [];
  return (
    entries.filter((e) => e?.measured_at && Date.parse(e.measured_at) <= now.getTime()).at(-1) ??
    null
  );
}

/** What the impact ledger measured of the changes, or null while it has nothing yet. */
async function fromLedger(db, ships, now) {
  const rows = check(
    'measurements read',
    await db
      .from('impact_measurements')
      .select('ship_event_id, checkpoints_json')
      .in(
        'ship_event_id',
        ships.map((s) => s.id),
      ),
  );
  const entries = (rows ?? []).map((m) => latestCheckpoint(m, now)).filter(Boolean);
  if (entries.length === 0) return null;
  const outcome = runOutcome(entries);
  if (outcome.outcome === 'pending') return null;
  const lead = entries.find((e) => e.outcome === outcome.outcome) ?? entries[0];
  return {
    source: 'ledger',
    outcome: outcome.outcome,
    confidence: outcome.confidence,
    metric: lead.metric ?? null,
    before: lead.before ?? null,
    after: lead.after ?? null,
    checkpoint: lead.checkpoint ?? null,
    dataDay: lead.window?.post_end ?? utcDay(lead.measured_at),
  };
}

/** A share of answers, in points: the brand named (visibility) or cited (citations). */
function shareOf(rows, metric) {
  let answers = 0;
  let hits = 0;
  for (const row of rows) {
    const count = Number(row.answer_count) || 0;
    answers += count;
    hits += Number(metric === 'citations' ? row.citation_answers : row.mentioning_answers) || 0;
  }
  return answers > 0 ? Math.round((hits / answers) * 1000) / 10 : null;
}

/** The first tracked day on or after its date against the days before it was set (above). */
async function fromTracking(db, job, now) {
  const target = job.target_json ?? {};
  const promptIds = Array.isArray(target.prompt_ids) ? target.prompt_ids.slice(0, 20) : [];
  if (!job.brand_id || promptIds.length === 0)
    return { outcome: 'not_measurable', reason: 'no_targets' };
  const platforms = Array.isArray(target.platforms) ? target.platforms : [];
  const metric = job.metric === 'citations' ? 'citations' : 'visibility';
  const rollups = async (from, to) => {
    let query = db
      .from('insights_prompt_daily')
      .select('day, prompt_id, platform, answer_count, mentioning_answers, citation_answers')
      .eq('brand_id', job.brand_id)
      .in('prompt_id', promptIds)
      .gte('day', from)
      .lte('day', to);
    if (platforms.length) query = query.in('platform', platforms);
    return check('rollups read', await query.order('day')) ?? [];
  };
  const setDay = utcDay(job.created_at);
  const dueDay = utcDay(job.due_at ?? job.next_run_at ?? now.toISOString());
  const after = await rollups(dueDay, addDays(dueDay, FIRST_DAY_WITHIN - 1));
  const firstDay = after[0]?.day ?? null;
  if (!firstDay) return null;
  const before = await rollups(addDays(setDay, -BASELINE_DAYS), addDays(setDay, -1));
  const was = shareOf(before, metric);
  const is = shareOf(
    after.filter((row) => row.day === firstDay),
    metric,
  );
  if (was === null || is === null) {
    return { outcome: 'not_measurable', reason: was === null ? 'no_baseline' : 'no_answers' };
  }
  const delta = Math.round((is - was) * 10) / 10;
  return {
    source: 'tracking',
    outcome:
      Math.abs(is - was) < MIN_EFFECT_PTS
        ? 'no_meaningful_change'
        : is > was
          ? 'improved'
          : 'declined',
    confidence: null,
    metric,
    before: was,
    after: is,
    delta,
    dataDay: firstDay,
    setDay,
  };
}

/** What the check found, or null when it should wait for its data. */
export async function evaluateFollowUp(db, job, now) {
  const ships = await shipsOf(db, job);
  if (ships.length) {
    const measured = await fromLedger(db, ships, now);
    if (measured) return measured;
  }
  const tracked = await fromTracking(db, job, now);
  if (tracked && tracked.outcome !== 'not_measurable') return tracked;
  // Nothing yet: wait for the data while the check is young, then say so.
  const due = Date.parse(job.due_at ?? job.next_run_at ?? now.toISOString());
  if (now.getTime() - due < WAIT_FOR_DATA_DAYS * DAY_MS && (ships.length || !tracked)) return null;
  return (
    tracked ?? {
      outcome: 'not_measurable',
      reason: ships.length ? 'not_measured' : 'no_tracking_run',
    }
  );
}

// ─── Its words ──────────────────────────────────────────────────────────────

const METRIC_WORDS = { visibility: 'Visibility', citations: 'Citations' };
const pts = (n) =>
  `${n > 0 ? '+' : ''}${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} pts`;
const pct = (n) => `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
const dayWords = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** The result's line, for the Inbox: "Improved · Visibility 32% → 41% (+9 pts)". */
export function resultLine(result) {
  const head = OUTCOME_WORDS[result.outcome] ?? OUTCOME_WORDS.not_measurable;
  if (result.before == null || result.after == null) return head;
  const delta = result.delta ?? Math.round((result.after - result.before) * 10) / 10;
  return `${head} · ${METRIC_WORDS[result.metric] ?? 'Visibility'} ${pct(result.before)} → ${pct(result.after)} (${pts(delta)})`;
}

/** The result's message in the chat that set the check (markdown). */
export function resultMessage(job, result) {
  const lines = [`**Follow-up check · ${job.title}: ${resultLine(result)}**`, ''];
  if (result.source === 'tracking') {
    lines.push(
      `The ${dayWords(result.dataDay)} tracking run against the ${BASELINE_DAYS} days before ${dayWords(result.setDay)}. Correlation, not causation.`,
    );
  } else if (result.source === 'ledger') {
    lines.push(
      `From the impact measurement of the change${result.checkpoint ? `, ${result.checkpoint.replace('d', 'day ')}` : ''}, against similar prompts it didn't touch.`,
    );
  } else {
    lines.push('There was no tracking data to read for it.');
  }
  lines.push('', 'Scheduled tracking data · no extra cost.');
  return lines.join('\n');
}

// ─── The run ────────────────────────────────────────────────────────────────

/** Writes the result: its run, the chat's message, the creator's notice, and the check closed. */
async function deliver(db, job, result, now) {
  const at = now.toISOString();
  const run = await db.from('chat_schedule_runs').insert({
    schedule_id: job.id,
    slot_at: job.due_at ?? job.next_run_at ?? at,
    attempt: 1,
    status: 'done',
    started_at: at,
    ended_at: at,
  });
  if (run.error && run.error.code !== '23505') throw new FollowUpDbError('run write', run.error);
  if (job.conversation_id) {
    check(
      'message write',
      await db.from('chat_messages').insert({
        conversation_id: job.conversation_id,
        role: 'assistant',
        content_md: resultMessage(job, result),
        generated_at: at,
        data_as_of: result.dataDay ? `${result.dataDay}T00:00:00.000Z` : null,
      }),
    );
    check(
      'chat touch',
      await db
        .from('chat_conversations')
        .update({ last_message_at: at })
        .eq('id', job.conversation_id),
    );
  }
  if (job.created_by) {
    const notice = await db.from('chat_notices').insert({
      organization_id: job.organization_id,
      user_id: job.created_by,
      kind: 'followup_result',
      payload: {
        scheduleId: job.id,
        title: job.title,
        reason: resultLine(result).slice(0, 200),
        conversationId: job.conversation_id ?? null,
      },
      dedupe_key: `followup:${job.id}`,
    });
    if (notice.error && notice.error.code !== '23505') {
      throw new FollowUpDbError('notice write', notice.error);
    }
  }
  check(
    'check close',
    await db.from('chat_schedules').update({ last_run_at: at }).eq('id', job.id),
  );
}

/**
 * One run (the hourly tick). Never throws: a check that fails is counted,
 * logged and tried again in RETRY_MS. With CHAT_AGENTIC off it reads and
 * writes nothing.
 *
 * @returns {Promise<{ due: number, done: number, waiting: number, failed: number }>}
 */
export async function runFollowUpChecks({ db = supabaseAdmin, now = new Date() } = {}) {
  const tally = { due: 0, done: 0, waiting: 0, failed: 0 };
  if (!chatAgenticDeployed()) return tally;
  let jobs;
  try {
    jobs = check(
      'due checks read',
      await db
        .from('chat_schedules')
        .select(COLUMNS)
        .eq('kind', 'followup_check')
        .eq('enabled', true)
        .lte('next_run_at', now.toISOString())
        .order('next_run_at', { ascending: true })
        .limit(TICK_ROWS),
    );
  } catch (err) {
    tally.failed++;
    logger.error({ err: errInfo(err) }, '[follow-ups] due checks not read');
    return tally;
  }
  const later = new Date(now.getTime() + RETRY_MS).toISOString();
  for (const job of (jobs ?? []).filter((j) => chatAgenticEnabled(j.organization_id))) {
    // Claimed from what was read: another server's run that read it too leaves it.
    const claimed = await db
      .from('chat_schedules')
      .update({ next_run_at: null })
      .eq('id', job.id)
      .eq('next_run_at', job.next_run_at)
      .select('id');
    if (claimed.error || (claimed.data ?? []).length === 0) continue;
    tally.due++;
    try {
      const result = await evaluateFollowUp(db, job, now);
      if (!result) {
        await db.from('chat_schedules').update({ next_run_at: later }).eq('id', job.id);
        tally.waiting++;
        continue;
      }
      await deliver(db, job, result, now);
      tally.done++;
    } catch (err) {
      tally.failed++;
      logger.error({ err: errInfo(err) }, '[follow-ups] check failed');
      await db.from('chat_schedules').update({ next_run_at: later }).eq('id', job.id);
    }
  }
  if (tally.due) logger.info(tally, '[follow-ups] run done');
  return tally;
}

/** Started with the server while CHAT_AGENTIC is on (server.js): hourly at FOLLOW_UP_SCHEDULE. */
export function startFollowUpChecks({
  schedule = FOLLOW_UP_SCHEDULE,
  run = runFollowUpChecks,
} = {}) {
  let running = false;
  cron.schedule(schedule, async () => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (err) {
      logger.error({ err: errInfo(err) }, '[follow-ups] run crashed');
    } finally {
      running = false;
    }
  });
  logger.info({ schedule }, '[follow-ups] hourly checks scheduled');
}
