import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { internalCallRefusal } from '@/lib/chat/internal-call';
import { decideFromSlack } from '@/lib/chat/slack-approval';
import { subscriptionActiveFor } from '@/lib/mcp/subscription-gate';

// The run goes on past the answer (after()), within this, as on the app's Approve.
export const maxDuration = 300;

const bodySchema = z.object({
  organizationId: z.guid(),
  brandId: z.guid(),
  agentRunId: z.guid(),
  userId: z.guid(),
  decision: z.enum(['approve', 'reject']),
  n: z.number().int().min(1).max(100_000),
  digest: z.string().min(8).max(128),
});

/**
 * POST /api/internal/chat/slack/decide
 * `{ organizationId, brandId, agentRunId, userId, decision, n, digest }`
 *
 * Approve or Reject on an agent run's card from Slack (#2139, N7), as the
 * run's person the API server matched to the Slack user who clicked
 * (lib/chat/slack-approval.ts decideFromSlack: the app's own checks and
 * Approve or Skip). `Authorization: Bearer ${CHAT_INTERNAL_SECRET}`: 404
 * with the new Chat off, 401 without the secret, 400 a bad body. 200 with
 * `{ ok, decision }`: approved, rejected, decided already, or refused and
 * why; a read-only workspace is refused before anything is read.
 */
export async function POST(req: Request) {
  const refusal = internalCallRefusal(req);
  if (refusal) return refusal;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  const { userId, decision, n, digest, ...ref } = body.data;
  try {
    if (!(await subscriptionActiveFor(ref.organizationId))) {
      return NextResponse.json({
        ok: true,
        decision: { outcome: 'refused', reason: 'read_only', card: null },
      });
    }
    const answer = await decideFromSlack(ref, { userId, decision, n, digest }, (task) =>
      after(task),
    );
    return NextResponse.json({ ok: true, decision: answer });
  } catch (error) {
    console.error('[chat/slack] could not decide a card:', (error as Error)?.name ?? error);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
