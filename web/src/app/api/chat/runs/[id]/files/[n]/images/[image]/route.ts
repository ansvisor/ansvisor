import { NextResponse } from 'next/server';
import { readRunImage } from '@/lib/chat/file-store';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/run-api';

type Params = { params: Promise<{ id: string; n: string; image: string }> };

export const runtime = 'nodejs';

/**
 * GET /api/chat/runs/{id}/files/{n}/images/{image}
 *
 * One image of a set Chat made (CHAT-15 item 22, W4-08), shown on its card
 * (inline) in its own format. The person's own chat or one shared with
 * them; anything else is 404.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const { id, n, image } = await params;
    const runId = runIdOf(id);
    const position = Number.parseInt(n, 10);
    const which = Number.parseInt(image, 10);
    if (
      !runId ||
      !Number.isInteger(position) ||
      position < 1 ||
      position > 100 ||
      !Number.isInteger(which) ||
      which < 1 ||
      which > 10
    ) {
      return runFailure(404, 'not_found', 'not_found', 'Not found');
    }
    const found = await readRunImage(actor, runId, position, which);
    if (!found) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return new NextResponse(Buffer.from(found.bytes), {
      headers: {
        'Content-Type': found.mimeType,
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[chat/runs] could not read an image:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the image');
  }
}
