import { NextResponse } from 'next/server';
import { agentRunDriver } from '@/lib/chat/agent-driver';
import { brandEventSchema, fireBrandEvent } from '@/lib/chat/agent-triggers';
import { internalCallRefusal } from '@/lib/chat/internal-call';

// The runs it starts are driven past the answer (after()), within this.
export const maxDuration = 300;

/**
 * POST /api/internal/chat/agents/events `{ kind, brandId, ref, draftId }`
 *
 * The API server's hook after an event on a brand (00558): a page went live
 * in its CMS (page_published), with
 * `Authorization: Bearer ${CHAT_INTERNAL_SECRET}`. Fires the event's
 * triggers once per agent and event, with the noise rules, and starts what
 * the workspace has room for. No model is called.
 *
 * 404 with the new Chat off, 401 without the secret, 400 a bad body; 200
 * with what the fires came to.
 */
export async function POST(req: Request) {
  const refusal = internalCallRefusal(req);
  if (refusal) return refusal;
  const input = brandEventSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  try {
    const fired = await fireBrandEvent(input.data, new Date(), agentRunDriver);
    return NextResponse.json({ ok: true, fired });
  } catch (error) {
    console.error('[chat/agents] event triggers failed:', error);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
