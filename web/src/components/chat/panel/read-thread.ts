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
