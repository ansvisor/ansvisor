import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcp-auth';
import { runSiteAuditFor } from '@/lib/mcp/data';

/**
 * POST /api/mcp/site-audits  { brand_id, url }
 *
 * Parallel REST surface for the `run_site_audit` MCP tool — same data-layer
 * function, same ownership guarantee. Charges the monthly Site Audit quota and
 * returns the new audit id + "running" status (poll GET /api/mcp/site-audits/[id]).
 */
export async function POST(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  let body: { brand_id?: string; url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const brandId = body.brand_id;
  const url = body.url;
  if (!brandId || !url) {
    return NextResponse.json({ error: 'brand_id and url are required' }, { status: 400 });
  }

  try {
    const result = await runSiteAuditFor(auth, brandId, url);
    if (!result) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
