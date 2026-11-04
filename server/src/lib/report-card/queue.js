import cron from 'node-cron';
import logger from '../logger.js';
import { estimatedCardUsd, reportCardLimits } from './config.js';
import { buildReportCard, costMeter, failureReason } from './run.js';
import { reportCardStore } from './store.js';

/**
 * The report card queue (REPORT-CARD §7), on the cloud server only: every
 * minute it starts the cards that are due, REPORT_CARD_CONCURRENCY at a
 * time, within the day's cap and the month's budget; a card the cap stops
 * waits for the next tick. A run lost to a restart is taken again once, then
 * failed. Daily, the requests older than 12 months are deleted.
 */

export const QUEUE_SCHEDULE = '* * * * *';
export const PRUNE_SCHEDULE = '23 3 * * *';
/** A run still "running" after this was lost (a restart): it goes again, or fails. */
export const STALE_MS = 60 * 60 * 1000;
/**
 * How long a run may ask the engines: well below STALE_MS, so a slow run
 * (100 tasks, 12 in flight, up to 15 minutes an answer) ends before the
 * tick takes it as lost and starts a second, paid copy next to it.
 */
export const RUN_DEADLINE_MS = 40 * 60 * 1000;
/** How often a card is tried before it fails for good. */
export const MAX_ATTEMPTS = 2;
const KEEP_REQUESTS_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (now) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const startOfMonth = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * Runs one claimed card to its end: ready with its figures, or failed with
 * why, with what it cost either way. It asks the engines until
 * RUN_DEADLINE_MS, and writes only while the card is still this attempt's
 * (finishCard), so a run the tick took as lost can't overwrite the next.
 */
export async function runCard(
  card,
  { store = reportCardStore(), build = buildReportCard, now = () => new Date() } = {},
) {
  const meter = costMeter();
  const deadline = now().getTime() + RUN_DEADLINE_MS;
  try {
    const inputs = await store.cardInputs(card.id);
    const { payload, questions } = await build(
      {
        companyName: card.company_name,
        domain: card.domain,
        site: card.site,
        country: card.country,
        language: card.language,
        industry: inputs.industry,
        dealValue: inputs.dealValue,
      },
      { meter, deadline },
    );
    await store.finishCard(card.id, card.attempts, {
      status: 'ready',
      payload,
      questions,
      cost_usd: Math.round(meter.total() * 10_000) / 10_000,
      finished_at: now().toISOString(),
      error: null,
    });
    logger.info({ cardId: card.id, costUsd: meter.total() }, '[report-card] card ready');
    return 'ready';
  } catch (err) {
    logger.error({ err, cardId: card.id }, '[report-card] card failed');
    await store
      .finishCard(card.id, card.attempts, {
        status: 'failed',
        cost_usd: Math.round(meter.total() * 10_000) / 10_000,
        finished_at: now().toISOString(),
        error: failureReason(err),
      })
      .catch((finishErr) => logger.error({ err: finishErr }, '[report-card] not marked failed'));
    return 'failed';
  }
}

/**
 * One tick: lost runs released, then due cards started while there's room.
 * Answers the cards started; their runs go on past the tick.
 */
export async function tickReportCards({
  store = reportCardStore(),
  limits = reportCardLimits(),
  now = new Date(),
  run = runCard,
} = {}) {
  const running = await store.runningCards();
  let busy = 0;
  for (const card of running) {
    if (now.getTime() - new Date(card.started_at).getTime() < STALE_MS) {
      busy += 1;
      continue;
    }
    await store.releaseCard(
      card.id,
      card.attempts,
      card.attempts < MAX_ATTEMPTS
        ? { status: 'queued', started_at: null }
        : {
            status: 'failed',
            finished_at: now.toISOString(),
            error: 'The run was lost (a restart) on its last try',
          },
    );
  }

  const started = [];
  let today = await store.startedSince(startOfDay(now));
  while (busy + started.length < limits.concurrency && today < limits.dailyCap) {
    const { spent } = await store.spendSince(startOfMonth(now));
    if (spent + estimatedCardUsd(limits) > limits.monthlyBudgetUsd) {
      logger.warn({ spent }, '[report-card] the month’s budget is spent: no card starts');
      break;
    }
    const card = await store.claimNext(now);
    if (!card) break;
    started.push(card.id);
    today += 1;
    run(card, { store }).catch((err) => logger.error({ err }, '[report-card] run crashed'));
  }
  return started;
}

/** Deletes the requests kept longer than 12 months. */
export async function pruneReportCardRequests({
  store = reportCardStore(),
  now = new Date(),
} = {}) {
  const deleted = await store.pruneRequests(new Date(now.getTime() - KEEP_REQUESTS_DAYS * DAY_MS));
  if (deleted) logger.info({ deleted }, '[report-card] old requests deleted');
  return deleted;
}

/**
 * Starts the minute tick and the daily prune; one tick at a time. Answers
 * the cron tasks.
 *
 * @param {typeof cron.schedule} [schedule]
 */
export function startReportCardQueue(schedule = cron.schedule) {
  let ticking = false;
  const tick = schedule(QUEUE_SCHEDULE, async () => {
    if (ticking) return;
    ticking = true;
    try {
      await tickReportCards();
    } catch (err) {
      logger.error({ err }, '[report-card] the tick failed');
    } finally {
      ticking = false;
    }
  });
  const prune = schedule(PRUNE_SCHEDULE, () =>
    pruneReportCardRequests().catch((err) => logger.error({ err }, '[report-card] prune failed')),
  );
  logger.info({ schedule: QUEUE_SCHEDULE }, '[report-card] queue active');
  return [tick, prune];
}
