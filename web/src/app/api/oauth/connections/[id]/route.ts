import { NextResponse } from 'next/server';
import { mcpOAuthEnabled } from '@/lib/mcp-oauth/config';
import { disconnectApp } from '@/lib/mcp-oauth/connected-apps';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Disconnect: end one of the signed-in person's own connections (MCP over
 * OAuth, #2141) and every token it has. 404 for one that isn't theirs, or
 * already ended. Open on a read-only workspace: it takes access back.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!mcpOAuthEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const done = await disconnectApp(user.id, id, req);
    return done
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (err) {
    console.error('[mcp-oauth] Could not disconnect an app:', err);
    return NextResponse.json({ error: 'Could not disconnect, try again' }, { status: 500 });
  }
}
