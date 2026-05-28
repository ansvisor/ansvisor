import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcp-auth';
import { listCitationsFor } from '@/lib/mcp/data';

/**
 * GET /api/mcp/citations
 *
 * Parallel REST surface for the `list_citations` MCP tool — same data-layer
 * function, same ownership guarantee. Query params mirror the MCP tool's args:
 * brand_id (required), date_from, date_to, model, region, topic_id, limit.
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  const limitParam = url.searchParams.get('limit');
  let limit: number | undefined;
  if (limitParam !== null) {
    const parsed = Number.parseInt(limitParam, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 200) {
      return NextResponse.json(
        { error: 'limit must be an integer between 1 and 200' },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  try {
    const result = await listCitationsFor(auth, {
      brandId,
      dateFrom: url.searchParams.get('date_from') ?? undefined,
      dateTo: url.searchParams.get('date_to') ?? undefined,
      model: url.searchParams.get('model') ?? undefined,
      region: url.searchParams.get('region') ?? undefined,
      topicId: url.searchParams.get('topic_id') ?? undefined,
      limit,
    });
    if (!result) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
