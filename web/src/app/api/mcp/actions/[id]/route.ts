import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcp-auth';
import { getActionFor } from '@/lib/mcp/data';

/** GET /api/mcp/actions/[id] — REST mirror of the `get_action` MCP tool. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    const action = await getActionFor(auth, id);
    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }
    return NextResponse.json(action);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
