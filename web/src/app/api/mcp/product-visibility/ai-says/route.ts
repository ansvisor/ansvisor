import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateMcpRequest } from '@/lib/mcp-auth';
import { PV_PERIODS, getProductAiSaysFor, isPlanLocked } from '@/lib/mcp/product-visibility';

/** GET /api/mcp/product-visibility/ai-says — REST mirror of the `get_product_ai_says` MCP tool. */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  const productId = url.searchParams.get('product_id');
  if (!brandId || !productId) {
    return NextResponse.json({ error: 'brand_id and product_id are required' }, { status: 400 });
  }
  if (!z.guid().safeParse(productId).success) {
    return NextResponse.json({ error: 'product_id must be a UUID' }, { status: 400 });
  }
  const period = PV_PERIODS.find((p) => p === url.searchParams.get('period'));

  try {
    const read = await getProductAiSaysFor(auth, { brandId, productId, period });
    if (read === null) {
      return NextResponse.json({ error: 'Brand or product not found' }, { status: 404 });
    }
    if (isPlanLocked(read)) return NextResponse.json({ error: read.message }, { status: 403 });
    return NextResponse.json(read);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
