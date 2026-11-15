import { NextResponse } from 'next/server';
import { z } from 'zod';
import { internalCallRefusal } from '@/lib/chat/internal-call';
import { readSlackCard } from '@/lib/chat/slack-approval';

const bodySchema = z.object({
  organizationId: z.guid(),
  brandId: z.guid(),
  agentRunId: z.guid(),
  n: z.number().int().min(1).max(100_000).optional(),
});

/**
 * POST /api/internal/chat/slack/card `{ organizationId, brandId, agentRunId, n? }`
 *
 * The card an agent run waits on, for the API server's Slack message
 * (#2139, N7: lib/chat/slack-approval.ts), or with `n` the card the message
 * showed and how it ended. Found only within that workspace and brand.
 * `Authorization: Bearer ${CHAT_INTERNAL_SECRET}`: 404 with the new Chat
 * off, 401 without the secret, 400 a bad body, 404 a run that isn't there.
 * Reads only.
 */
export async function POST(req: Request) {
  const refusal = internalCallRefusal(req);
  if (refusal) return refusal;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  try {
    const { n, ...ref } = body.data;
    const card = await readSlackCard(ref, n);
    if (!card) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, card });
  } catch (error) {
    console.error('[chat/slack] could not read a card:', (error as Error)?.name ?? error);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
