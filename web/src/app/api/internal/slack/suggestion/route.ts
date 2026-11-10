import { NextResponse } from 'next/server';
import { z } from 'zod';
import { internalSecretMatches } from '@/lib/chat/internal-call';
import { slackActionWords } from '@/lib/slack-action-words';

export const runtime = 'nodejs';

const bodySchema = z.object({ actionId: z.guid() });

/**
 * POST /api/internal/slack/suggestion `{ actionId }`
 *
 * The daily suggestion's words for the API server's Slack post (#2139): the
 * action's title and description as the Action Center words them. The
 * server's suggestions job calls it with `Authorization: Bearer
 * ${CRON_SECRET}`, never a browser. 401 without the secret, 422 for a body
 * that isn't one, 404 for an action that is gone; else `{ title,
 * description }`. Reads only.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const secret = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!internalSecretMatches(process.env.CRON_SECRET, secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 422 });
  }
  try {
    const words = await slackActionWords(body.data.actionId);
    if (!words) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    return NextResponse.json(words);
  } catch (err) {
    console.error('[slack] suggestion not worded:', (err as Error)?.name ?? err);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
