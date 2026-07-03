/**
 * Supabase-based job manager — replaces Bull/Redis queue.
 * Provides CRUD operations for the `jobs` table and in-memory
 * AbortController tracking for cancellation support.
 */

import supabaseAdmin from '../config/supabase.js';
import logger from './logger.js';

/** @type {Map<string, AbortController>} */
const activeJobs = new Map();

/**
 * Insert a new job row and return it.
 * @param {{ type: 'tracking'|'content', brandId: string, data: object, maxAttempts?: number }} opts
 */
export async function createJob({ type, brandId, data, maxAttempts }) {
  const { data: job, error } = await supabaseAdmin
    .from('jobs')
    .insert({
      type,
      brand_id: brandId,
      data: data || {},
      max_attempts: maxAttempts ?? (type === 'tracking' ? 3 : 2),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create job: ${error.message}`);
  return job;
}

/**
 * Update job progress (called from workers during execution).
 */
export async function updateJobProgress(jobId, progress) {
  const { error } = await supabaseAdmin
    .from('jobs')
    .update({ progress, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  if (error) logger.error({ err: error, jobId }, 'failed to update job progress');
}

/**
 * Mark a job as completed with its result.
 */
export async function completeJob(jobId, result) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('jobs')
    .update({
      status: 'completed',
      result,
      completed_at: now,
      updated_at: now,
    })
    .eq('id', jobId);

  if (error) logger.error({ err: error, jobId }, 'failed to complete job');
}

/**
 * Mark a job as failed.
 */
export async function failJob(jobId, reason) {
  const { error } = await supabaseAdmin
    .from('jobs')
    .update({
      status: 'failed',
      failed_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) logger.error({ err: error, jobId }, 'failed to fail job');
}

/**
 * Mark a job as active and increment attempts.
 */
export async function markJobActive(jobId) {
  const now = new Date().toISOString();

  // Use rpc-free approach: fetch then update
  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('attempts')
    .eq('id', jobId)
    .single();

  const { error } = await supabaseAdmin
    .from('jobs')
    .update({
      status: 'active',
      started_at: now,
      updated_at: now,
      attempts: (job?.attempts || 0) + 1,
    })
    .eq('id', jobId);

  if (error) logger.error({ err: error, jobId }, 'failed to mark job active');
}

/**
 * Fetch a single job by ID. Returns null if not found.
 */
export async function getJob(jobId) {
  const { data: job, error } = await supabaseAdmin
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) return null;
  return job;
}

/**
 * Cancel a job — updates DB status and aborts in-memory signal.
 */
export async function cancelJob(jobId) {
  const { error } = await supabaseAdmin
    .from('jobs')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) logger.error({ err: error, jobId }, 'failed to cancel job');

  const controller = activeJobs.get(jobId);
  if (controller) controller.abort();
}

/** Register an active job's AbortController. */
export function registerActiveJob(jobId, abortController) {
  activeJobs.set(jobId, abortController);
}

/** Unregister a finished job. */
export function unregisterActiveJob(jobId) {
  activeJobs.delete(jobId);
}

/** Check if a job has been cancelled via its abort signal. */
export function isJobCancelled(jobId) {
  const controller = activeJobs.get(jobId);
  return controller ? controller.signal.aborted : false;
}

/**
 * On server startup, mark any leftover 'active' jobs as failed.
 */
export async function cleanupStaleJobs() {
  const { data, error } = await supabaseAdmin
    .from('jobs')
    .update({
      status: 'failed',
      failed_reason: 'Server restarted during execution',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'active')
    .select('id');

  if (error) {
    logger.error({ err: error }, 'failed to cleanup stale jobs');
  } else if (data && data.length > 0) {
    logger.info({ count: data.length }, 'cleaned up stale active jobs');
  }
}

/**
 * Delete jobs older than 7 days. Call from daily cron.
 */
export async function cleanupOldJobs() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin.from('jobs').delete().lt('created_at', cutoff);

  if (error) {
    logger.error({ err: error }, 'failed to cleanup old jobs');
  }
}

/**
 * Delete orphaned Cloro pending tasks — rows for which Cloro never delivered a
 * webhook. They sit forever otherwise; left unchecked they accumulate and (with
 * a brand-wide count) used to poison every future run's drain loop. Two hours is
 * well past the worker's 60-minute drain deadline and any realistic Cloro
 * delivery window, so anything older is safe to drop.
 */
export async function cleanupStalePendingTasks() {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from('cloro_pending_tasks')
    .delete({ count: 'exact' })
    .lt('submitted_at', cutoff);

  if (error) {
    logger.error({ err: error }, 'failed to cleanup stale pending tasks');
  } else if (count && count > 0) {
    logger.info({ count }, 'cleaned up orphaned cloro pending tasks');
  }
}
