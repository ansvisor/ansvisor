import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateMcpRequest } from '@/lib/mcp-auth';
import { markContentDraftPublishedFor } from '@/lib/mcp/content-delivery';
import { contentUuid } from '@/lib/mcp/content-schemas';

const body = z.object({ url: z.string().max(2048) });

/**
 * POST /api/mcp/content-drafts/[id]/published — REST mirror of
 * `mark_content_draft_published`. Body: { url }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!contentUuid.safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  try {
    const result = await markContentDraftPublishedFor(auth, id, parsed.data.url);
    if ('error' in result) {
      return NextResponse.json(
        { error: result.message, code: result.error },
        { status: result.error === 'not_found' ? 404 : 400 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
