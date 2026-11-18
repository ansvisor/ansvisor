import type * as prompt from '@/lib/actions/prompt';
import type * as volumes from '@/lib/actions/volumes';
import type { VolumeAnalysisStatus } from '@/lib/actions/volumes';

/**
 * Tracked Prompts' reads, from the browser, through one route
 * (/api/prompts/read) rather than as server actions: the table's rows
 * (getPromptsPageData, with its columns, its Improve links and Track now's
 * prompts) and, beside them, the volumes with the volume run's status.
 *
 * Next runs a page's server actions one at a time, so the table's read used
 * to wait for every action sent before it: the menu's dots, the page's
 * column views, the content quota, the first run's status. A fetch to a
 * route runs alongside them. Each function keeps its server action's name
 * and arguments; the route calls that action with the member's session.
 * The same pattern as the Visibility tabs' (visibility-reads.ts).
 */

/** The reads, by name: /api/prompts/read takes these. */
type PromptsRead = 'pageData' | 'volumes';

async function read<T>(name: PromptsRead, args: unknown[]): Promise<T> {
  const res = await fetch('/api/prompts/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ read: name, args }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok) throw new Error(body.error || `Failed to load ${name}`);
  return body.data as T;
}

export const readPromptsPageData = (
  ...args: Parameters<typeof prompt.getPromptsPageData>
): ReturnType<typeof prompt.getPromptsPageData> => read('pageData', args);

/** The brand's volumes and quota, and whether an analysis is running (null when unread). */
export type PromptVolumesRead = Awaited<ReturnType<typeof volumes.getPromptVolumes>> & {
  status: VolumeAnalysisStatus | null;
};

export const readPromptVolumes = (
  ...args: Parameters<typeof volumes.getPromptVolumes>
): Promise<PromptVolumesRead> => read('volumes', args);

/**
 * How many times a failed volumes read is tried again, at once, before the
 * page says the volumes are unavailable: a first read that hits a blip
 * otherwise left every Volume cell empty and every prompt "not analyzed"
 * until the range was changed. Tracked Prompts, Insights and Similar Topics.
 */
export const VOLUME_READ_RETRIES = 1;
