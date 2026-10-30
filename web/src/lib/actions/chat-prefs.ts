'use server';

import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';

/**
 * A person's Chat settings that follow them to every device (DECISIONS N3;
 * chat_user_prefs, 00400 and 00408), written as the person: the row's
 * policies keep it theirs. Behind CHAT_AGENTIC. Answers as values and never
 * throws (#1777): a setting that didn't save only means it isn't kept for
 * the next visit.
 */

export type ChatPrefResult = { ok: true } | { ok: false };

/**
 * The chat menu shown or hidden (CHAT-01 items 9a, 9d: the toggle and
 * `Ctrl+\`), kept on the person for every Chat route and device.
 */
export async function saveChatMenuOpen(open: boolean): Promise<ChatPrefResult> {
  try {
    if (typeof open !== 'boolean') return { ok: false };
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false };
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    if (!chatAgenticEnabled(profile?.organization_id ?? null)) return { ok: false };
    const { error } = await supabase
      .from('chat_user_prefs')
      .upsert({ user_id: user.id, menu_open: open }, { onConflict: 'user_id' });
    if (error) {
      console.error('[chat-prefs] could not keep the menu state:', error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    console.error('[chat-prefs] could not keep the menu state:', error);
    return { ok: false };
  }
}
