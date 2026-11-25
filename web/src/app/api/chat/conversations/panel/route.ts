import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { latestPanelChatId, panelChatQuery } from '@/lib/chat/conversations';
import { chatActor, runFailure } from '@/lib/chat/run-api';

/**
 * GET /api/chat/conversations/panel?page=&brandId=
 *
 * The chat the side panel continues on a page (CHAT-01 item 24): the
 * person's own newest panel chat started on that page, for the brand when
 * given. `{ ok: true, id }`, with a null id when the page has none yet.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400 a
 * bad query, 401 no session, 404 Chat off for the workspace (CHAT_AGENTIC).
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const query = panelChatQuery.safeParse(params);
    if (!query.success) return runFailure(400, 'failed', 'invalid', 'Invalid query');
    const id = await latestPanelChatId(await createClient(), actor, query.data);
    return NextResponse.json<{ ok: true; id: string | null }>({ ok: true, id });
  } catch (error) {
    console.error('[chat/conversations] could not read the panel chat:', error);
    return runFailure(500, 'failed', 'failed', "Failed to read the page's chat");
  }
}
