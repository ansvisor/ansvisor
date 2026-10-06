/**
 * Job runner — orchestrates async job execution with concurrency
 * control, retry logic, and Socket.IO notifications.
 * Replaces Bull's queue.process() mechanism.
 */

import {
  getJob,
  claimWaitingJob,
  listWaitingJobs,
  completeJob,
  failJob,
  updateJobProgress,
  registerActiveJob,
  unregisterActiveJob,
} from './job-manager.js';
import { processTrackingJob } from '../workers/tracking-worker.js';
import { processContentJob } from '../workers/content-worker.js';
import { generatePulseForBrand } from './pulse/engine.js';
import { runFirstSignalPass, runSignalPass } from './signals/pass.js';
import logger from './logger.js';

// Concurrency counters (the default of 2 per queue is inherited from the Bull
// setup this replaced). Tracking jobs spend almost all of their time waiting on
// scraper callbacks rather than burning CPU, so the ceiling mostly decides how
// many brands sit in the nightly queue behind each other — raise it to shorten
// the cycle, watching memory on small instances.
let activeTrackingCount = 0;
const MAX_CONCURRENT_TRACKING = Number(process.env.TRACKING_CONCURRENCY) || 2;
let activeContentCount = 0;
const MAX_CONCURRENT_CONTENT = 2;

// Jobs with a live run chain in this process: waiting for a slot, waiting to
// retry, or running. The queue lives only in memory, so a job whose chain is
// lost — a restart, an error before it got a slot — would sit in 'waiting'
// forever; the recovery sweep restarts those, and this set keeps it from
// starting a second chain for a job this process is still handling.
const queuedJobs = new Set();

// The sweep leaves a job alone for its first minutes (the call that created
// it starts it) and gives up on it after 20h, when the next night's run has
// either started or is about to.
const RECOVERY_IDLE_MS = 2 * 60_000;
const RECOVERY_MAX_AGE_MS = 20 * 60 * 60_000;

/**
 * Create a mock job object that mirrors the Bull job interface
 * used by processTrackingJob / processContentJob.
 */
function createJobProxy(jobId, signal) {
  return {
    progress: (data) => updateJobProgress(jobId, data),
    signal,
  };
}

/**
 * Run a tracking job. Call without await (fire-and-forget).
 * Handles concurrency gating, retry, and Socket.IO emit.
 */
export function runTrackingJob(jobId, io) {
  if (queuedJobs.has(jobId)) return;
  queuedJobs.add(jobId);
  void attemptTrackingJob(jobId, io);
}

async function attemptTrackingJob(jobId, io) {
  if (activeTrackingCount >= MAX_CONCURRENT_TRACKING) {
    setTimeout(() => attemptTrackingJob(jobId, io), 5000);
    return;
  }

  // Take the slot before the first await. Otherwise every timer that fires
  // while the claim is in flight sees the same free slot, and a night once
  // ran nine jobs against a limit of three.
  activeTrackingCount++;
  const jobRow = await claimWaitingJob(jobId);
  if (!jobRow) {
    activeTrackingCount--;
    queuedJobs.delete(jobId);
    return;
  }

  const abortController = new AbortController();
  registerActiveJob(jobId, abortController);
  let retrying = false;

  try {
    const { brandId, promptId, promptIds, immediate } = jobRow.data;
    const proxy = createJobProxy(jobId, abortController.signal);

    const result = await processTrackingJob({
      brandId,
      promptId,
      promptIds,
      source: immediate ? 'manual' : 'cron',
      job: proxy,
    });

    // The late-stamp promise is not job state; only the counts are stored.
    const { lateStamp, ...stored } = result;
    await completeJob(jobId, stored);

    if (io) {
      io.emit('tracking:complete', {
        brandId,
        resultCount: result.resultCount,
        immediate: !!immediate,
      });
    }

    const fullRun = !promptId && !promptIds?.length;

    // What a full run's stamp sets off. The run may stamp now, or later once
    // Cloro's late answers arrive (lib/run-settlement) — either way this runs
    // exactly once, after the stamp, so it reads the finished window.
    const afterStamp = () => {
      if (!fullRun) return;
      if (!immediate) {
        // Daily Pulse (#540): after a full daily run only — never for manual
        // runs or single-prompt refreshes. The engine is self-contained:
        // eligibility checks, dedup and error handling inside.
        generatePulseForBrand(brandId).catch((err) => {
          logger.error({ err, brandId }, 'daily pulse trigger failed');
        });
        // Signal recording (Action Center) rides the same trigger but is
        // deliberately NOT inside the pulse engine: signals are a product
        // surface, so a brand with pulse emails off still gets them.
        //
        // Still fire-and-forget, but no longer forgettable: the pass logs
        // itself against the run it covered, and the nightly catch-up sweep
        // re-runs whatever has no row. A failure here costs the brand a few
        // hours now, not the night.
        runSignalPass(brandId).catch((err) => {
          logger.error({ err, brandId }, '[signals] pass failed — catch-up will retry');
        });
      } else {
        // A new brand's first run is a manual one, and passes otherwise wait
        // for the night. It gets one now so the Action Center is not empty
        // until tomorrow; the function is a no-op for a brand that already
        // had one.
        runFirstSignalPass(brandId).catch((err) => {
          logger.error(
            { err, brandId },
            '[signals] first pass failed — the nightly pass will cover it',
          );
        });
      }
    };

    // Skipped when the run never stamps (#702). An unstamped run left the 24h
    // anchor on the previous run, so the pulse would recompute that same
    // window and mail figures the recipient already received. The catch-up
    // sweep picks the day back up once a run does stamp.
    if (result?.stamped) {
      afterStamp();
    } else if (lateStamp) {
      lateStamp.then((stamped) => {
        if (stamped) afterStamp();
        else if (fullRun && !immediate) {
          logger.warn({ brandId }, 'skipping daily pulse — tracking run never stamped');
        }
      });
    } else if (fullRun && !immediate) {
      logger.warn(
        { brandId, resultCount: result?.resultCount },
        'skipping daily pulse — tracking run was not stamped, window would be stale',
      );
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      logger.info({ jobId }, 'tracking job was cancelled');
      return;
    }

    logger.error({ err, jobId }, 'tracking job failed');

    // Re-fetch to get latest attempts count
    const latest = await getJob(jobId);
    if (latest && latest.attempts < latest.max_attempts) {
      const delay = latest.attempts * 30_000; // exponential-ish backoff
      logger.info(
        { jobId, delayMs: delay, attempt: latest.attempts, attempts: latest.max_attempts },
        'retrying tracking job',
      );

      await failJob(jobId, err.message);
      // Reset to waiting for retry
      const supabaseAdmin = (await import('../config/supabase.js')).default;
      await supabaseAdmin
        .from('jobs')
        .update({ status: 'waiting', updated_at: new Date().toISOString() })
        .eq('id', jobId);

      retrying = true;
      setTimeout(() => attemptTrackingJob(jobId, io), delay);
    } else {
      await failJob(jobId, err.message);
    }
  } finally {
    unregisterActiveJob(jobId);
    activeTrackingCount--;
    if (!retrying) queuedJobs.delete(jobId);
  }
}

