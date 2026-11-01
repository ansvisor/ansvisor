'use server';

import { z } from 'zod';
import { isKeyFailureClass, type KeyFailureClass } from '@/lib/agent/key-errors';
import { isAiProvider, type AiProvider } from '@/lib/agent/providers';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { createClient } from '@/lib/supabase/server';

/**
 * The person's own notices from the system (00441), for the top of their
 * Inbox's Needs you: their workspace's own AI key fails (AGENT-OWN-KEY §5.3).
 * Only Admins get them; the server writes them. Read with the person's
 * session (RLS: their own rows), open ones only: a key that works again
 * resolves its notice.
 */

/** A notice as the Inbox shows it. */
export interface ChatNotice {
  id: string;
  kind: 'own_key_failed';
  provider: AiProvider;
  class: KeyFailureClass;
  /** The 3-day reminder of a key still failing. */
  reminder: boolean;
  createdAt: string;
  read: boolean;
}

export type ChatNoticesRead = { ok: true; notices: ChatNotice[] } | { ok: false };

/** How many open notices the Inbox lists at most. */
const NOTICES_MAX = 10;

async function signedIn() {
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
  if (!orgId || !chatAgenticEnabled(orgId)) return null;
  return { client, userId: user.id };
}

/** The person's open notices, newest first; { ok: false } when they can't be read. */
export async function readChatNotices(): Promise<ChatNoticesRead> {
  try {
    const me = await signedIn();
    if (!me) return { ok: true, notices: [] };
    const { data, error } = await me.client
      .from('chat_notices')
      .select('id, kind, payload, created_at, read_at')
      .eq('user_id', me.userId)
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(NOTICES_MAX);
    if (error) {
      console.error('[chat/notices] could not read the notices:', error.message);
      return { ok: false };
    }
    const notices: ChatNotice[] = [];
    for (const row of (data ?? []) as {
      id: string;
      kind: string;
      payload: { provider?: unknown; class?: unknown; reminder?: unknown } | null;
      created_at: string;
      read_at: string | null;
    }[]) {
      const { provider, class: cls, reminder } = row.payload ?? {};
      if (row.kind !== 'own_key_failed' || !isAiProvider(provider) || !isKeyFailureClass(cls)) {
        continue;
      }
      notices.push({
        id: row.id,
        kind: 'own_key_failed',
        provider,
        class: cls,
        reminder: reminder === true,
        createdAt: row.created_at,
        read: row.read_at !== null,
      });
    }
    return { ok: true, notices };
  } catch (err) {
    console.error('[chat/notices] could not read the notices:', err);
    return { ok: false };
  }
}

const idsSchema = z.array(z.uuid()).min(1).max(NOTICES_MAX);

/**
 * The notices on screen are read (read_at). Open while the workspace is
 * read-only: it is the person's own record, nothing that runs or costs.
 * Never throws; false when they couldn't be marked.
 */
export async function markChatNoticesRead(ids: string[]): Promise<boolean> {
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return false;
  try {
    const me = await signedIn();
    if (!me) return false;
    const { error } = await me.client
      .from('chat_notices')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', me.userId)
      .in('id', parsed.data)
      .is('read_at', null);
    if (error) {
      console.error('[chat/notices] could not mark the notices read:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[chat/notices] could not mark the notices read:', err);
    return false;
  }
}
