import { NextResponse } from 'next/server';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/run-api';
import { readSentImage } from '@/lib/chat/thread';

type Params = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';

/**
 * GET /api/chat/uploads/{id}
 *
 * An image a message was sent with (00409), shown in its bubble (inline) in
 * its own format. The person's own, or one of a chat they can read;
 * anything else, another file type included, is 404.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const uploadId = runIdOf((await params).id);
    if (!uploadId) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const found = await readSentImage(actor, uploadId);
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
    console.error('[chat/uploads] could not read an image:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the image');
  }
}
