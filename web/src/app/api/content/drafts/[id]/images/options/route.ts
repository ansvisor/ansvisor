import { NextResponse } from 'next/server';
import { z } from 'zod';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/run-api';
import { imageDraftOf } from '@/lib/content/ai-images';
import { AI_OPTION_ID, dropAiImageOptions, keepAiImageOption } from '@/lib/content/ai-image-store';
import { failedCallResponse, writeRefusal } from '@/lib/subscription-guard';

type Params = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';

const optionId = z.string().regex(AI_OPTION_ID);
const body = z.strictObject({
  keep: optionId.optional(),
  drop: z.array(optionId).max(10).default([]),
});

/**
 * POST /api/content/drafts/{id}/images/options `{ keep?, drop }`
 *
 * The Content Editor's AI image options once the person is done with them
 * (W4-09, ai-image-store.ts). With `keep` (Use this image): that option is
 * kept where an upload goes and the `drop` ones go → 200 `{ ok, url }`, the
 * address the page takes; nothing is uploaded again. Without it
 * (Regenerate, the dialog closed): the `drop` ones go → 200 `{ ok }`, best
 * effort. Only the person's own workspace's options are reached. Keeping
 * is refused on a read-only workspace (402); dropping never is.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = runIdOf((await params).id);
    const draft = id ? await imageDraftOf(id) : null;
    if (!draft) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const input = body.safeParse(await req.json().catch(() => ({})));
    if (!input.success) return runFailure(400, 'failed', 'invalid', 'Invalid request');
    const { keep, drop } = input.data;
    if (!keep) {
      await dropAiImageOptions(actor.organizationId, drop);
      return NextResponse.json({ ok: true });
    }
    const refused = await writeRefusal();
    if (refused) return refused;
    const kept = await keepAiImageOption(actor.organizationId, keep, drop);
    if (!kept) return runFailure(503, 'failed', 'failed', 'Could not keep the image');
    return NextResponse.json({ ok: true, url: kept.url });
  } catch (error) {
    console.error('[content/images] could not settle the options:', error);
    return failedCallResponse(error);
  }
}
