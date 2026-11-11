import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseRange, type ChatRange } from './range';

/**
 * A person's Chat date range on chat_user_prefs.date_range (00528), as the
 * engine reads and keeps it with the service role: read once a request, kept
 * when the person answers the range card or sends a short range. Server only.
 */

/** The person's range; `available` false when it can't be read (00528 not applied, a failed read). */
export interface SavedRange {
  range: ChatRange | null;
  available: boolean;
}

/**
 * The person's default range: null when they haven't picked one. A read
 * that fails, or a database without the column yet, is not available: Chat
 * then reads its fallback range and asks nothing, rather than asking on
 * every analysis a range it can't keep.
 */
export async function readSavedRange(userId: string): Promise<SavedRange> {
  const { data, error } = await supabaseAdmin
    .from('chat_user_prefs')
    .select('date_range')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[chat/range] could not read the date range:', error.message);
    return { range: null, available: false };
  }
  const value = (data as { date_range?: string | null } | null)?.date_range;
  return { range: parseRange(value), available: true };
}

/** Keeps the person's default range; false when it couldn't be kept. Never throws. */
export async function saveRange(userId: string, range: ChatRange): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from('chat_user_prefs')
      .upsert({ user_id: userId, date_range: range }, { onConflict: 'user_id' });
    if (error) {
      console.error('[chat/range] could not keep the date range:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[chat/range] could not keep the date range:', err);
    return false;
  }
}
