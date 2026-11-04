import { NextResponse } from 'next/server';
import { imageModelOptions } from '@/lib/chat/images/access';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/run-api';
import { draftImagesInput, imageDraftOf, makeDraftImages } from '@/lib/content/ai-images';
import { failedCallResponse, writeRefusal } from '@/lib/subscription-guard';

type Params = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
// Two to four images at 1K, made at once and stored: well within this.
export const maxDuration = 120;

/**
 * GET /api/content/drafts/{id}/images
 *
 * The Content Editor's Generate with AI (CHAT-25 §9, W4-09): the image
 * models, the cheapest first, each with its multiplier and one image's
 * share of the monthly AI limit (none on the workspace's own key). Never
 * dollars. A draft the person can't open is 404.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = runIdOf((await params).id);
    const draft = id ? await imageDraftOf(id) : null;
    if (!draft) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json({ ok: true, ...(await imageModelOptions(actor.organizationId)) });
  } catch (error) {
    console.error('[content/images] could not read the image models:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the image models');
  }
}

/**
 * POST /api/content/drafts/{id}/images `{ prompt, style, aspectRatio, model, count }`
 *
 * Makes two to four images for the draft (W4-09): held on the AI budget,
 * charged at what the provider said they cost, and stored as options at
 * once. → 200 `{ ok, images: [{ id, url }], failed }`: addresses, never the
 * images' bytes, so the body stays small; `failed` were made (and charged)
 * but couldn't be stored. The picked one is kept, the others dropped
 * (./options). A read-only workspace is refused (402), as is the demo
 * brand's draft (403); a spent AI limit is 429; a model that made none says
 * why (422); made but none stored is 502.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const refused = await writeRefusal();
    if (refused) return refused;
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = runIdOf((await params).id);
    const draft = id ? await imageDraftOf(id) : null;
    if (!draft) return runFailure(404, 'not_found', 'not_found', 'Not found');
    if (draft.demo) return runFailure(403, 'failed', 'demo', 'The demo brand makes no images');
    const input = draftImagesInput.safeParse(await req.json().catch(() => ({})));
    if (!input.success) return runFailure(400, 'failed', 'invalid', 'Invalid request');
    const made = await makeDraftImages({
      organizationId: actor.organizationId,
      draftId: draft.id,
      brandName: draft.brandName,
      input: input.data,
    });
    if (made.ok) return NextResponse.json(made);
    const status =
      made.code === 'ai_limit'
        ? 429
        : made.code === 'refused'
          ? 422
          : made.code === 'own_key'
            ? 409
            : made.code === 'not_saved'
              ? 502
              : 503;
    return NextResponse.json(made, { status });
  } catch (error) {
    console.error('[content/images] could not make images:', error);
    return failedCallResponse(error);
  }
}
