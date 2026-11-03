import { NextResponse } from 'next/server';
import { imageModelOptions } from '@/lib/chat/images/access';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/run-api';
import { draftImagesInput, makeDraftImages } from '@/lib/content/ai-images';
import { createClient } from '@/lib/supabase/server';
import { failedCallResponse, writeRefusal } from '@/lib/subscription-guard';

type Params = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
// Two to four images at 1K, made at once: well within this.
export const maxDuration = 120;

/**
 * The draft, read as the person (its brand's access, CHAT-20 §15b), with
 * its brand's name; null for one they can't open. The demo brand's drafts
 * make nothing (`demo`).
 */
async function draftOf(id: string) {
  const supabase = await createClient();
  const { data: draft, error } = await supabase
    .from('content_drafts')
    .select('id, brand_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) return null;
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('name, is_demo')
    .eq('id', draft.brand_id)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand) return null;
  return { id: draft.id as string, brandName: (brand.name as string) ?? '', demo: !!brand.is_demo };
}

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
    const draft = id ? await draftOf(id) : null;
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
 * charged at what the provider said they cost. They come back as data
 * addresses; nothing is kept until the person picks one. A read-only
 * workspace is refused (402), as is the demo brand's draft (403); a spent AI
 * limit is 429; a model that made none says why (422).
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const refused = await writeRefusal();
    if (refused) return refused;
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = runIdOf((await params).id);
    const draft = id ? await draftOf(id) : null;
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
            : 503;
    return NextResponse.json(made, { status });
  } catch (error) {
    console.error('[content/images] could not make images:', error);
    return failedCallResponse(error);
  }
}
