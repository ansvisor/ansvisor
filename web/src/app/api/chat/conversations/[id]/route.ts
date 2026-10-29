import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { chatIdOf, deleteChat, readChat, type ChatListItem } from '@/lib/chat/conversations';
import { chatActor, runFailure } from '@/lib/chat/run-api';
import { loadChatThread, type ThreadMessage } from '@/lib/chat/thread';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/chat/conversations/{id}
 *
 * One chat as its page and the side panel open it (CHAT-01 item 24): its
 * row, and its messages with each answer's run and steps as kept (never a
 * tool or its debug record). The person's own chat or one shared with the
 * team; anything else, or a deleted chat, is 404 ("This chat isn't
 * available.", item 26).
 *
 * DELETE /api/chat/conversations/{id}
 *
 * Delete (CHAT-23 `chat.delete`): its running agent is stopped first, then
 * it is gone for every member; Undo (…/restore) brings it back for a
 * minute. The author's, or an Admin's for a shared chat; else 404.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777).
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = chatIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const chat = await readChat(await createClient(), actor, id);
    const thread = chat ? await loadChatThread(id) : null;
    if (!chat || !thread) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json<{ ok: true; chat: ChatListItem; messages: ThreadMessage[] }>({
      ok: true,
      chat,
      messages: thread.messages,
    });
  } catch (error) {
    console.error('[chat/conversations] could not read a chat:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the chat');
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = chatIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const deleted = await deleteChat(actor, id);
    if (!deleted.ok) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[chat/conversations] could not delete a chat:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to delete the chat');
  }
}
