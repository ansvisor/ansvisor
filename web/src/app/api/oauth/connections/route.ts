import { NextResponse } from 'next/server';
import { mcpOAuthEnabled } from '@/lib/mcp-oauth/config';
import { connectedAppsAccess, listConnectedApps } from '@/lib/mcp-oauth/connected-apps';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Settings › MCP & API Keys › Connected apps: the signed-in person's own
 * live connections (MCP over OAuth, #2141), and whether their plan lets
 * connections work. 404 while MCP over OAuth is off, which hides the card.
 */
export async function GET() {
  if (!mcpOAuthEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const [connections, plan] = await Promise.all([
      listConnectedApps(user.id),
      connectedAppsAccess(user.id),
    ]);
    return NextResponse.json(
      { connections, access: plan.access, isAdmin: plan.isAdmin },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[mcp-oauth] Could not list connected apps:', err);
    return NextResponse.json({ error: 'Could not load connected apps' }, { status: 500 });
  }
}
