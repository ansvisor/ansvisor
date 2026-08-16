/**
 * Job runner — orchestrates async job execution with concurrency
 * control, retry logic, and Socket.IO notifications.
 * Replaces Bull's queue.process() mechanism.
 */

import {
  getJob,
  markJobActive,
  completeJob,
  failJob,
  updateJobProgress,
  registerActiveJob,
  unregisterActiveJob,
} from './job-manager.js';
import { processTrackingJob } from '../workers/tracking-worker.js';
import { processContentJob } from '../workers/content-worker.js';
import { generatePulseForBrand } from './pulse/engine.js';
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
export async function runTrackingJob(jobId, io) {
  if (activeTrackingCount >= MAX_CONCURRENT_TRACKING) {
    setTimeout(() => runTrackingJob(jobId, io), 5000);
    return;
  }

  const jobRow = await getJob(jobId);
  if (!jobRow || jobRow.status === 'cancelled') return;

  activeTrackingCount++;
  const abortController = new AbortController();
  registerActiveJob(jobId, abortController);

  try {
    await markJobActive(jobId);

    const { brandId, promptId, promptIds, immediate } = jobRow.data;
    const proxy = createJobProxy(jobId, abortController.signal);

    const result = await processTrackingJob({
      brandId,
      promptId,
      promptIds,
      source: immediate ? 'manual' : 'cron',
      job: proxy,
    });

    await completeJob(jobId, result);

    if (io) {
      io.emit('tracking:complete', {
        brandId,
        resultCount: result.resultCount,
        immediate: !!immediate,
      });
    }

    // Daily Pulse (#540): fire-and-forget after a full daily run — never
    // for immediate/manual runs or single-prompt refreshes. The engine is
    // self-contained: eligibility checks, dedup and error handling inside.
    //
    // Skipped when the run wasn't stamped (#702). An unstamped run left the
    // 24h anchor on the previous run, so the pulse would recompute that same
    // window and mail figures the recipient already received — which is
    // exactly what happened for three days on the largest brand. The catch-up
    // sweep picks the day back up once a run does stamp.
    if (!immediate && !promptId && !promptIds?.length) {
      if (result?.stamped) {
        generatePulseForBrand(brandId).catch((err) => {
          logger.error({ err, brandId }, 'daily pulse trigger failed');
        });
      } else {
        logger.warn(
          { brandId, resultCount: result?.resultCount },
          'skipping daily pulse — tracking run was not stamped, window would be stale',
        );
      }
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

      setTimeout(() => runTrackingJob(jobId, io), delay);
    } else {
      await failJob(jobId, err.message);
    }
  } finally {
    unregisterActiveJob(jobId);
    activeTrackingCount--;
  }
}

/**
 * Run a content generation job. Call without await (fire-and-forget).
 */
export async function runContentJob(jobId, io) {
  if (activeContentCount >= MAX_CONCURRENT_CONTENT) {
    setTimeout(() => runContentJob(jobId, io), 5000);
    return;
  }

  const jobRow = await getJob(jobId);
  if (!jobRow || jobRow.status === 'cancelled') return;

  activeContentCount++;
  const abortController = new AbortController();
  registerActiveJob(jobId, abortController);

  try {
    await markJobActive(jobId);

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

      setTimeout(() => runContentJob(jobId, io), delay);
    } else {
      await failJob(jobId, err.message);
    }
  } finally {
    unregisterActiveJob(jobId);
    activeContentCount--;
  }
}
