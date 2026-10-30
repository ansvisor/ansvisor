'use server';

import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import {
  generalPatch,
  generalPatchRefusal,
  generalPatchRow,
  readChatGeneral,
} from '@/lib/chat/general-settings';

/**
 * A person's Chat settings that follow them to every device (DECISIONS N3;
 * chat_user_prefs, 00400 and 00408), written as the person: the row's
 * policies keep it theirs. Behind CHAT_AGENTIC. Answers as values and never
 * throws (#1777): a setting that didn't save only means it isn't kept for
 * the next visit.
 */

export type ChatPrefResult = { ok: true } | { ok: false };

type Person = { client: Awaited<ReturnType<typeof createClient>>; userId: string; orgId: string };

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
  const orgId = profile?.organization_id ?? null;
  if (!chatAgenticEnabled(orgId)) return null;
  return { client, userId: user.id, orgId: orgId ?? '' };
}

/** Keeps these columns on the person's own row; logs and answers a failure. */
async function keep(
  person: Person,
  row: Record<string, string | boolean | null>,
  what: string,
): Promise<ChatPrefResult> {
  const { error } = await person.client
    .from('chat_user_prefs')
    .upsert({ user_id: person.userId, ...row }, { onConflict: 'user_id' });
  if (error) {
    console.error(`[chat-prefs] could not keep ${what}:`, error.message);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * The chat menu shown or hidden (CHAT-01 items 9a, 9d: the toggle and
 * `Ctrl+\`), kept on the person for every Chat route and device.
 */
export async function saveChatMenuOpen(open: boolean): Promise<ChatPrefResult> {
  try {
    if (typeof open !== 'boolean') return { ok: false };
    const person = await chatPerson();
    if (!person) return { ok: false };
    return await keep(person, { menu_open: open }, 'the menu state');
  } catch (error) {
    console.error('[chat-prefs] could not keep the menu state:', error);
    return { ok: false };
  }
}

/**
 * The app sidebar on Chat screens expanded or the 56px rail (CHAT-01 item
 * 4f: a click on the logo), kept on the person for every device.
 */
export async function saveChatRailOpen(open: boolean): Promise<ChatPrefResult> {
  try {
    if (typeof open !== 'boolean') return { ok: false };
    const person = await chatPerson();
    if (!person) return { ok: false };
    return await keep(person, { rail_open: open }, 'the rail state');
  } catch (error) {
    console.error('[chat-prefs] could not keep the rail state:', error);
    return { ok: false };
  }
}

/**
 * A change in Chat Settings › General (CHAT-23 `chatSettings.*`): default
 * mode, answer language, notifications, "Thought for N s", Ask Chat on
 * every page. Refused when the person may not pick it: a mode for a role
 * that only reads, Full auto the plan or the Admin keeps closed, Slack
 * while it isn't connected.
 */
export async function saveChatGeneralSettings(patch: unknown): Promise<ChatPrefResult> {
  try {
    const parsed = generalPatch.safeParse(patch);
    if (!parsed.success) return { ok: false };
    const person = await chatPerson();
    if (!person?.orgId) return { ok: false };
    const general = await readChatGeneral({ userId: person.userId, organizationId: person.orgId });
    if (!general || generalPatchRefusal(parsed.data, general.access)) return { ok: false };
    return await keep(person, generalPatchRow(parsed.data), 'a General setting');
  } catch (error) {
    console.error('[chat-prefs] could not keep a General setting:', error);
    return { ok: false };
  }
}
