'use server';

import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { parseRange, type ChatRange } from '@/lib/chat/range';

/**
 * The person's Chat date range (chat_user_prefs.date_range, 00528): read and
 * kept as the person, the row's policies keeping it theirs, for the line
 * under every message box and Chat Settings. Its own module, apart from
 * chat-prefs.ts: the composer reads it on every Chat page, and needs nothing
 * else of the server's. Behind CHAT_AGENTIC. Answers as values and never
 * throws (#1777).
 */

type Person = { client: Awaited<ReturnType<typeof createClient>>; userId: string };

/** The signed-in person with the new Chat on for their workspace, or null. */
async function chatPerson(): Promise<Person | null> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;
  const { data: profile } = await client
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!chatAgenticEnabled(profile?.organization_id ?? null)) return null;
  return { client, userId: user.id };
}

/**
 * The person's range: null when not picked yet (Chat asks before the next
 * analysis). Not ok when it can't be read (the new Chat off, a database
 * without 00528): the line and the setting then don't show.
 */
export async function readChatDateRange(): Promise<
  { ok: true; range: ChatRange | null } | { ok: false }
> {
  try {
    const who = await chatPerson();
    if (!who) return { ok: false };
    const { data, error } = await who.client
      .from('chat_user_prefs')
      .select('date_range')
      .eq('user_id', who.userId)
      .maybeSingle();
    if (error) return { ok: false };
    const value = (data as { date_range?: string | null } | null)?.date_range;
    return { ok: true, range: parseRange(value) };
  } catch {
    // Not read (no session, say): the line and the setting don't show.
    return { ok: false };
  }
}

/**
 * A new range from the line under the box or Chat Settings: a preset or two
 * days, neither after today; null clears it, so Chat asks again.
 */
export async function saveChatDateRange(range: unknown): Promise<{ ok: boolean }> {
  try {
    const parsed = range === null ? null : parseRange(range, new Date());
    if (range !== null && !parsed) return { ok: false };
    const who = await chatPerson();
    if (!who) return { ok: false };
    const { error } = await who.client
      .from('chat_user_prefs')
      .upsert({ user_id: who.userId, date_range: parsed }, { onConflict: 'user_id' });
    if (error) {
      console.error('[chat-range] could not keep the date range:', error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    console.error('[chat-range] could not keep the date range:', error);
    return { ok: false };
  }
}
