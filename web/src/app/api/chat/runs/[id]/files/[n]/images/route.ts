import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readRunImages, selectRunImage } from '@/lib/chat/file-store';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/run-api';
import { failedCallResponse, writeRefusal } from '@/lib/subscription-guard';

type Params = { params: Promise<{ id: string; n: string }> };

export const runtime = 'nodejs';

/** The run and its deliverable's place, as the path names them; null when they can't be. */
async function placeOf(params: Params['params']) {
  const { id, n } = await params;
  const runId = runIdOf(id);
  const position = Number.parseInt(n, 10);
  if (!runId || !Number.isInteger(position) || position < 1 || position > 100) return null;
  return { runId, position };
}

const body = z.object({ image: z.number().int().min(1).max(10) });

/**
 * GET /api/chat/runs/{id}/files/{n}/images
 *
 * A set of images Chat made (CHAT-15 item 22, W4-08): how many, which one
 * is selected (from 1), and whether the person may pick another (their own
 * chat). The person's own chat or one shared with them; anything else is 404.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const place = await placeOf(params);
    if (!place) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const set = await readRunImages(actor, place.runId, place.position);
    if (!set) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json(
      { ok: true, ...set },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[chat/runs] could not read a set of images:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the images');
  }
}

/**
 * POST /api/chat/runs/{id}/files/{n}/images `{ image }`
 *
 * The person picks another image of the set: its file in Files becomes that
 * one. Their own chat only (403 on a teammate's shared one); a read-only
 * workspace is refused as other writes are.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const refused = await writeRefusal();
    if (refused) return refused;
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const place = await placeOf(params);
    if (!place) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const input = body.safeParse(await req.json().catch(() => ({})));
    if (!input.success) return runFailure(400, 'failed', 'invalid', 'Invalid image');
    const picked = await selectRunImage(actor, place.runId, place.position, input.data.image);
    if (picked === 'not_found') return runFailure(404, 'not_found', 'not_found', 'Not found');
    if (picked === 'forbidden') {
      return runFailure(403, 'failed', 'forbidden', 'Only the chat’s owner can pick');
    }
    return NextResponse.json({ ok: true, selected: input.data.image });
  } catch (error) {
    console.error('[chat/runs] could not pick an image:', error);
    return failedCallResponse(error);
  }
}
