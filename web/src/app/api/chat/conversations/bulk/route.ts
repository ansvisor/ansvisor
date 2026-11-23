import { NextResponse } from 'next/server';
import { bulkInput, deleteChats, restoreChats } from '@/lib/chat/conversations';
import { chatActor, runFailure } from '@/lib/chat/run-api';

/**
 * POST /api/chat/conversations/bulk `{ action: 'delete' | 'restore', ids }`
 *
 * Clear a day's chats in the chat menu, or Delete selected in All chats,
 * and their Undo: the person's own chats among `ids` (200 at most) are
 * deleted as Delete does one, or brought back within a minute. Others'
 * chats are left out. Answers `{ ok: true, ids }`: the chats changed.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777).
 */
export async function POST(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const input = bulkInput.safeParse(await req.json().catch(() => null));
    if (!input.success) return runFailure(400, 'failed', 'invalid', 'Invalid change');
    const ids =
      input.data.action === 'delete'
        ? await deleteChats(actor, input.data.ids)
        : await restoreChats(actor, input.data.ids);
    return NextResponse.json<{ ok: true; ids: string[] }>({ ok: true, ids });
  } catch (error) {
    console.error('[chat/conversations] could not change chats:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to change the chats');
  }
}