/**
 * Run a content generation job. Call without await (fire-and-forget).
 */
export function runContentJob(jobId, io) {
  if (queuedJobs.has(jobId)) return;
  queuedJobs.add(jobId);
  void attemptContentJob(jobId, io);
}

async function attemptContentJob(jobId, io) {
  if (activeContentCount >= MAX_CONCURRENT_CONTENT) {
    setTimeout(() => attemptContentJob(jobId, io), 5000);
    return;
  }

  // Slot before the first await — see attemptTrackingJob.
  activeContentCount++;
  const jobRow = await claimWaitingJob(jobId);
  if (!jobRow) {
    activeContentCount--;
    queuedJobs.delete(jobId);
    return;
  }

  const abortController = new AbortController();
  registerActiveJob(jobId, abortController);
  let retrying = false;

  try {
    const { brandId, model } = jobRow.data;
    const proxy = createJobProxy(jobId, abortController.signal);

    const result = await processContentJob({ brandId, model, job: proxy });

    await completeJob(jobId, result);

    if (io) {
      io.emit('content:generated', {
        brandId,
        generated: result.generated,
      });
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      logger.info({ jobId }, 'content job was cancelled');
      return;
    }

    logger.error({ err, jobId }, 'content job failed');

    const latest = await getJob(jobId);
    if (latest && latest.attempts < latest.max_attempts) {
      const delay = latest.attempts * 15_000;
      logger.info(
        { jobId, delayMs: delay, attempt: latest.attempts, attempts: latest.max_attempts },
        'retrying content job',
      );

      await failJob(jobId, err.message);
      const supabaseAdmin = (await import('../config/supabase.js')).default;
      await supabaseAdmin
        .from('jobs')
        .update({ status: 'waiting', updated_at: new Date().toISOString() })
        .eq('id', jobId);

      retrying = true;
      setTimeout(() => attemptContentJob(jobId, io), delay);
    } else {
      await failJob(jobId, err.message);
    }
  } finally {
    unregisterActiveJob(jobId);
    activeContentCount--;
    if (!retrying) queuedJobs.delete(jobId);
  }
}

/**
 * Restart waiting jobs that have no run chain in this process. Runs at
 * startup and every minute (server.js). Returns how many it restarted.
 */
export async function recoverWaitingJobs(io) {
  const jobs = await listWaitingJobs({
    idleMs: RECOVERY_IDLE_MS,
    maxAgeMs: RECOVERY_MAX_AGE_MS,
  });

  let recovered = 0;
  for (const job of jobs) {
    if (queuedJobs.has(job.id)) continue;
    if (job.type === 'tracking') runTrackingJob(job.id, io);
    else if (job.type === 'content') runContentJob(job.id, io);
    else continue;
    recovered++;
  }

  if (recovered > 0) logger.warn({ recovered }, 'restarted waiting jobs that had no run chain');
  return recovered;
}
