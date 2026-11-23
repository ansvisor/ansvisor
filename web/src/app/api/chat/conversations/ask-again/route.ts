import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { askAgainChatId, askAgainQuery } from '@/lib/chat/conversations';
import { chatActor, runFailure } from '@/lib/chat/run-api';

/**
 * GET /api/chat/conversations/ask-again?message=&brandId=
 *
 * The chat a repeated question goes back to (What's new from the profile
 * menu or Chat Home): the person's own newest chat that question started,
 * for the brand when given. `{ ok: true, id }`, with a null id when there
 * is none and the question starts a new chat.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400 a
 * bad query, 401 no session, 404 Chat off for the workspace (CHAT_AGENTIC).
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const query = askAgainQuery.safeParse(params);
    if (!query.success) return runFailure(400, 'failed', 'invalid', 'Invalid query');
    const id = await askAgainChatId(await createClient(), actor, query.data);
    return NextResponse.json<{ ok: true; id: string | null }>({ ok: true, id });
  } catch (error) {
    console.error('[chat/conversations] could not read the chat to ask again:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the chat');
  }
}
