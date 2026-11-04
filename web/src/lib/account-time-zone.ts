import { supabaseAdmin } from '@/lib/supabase/admin';
import { effectiveTimeZone, isTimeZone } from '@/lib/time-zone';

/**
 * The time zone a person picked in Settings › Account (profiles.time_zone,
 * 00468), read with the service role on the server: null for Automatic
 * (their browser's), and for a zone this runtime doesn't know. A read that
 * fails is logged and counts as Automatic, so a run never stops over it.
 */
export async function readChosenTimeZone(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('time_zone')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[time-zone] could not read the person’s time zone:', error.message);
    return null;
  }
  const chosen = (data as { time_zone?: string | null } | null)?.time_zone;
  return isTimeZone(chosen) ? chosen : null;
}

/**
 * The zone a person's new Chat run reads its times in: their pick, else the
 * zone their browser sent, else UTC (effectiveTimeZone). A schedule card
 * shows it, and the job it makes keeps it.
 */
export async function personTimeZone(
  userId: string,
  browserZone: string | null | undefined,
): Promise<string> {
  return effectiveTimeZone(await readChosenTimeZone(userId), browserZone);
}
