import { supabaseAdmin } from '@/lib/supabase/admin';
import { promptLocationCount } from '@/lib/prompt-locations';
import { platformsToWait, settlePrompt, type SlottedPrompt } from '@/lib/prompt-slots';

/**
 * When a plan's prompt locations shrink (extra tracking removed or
 * refunded, a move to a smaller plan), the prompts past the new limit stop
 * being tracked: the newest ones wait for a spot (00535), as a prompt added
 * past the limit does. Owner decision 5 (2026-11-18). Nothing is deleted,
 * and a waiting prompt doesn't start by itself: the person picks which to
 * track again. Server only (service role): it runs from the Stripe webhook
 * and the billing routes.
 */

/** A tracked prompt as the trim reads it, newest first. */
export interface TrackedPrompt {
  id: string;
  regions: readonly unknown[] | null;
}

/**
 * The prompts that wait so the rest fit `maxLocations`: the newest first,
 * until what stays is within the limit. Pure.
 */
export function promptsToWait(
  newestFirst: readonly TrackedPrompt[],
  maxLocations: number,
): string[] {
  if (maxLocations < 0) return [];
  let total = newestFirst.reduce((sum, p) => sum + promptLocationCount(p.regions), 0);
  const waiting: string[] = [];
  for (const prompt of newestFirst) {
    if (total <= maxLocations) break;
    waiting.push(prompt.id);
    total -= promptLocationCount(prompt.regions);
  }
  return waiting;
}

const PAGE = 1000;
const CHUNK = 200;

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

/**
 * Makes the organization's newest tracked prompts wait until its tracked
 * locations fit `maxLocations` (-1: no limit, nothing waits). The demo
 * brand is never counted, as on the plan's own count (00390). Returns how
 * many now wait. Throws on a failed read or write.
 */
export async function waitOverCapacity(
  organizationId: string,
  maxLocations: number,
  now: Date = new Date(),
): Promise<number> {
  if (maxLocations < 0) return 0;
  const brands = unwrap(
    await supabaseAdmin
      .from('brands')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_demo', false),
  ) as { id: string }[];
  if (!brands.length) return 0;
  const sets = unwrap(
    await supabaseAdmin
      .from('prompt_sets')
      .select('id')
      .in(
        'brand_id',
        brands.map((b) => b.id),
      ),
  ) as { id: string }[];
  if (!sets.length) return 0;

  // Every tracked prompt, newest first, a page at a time (PostgREST caps a read).
  const tracked: TrackedPrompt[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = unwrap(
      await supabaseAdmin
        .from('prompts')
        .select('id, regions')
        .in(
          'prompt_set_id',
          sets.map((s) => s.id),
        )
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1),
    ) as TrackedPrompt[];
    tracked.push(...page);
    if (page.length < PAGE) break;
  }

  const waiting = promptsToWait(tracked, maxLocations);
  for (let i = 0; i < waiting.length; i += CHUNK) {
    unwrap(
      await supabaseAdmin
        .from('prompts')
        .update({ is_active: false, waiting_since: now.toISOString() })
        .in('id', waiting.slice(i, i + CHUNK))
        .eq('is_active', true)
        .select('id'),
    );
  }
  return waiting.length;
}

/** The organization's tracked prompts, newest first, as `columns` reads them. */
async function trackedPrompts<T>(organizationId: string, columns: string): Promise<T[]> {
  const brands = unwrap(
    await supabaseAdmin
      .from('brands')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_demo', false),
  ) as { id: string }[];
  if (!brands.length) return [];
  const sets = unwrap(
    await supabaseAdmin
      .from('prompt_sets')
      .select('id')
      .in(
        'brand_id',
        brands.map((b) => b.id),
      ),
  ) as { id: string }[];
  if (!sets.length) return [];
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = unwrap(
      await supabaseAdmin
        .from('prompts')
        .select(columns)
        .in(
          'prompt_set_id',
          sets.map((s) => s.id),
        )
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1),
    ) as T[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/**
 * Makes the platforms over their tracking slots wait (00564): on each
 * platform past its slots, the newest prompts' locations move to
 * waiting_platforms until the rest fit. Nothing is deleted. A prompt left
 * with nothing to run waits as a whole (00535). `slots` absent: no
 * per-platform limit, nothing waits. Returns how many prompts changed.
 * Server only (service role). Throws on a failed read or write.
 */
export async function waitOverSlots(
  organizationId: string,
  slots: Readonly<Record<string, number>> | undefined,
  now: Date = new Date(),
): Promise<number> {
  if (!slots) return 0;
  const tracked = await trackedPrompts<SlottedPrompt>(
    organizationId,
    'id, platforms, waiting_platforms, models, regions',
  );
  const moves = platformsToWait(tracked, slots);
  if (!moves.size) return 0;

  // Prompts that end the same way are written together.
  const groups = new Map<string, { ids: string[]; patch: Record<string, unknown> }>();
  for (const prompt of tracked) {
    const waiting = moves.get(prompt.id);
    if (!waiting) continue;
    const settled = settlePrompt(prompt, waiting);
    const patch: Record<string, unknown> = {
      platforms: settled.platforms,
      waiting_platforms: settled.waiting_platforms,
      ...(settled.idle ? { is_active: false, waiting_since: now.toISOString() } : {}),
    };
    const key = JSON.stringify(patch);
    const group = groups.get(key) ?? { ids: [], patch };
    group.ids.push(prompt.id);
    groups.set(key, group);
  }
  for (const { ids, patch } of groups.values()) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      unwrap(
        await supabaseAdmin
          .from('prompts')
          .update(patch)
          .in('id', ids.slice(i, i + CHUNK))
          .eq('is_active', true)
          .select('id'),
      );
    }
  }
  return moves.size;
}

/**
 * waitOverSlots after a change that adds tracking (a new or resumed prompt,
 * more locations), logged rather than thrown: the change itself is saved,
 * and the next one settles what this one couldn't.
 */
export async function settleSlots(
  organizationId: string,
  slots: Readonly<Record<string, number>> | undefined,
): Promise<void> {
  if (!slots) return;
  try {
    const waiting = await waitOverSlots(organizationId, slots);
    if (waiting) console.log(`[slots] ${waiting} prompt(s) now wait on a platform past its slots`);
  } catch (err) {
    console.error('[slots] Platforms past their slots not set waiting:', err);
  }
}
