import { CORS_HEADERS, enabledIssuer, notFound, preflight } from '@/lib/mcp-oauth/http';
import { authorizationServerMetadata } from '@/lib/mcp-oauth/metadata';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * The authorization server's metadata (RFC 8414), served at
 * /.well-known/oauth-authorization-server (a next.config.ts rewrite). 404
 * while MCP over OAuth is off.
 */
export function GET() {
  const issuer = enabledIssuer();
  if (!issuer) return notFound();
  return NextResponse.json(authorizationServerMetadata(issuer), {
    headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' },
  });
}

export function OPTIONS() {
  return preflight();
}
