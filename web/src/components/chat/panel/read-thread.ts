import type { ChatListItem } from '@/lib/chat/conversations';
import type { ChatThread, ThreadMessage } from '@/lib/chat/thread';

/**
 * One chat with its messages and runs, and its row (the ⋯ menu's), as the
 * panel opens it; null when it isn't there for them.
 */
export async function readThread(
  id: string,
): Promise<{ thread: ChatThread; row: ChatListItem } | null> {
  const res = await fetch(`/api/chat/conversations/${id}`, { cache: 'no-store' }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as
    | { ok: true; chat: ChatListItem; messages: ThreadMessage[] }
    | { ok: false }
    | null;
  if (!res?.ok || !body?.ok) return null;
  return {
    thread: {
      conversationId: body.chat.id,
      title: body.chat.title,
      brandId: null,
      mine: body.chat.mine,
      messages: body.messages,
    },
    row: body.chat,
  };
}

/**
 * The chat the panel continues on a page: the person's newest panel chat
 * started on `page`, for the brand when given; null when there is none or
 * it can't be read (the panel then starts empty).
 */
export async function readPageChatId(
  page: string,
  brandId: string | null | undefined,
): Promise<string | null> {
  const params = new URLSearchParams({ page });
  if (brandId) params.set('brandId', brandId);
  const res = await fetch(`/api/chat/conversations/panel?${params}`, { cache: 'no-store' }).catch(
    () => null,
  );
  const body = (await res?.json().catch(() => null)) as
    | { ok: true; id: string | null }
    | { ok: false }
    | null;
  return res?.ok && body?.ok ? body.id : null;
}
