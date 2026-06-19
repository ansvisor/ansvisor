const TRACKING_STORAGE_KEY = 'aeo:tracking-job';

export interface TrackingJob {
  jobId: string;
  brandId: string;
  startedAt: number;
}

export function saveTrackingJob(job: TrackingJob) {
  try {
    localStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(job));
  } catch {}
}

export function loadTrackingJob(): TrackingJob | null {
  try {
    const raw = localStorage.getItem(TRACKING_STORAGE_KEY);
    if (!raw) return null;
    const job = JSON.parse(raw) as TrackingJob;
    // Large brands legitimately take ~45 min to finish; keep restoring the
    // progress banner across refreshes until the worker's 60-min drain deadline.
    if (Date.now() - job.startedAt > 60 * 60 * 1000) {
      localStorage.removeItem(TRACKING_STORAGE_KEY);
      return null;
    }
    return job;
  } catch {
    return null;
  }
}

export function clearTrackingJob() {
  try {
    localStorage.removeItem(TRACKING_STORAGE_KEY);
  } catch {}
}
