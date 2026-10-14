/**
 * Following a content generation job to its end, for callers that started
 * one and want its outcome ("Suggest content" in the prompts table). The
 * status reader is passed in, so the waiting rules are tested without a
 * server.
 */

import type { GenerationJobStatus } from '@/lib/actions/content';

export type ContentJobOutcome =
  | { kind: 'completed'; result: NonNullable<GenerationJobStatus['result']> }
  | { kind: 'failed'; reason: string | null }
  /** Still running when we stopped waiting: it may yet finish. */
  | { kind: 'timeout' };

export async function waitForContentJob(
  jobId: string,
  {
    getStatus,
    intervalMs = 3000,
    timeoutMs = 3 * 60 * 1000,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now = () => Date.now(),
  }: {
    getStatus: (jobId: string) => Promise<GenerationJobStatus>;
    intervalMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<ContentJobOutcome> {
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    await sleep(intervalMs);
    // A status the reader can't get ('not_found', or a call that throws) is
    // a blip: keep waiting.
    const status = await getStatus(jobId).catch(() => null);
    if (!status) continue;
    if (status.status === 'completed') {
      return { kind: 'completed', result: status.result ?? { generated: 0 } };
    }
    if (status.status === 'failed') return { kind: 'failed', reason: status.failedReason };
  }
  return { kind: 'timeout' };
}
