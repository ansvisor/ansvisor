'use server';

import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { PANEL_SIZES, type PanelSize } from '@/lib/chat/panel';

/**
 * A person's Chat settings that follow them to every device (DECISIONS N3;
 * chat_user_prefs, 00400 and 00408), written as the person: the row's
 * policies keep it theirs. Behind CHAT_AGENTIC. Answers as values and never
 * throws (#1777): a setting that didn't save only means it isn't kept for
 * the next visit.
 */

export type ChatPrefResult = { ok: true } | { ok: false };

/** Writes one choice on the person's own row; false when it isn't theirs to keep. */
async function keepPref(
  change: { menu_open: boolean } | { panel_size: PanelSize },
  what: string,
): Promise<ChatPrefResult> {
  try {
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
      .upsert({ user_id: user.id, ...change }, { onConflict: 'user_id' });
    if (error) {
      console.error(`[chat-prefs] could not keep the ${what}:`, error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    console.error(`[chat-prefs] could not keep the ${what}:`, error);
    return { ok: false };
  }
}

/**
 * The chat menu shown or hidden (CHAT-01 items 9a, 9d: the toggle and
 * `Ctrl+\`), kept on the person for every Chat route and device.
 */
export async function saveChatMenuOpen(open: boolean): Promise<ChatPrefResult> {
  if (typeof open !== 'boolean') return { ok: false };
  return keepPref({ menu_open: open }, 'menu state');
}

/**
 * The side panel's size (CHAT-01 item 16: compact, wide or full screen),
 * kept on the person so the panel opens at its last size on every page and
 * device.
 */
export async function saveChatPanelSize(size: PanelSize): Promise<ChatPrefResult> {
  if (!PANEL_SIZES.includes(size)) return { ok: false };
  return keepPref({ panel_size: size }, 'panel size');
}
