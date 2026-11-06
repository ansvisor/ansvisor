type Reader = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

/** Where the person's product tour stands (00486), as the side panel reads it. */
export interface TourPrefs {
  tour_chat_id: string | null;
  tour_topic: string | null;
  tour_finished_at: string | null;
}

/**
 * The person's tour for the dashboard layout's side panel; null when it
 * can't be read (a database without 00486's columns yet). A tour chat
 * deleted or archived mid-tour is dropped, as readTour drops it, so pages
 * don't reopen the panel on a chat that isn't there. The chat is read only
 * while the tour goes on.
 */
export async function readTourPrefs(supabase: Reader, userId: string): Promise<TourPrefs | null> {
  const { data, error } = await supabase
    .from('chat_user_prefs')
    .select('tour_chat_id, tour_topic, tour_finished_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  if (!data.tour_chat_id || data.tour_finished_at) return data;
  const chat = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('id', data.tour_chat_id)
    .is('deleted_at', null)
    .is('archived_at', null)
    .maybeSingle();
  return chat.data ? data : { ...data, tour_chat_id: null };
}
