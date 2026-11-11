'use server';

import { createClient } from '@/lib/supabase/server';
import { mapSignalRows, SIGNAL_ROW_COLUMNS, type Signal, type SignalRow } from '@/lib/signals/map';
import { OPEN_SIGNAL_STATUSES, type SignalStatus } from '@/lib/signals/registry';
import { pickChanges, sinceStart } from '@/lib/action-center/since';

/** Today's "Since yesterday": where it starts, and the changes to list. */
export interface TodayChanges {
  /** The window's start: the earlier of the last visit and the latest nightly run's start. */
  since: string;
  /** The biggest high and medium impact changes, at most 5. */
  items: Signal[];
  /** Every high and medium impact change in the window. */
  total: number;
  /** The low impact ones: "Small moves are in all signals". */
  small: number;
}

/**
 * "Since yesterday" on Action Center › Today: the brand's open
 * signals (new or acknowledged) found or found again since the person's
 * last visit or the latest nightly run's start, whichever is earlier, at
 * most a week back (lib/action-center/since.ts). `hidden` is the person's
 * menu sections that are off: their signals aren't listed. Read as the
 * person (RLS), no new table; throws on a failed read, and Today then
 * shows itself without the part.
 */
export async function getTodayChanges(
  brandId: string,
  seenAt: string | null,
  hidden: string[],
): Promise<TodayChanges> {
  const supabase = await createClient();
  const nightly = await supabase
    .from('tracking_runs')
    .select('started_at')
    .eq('brand_id', brandId)
    .eq('source', 'cron')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (nightly.error) throw new Error(nightly.error.message);
  const since = sinceStart({
    seenAt,
    nightlyStart: (nightly.data?.started_at as string | undefined) ?? null,
    now: new Date(),
  });

  const { data, error } = await supabase
    .from('signals')
    .select(SIGNAL_ROW_COLUMNS)
    .eq('brand_id', brandId)
    .in('status', OPEN_SIGNAL_STATUSES as SignalStatus[])
    .or(`detected_at.gte.${since},last_detected_at.gte.${since}`)
    .order('last_detected_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const picked = pickChanges(mapSignalRows((data ?? []) as SignalRow[]), new Set(hidden));
  return { since, ...picked };
}
