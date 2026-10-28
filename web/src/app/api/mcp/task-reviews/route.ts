import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcp-auth';
import { listTaskReviewsFor } from '@/lib/mcp/task-reviews';

/** GET /api/mcp/task-reviews — REST mirror of the `list_task_reviews` MCP tool. */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  try {
    const reviews = await listTaskReviewsFor(auth, {
      brandId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    if (reviews === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    if ('error' in reviews) {
      return NextResponse.json({ error: reviews.message }, { status: 403 });
    }
    return NextResponse.json({ reviews });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
