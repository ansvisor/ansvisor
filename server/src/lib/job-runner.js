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
import logger from './logger.js';

// Concurrency counters (matches previous Bull concurrency of 2 per queue)
let activeTrackingCount = 0;
const MAX_CONCURRENT_TRACKING = 2;
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

    const result = await processTrackingJob({ brandId, promptId, promptIds, job: proxy });

    await completeJob(jobId, result);

    if (io) {
      io.emit('tracking:complete', {
        brandId,
        resultCount: result.resultCount,
        immediate: !!immediate,
      });
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
