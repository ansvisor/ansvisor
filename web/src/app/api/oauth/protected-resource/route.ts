import { CORS_HEADERS, enabledIssuer, notFound, preflight } from '@/lib/mcp-oauth/http';
import { protectedResourceMetadata } from '@/lib/mcp-oauth/metadata';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * The MCP endpoint's protected resource metadata (RFC 9728), served at
 * /.well-known/oauth-protected-resource/api/mcp and
 * /.well-known/oauth-protected-resource (next.config.ts rewrites): where an
 * app finds the authorization server after the MCP endpoint's 401. 404 while
 * MCP over OAuth is off.
 */
export function GET() {
  const issuer = enabledIssuer();
  if (!issuer) return notFound();
  return NextResponse.json(protectedResourceMetadata(issuer), {
    headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' },
  });
}

export function OPTIONS() {
  return preflight();
}
