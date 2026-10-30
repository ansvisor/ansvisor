import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ChatActor } from './engine';

/**
 * Agent Chat's conversations (agent_conversations and agent_messages, 00009)
 * copied into Chat (chat_conversations and chat_messages, 00400) on the
 * person's first visit to Chat, keeping their ids, so an old chat opens at
 * `/dashboard/chat/{id}` and the old links that redirect there (CHAT-01 item
 * 2) find it. Once per person: chat_user_prefs.legacy_imported_at (00408)
 * is set when a copy is complete, and a copy that failed half way is tried
 * again on the next visit.
 *
 * Safe to run twice, and twice at once: a chat or message already copied
 * (its id) is left as it is. Never throws (#1777): a failure is logged and
 * answered as a value. Server only (service role); the old tables are only
 * read.
 *
 * What is copied: the person's questions and Chat's answers in words. Tool
 * calls and tool results are not (Chat keeps an answer only, CHAT-03 item
 * 23), nor an answer that was only tool calls, nor a conversation left
 * without any message. The default title "New conversation" becomes no
 * title ("New chat"). Agent Chat had no pins, archive or sharing: a copied
 * chat is private, in Recents by its last message.
 */

/** The person's newest conversations copied at most (the rest are older than any Recents shows). */
export const LEGACY_IMPORT_MAX_CHATS = 1_000;
/** Conversations whose messages are read together. */
const CHATS_PER_READ = 50;
/** Rows one read answers with (the API's page size). */
const ROWS_PER_PAGE = 1_000;
/** Rows one write sends. */
const ROWS_PER_WRITE = 500;

/** Agent Chat's title for a chat it never named (00009). */
const LEGACY_DEFAULT_TITLE = 'New conversation';
/** chat_conversations.title's and chat_messages.content_md's limits (00400). */
const TITLE_MAX = 200;
const CONTENT_MAX = 200_000;

export type LegacyImportResult = { ok: true; chats: number; messages: number } | { ok: false };

interface LegacyChat {
  id: string;
  brand_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface LegacyMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: string | null;
  created_at: string;
}

/** A copied chat's title: none for Agent Chat's default or an empty one. */
export function legacyTitle(title: string | null): string | null {
  const text = (title ?? '').trim();
  if (!text || text === LEGACY_DEFAULT_TITLE) return null;
  return text.slice(0, TITLE_MAX);
}

/** A message as Chat keeps it, or null for a tool row or an answer with no words. */
export function legacyMessage(message: LegacyMessage) {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  const text = message.content ?? '';
  if (!text.trim()) return null;
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    role: message.role,
    content_md: text.slice(0, CONTENT_MAX),
    // An answer's "Generated …": when Agent Chat wrote it.
    generated_at: message.role === 'assistant' ? message.created_at : null,
    created_at: message.created_at,
  };
}

const chunks = <T>(list: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, (i + 1) * size),
  );

/** Every message of these conversations, oldest first, page by page. */
async function readMessages(chatIds: string[]): Promise<LegacyMessage[]> {
  const out: LegacyMessage[] = [];
  for (let from = 0; ; from += ROWS_PER_PAGE) {
    const { data, error } = await supabaseAdmin
      .from('agent_messages')
      .select('id, conversation_id, role, content, created_at')
      .in('conversation_id', chatIds)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + ROWS_PER_PAGE - 1);
    if (error) throw new Error(`Could not read Agent Chat's messages: ${error.message}`);
    const page = (data ?? []) as LegacyMessage[];
    out.push(...page);
    if (page.length < ROWS_PER_PAGE) return out;
  }
}

/** Writes rows that aren't there yet (by id), a slice at a time. */
async function insertMissing(table: string, rows: Record<string, unknown>[]) {
  for (const slice of chunks(rows, ROWS_PER_WRITE)) {
    const { error } = await supabaseAdmin
      .from(table)
      .upsert(slice, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(`Could not copy into ${table}: ${error.message}`);
  }
}

/**
 * Copies the person's Agent Chat conversations in their current workspace
 * into Chat, then notes it on them. Answers how many chats and messages it
 * wrote (or found already there), or `{ ok: false }` after logging a failure.
 */
export async function importLegacyChats(
  actor: ChatActor,
  now = new Date(),
): Promise<LegacyImportResult> {
  try {
    const { data, error } = await supabaseAdmin
      .from('agent_conversations')
      .select('id, brand_id, title, created_at, updated_at')
      .eq('user_id', actor.userId)
      .eq('organization_id', actor.organizationId)
      .order('updated_at', { ascending: false })
      .limit(LEGACY_IMPORT_MAX_CHATS);
    if (error) throw new Error(`Could not read Agent Chat's conversations: ${error.message}`);
    const legacy = (data ?? []) as LegacyChat[];

    let chats = 0;
    let messages = 0;
    for (const group of chunks(legacy, CHATS_PER_READ)) {
      const byChat = new Map<string, NonNullable<ReturnType<typeof legacyMessage>>[]>();
      for (const row of await readMessages(group.map((c) => c.id))) {
        const message = legacyMessage(row);
        if (message)
          byChat.set(row.conversation_id, [...(byChat.get(row.conversation_id) ?? []), message]);
      }
      // A conversation with nothing left to read stays behind.
      const kept = group.filter((c) => byChat.has(c.id));
      if (kept.length === 0) continue;

      await insertMissing(
        'chat_conversations',
        kept.map((c) => {
          const list = byChat.get(c.id)!;
          return {
            id: c.id,
            organization_id: actor.organizationId,
            user_id: actor.userId,
            brand_id: c.brand_id,
            title: legacyTitle(c.title),
            origin: 'page',
            origin_page: '/dashboard/chat',
            // Recents' order: its last message, as for any chat.
            last_message_at: list[list.length - 1].created_at,
            created_at: c.created_at,
            updated_at: c.updated_at,
          };
        }),
      );
      const rows = kept.flatMap((c) => byChat.get(c.id)!);
      await insertMissing('chat_messages', rows);
      chats += kept.length;
      messages += rows.length;
    }

    const { error: markError } = await supabaseAdmin
      .from('chat_user_prefs')
      .upsert(
        { user_id: actor.userId, legacy_imported_at: now.toISOString() },
        { onConflict: 'user_id' },
      );
    if (markError) throw new Error(`Could not note the copy: ${markError.message}`);
    return { ok: true, chats, messages };
  } catch (error) {
    console.error('[chat/legacy-import] could not copy Agent Chat conversations:', error);
    return { ok: false };
  }
}
