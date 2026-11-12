import { NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { authenticateMcpRequest } from '@/lib/mcp-auth';
import { createMcpServer } from '@/lib/mcp/server';
import { insufficientScope } from '@/lib/mcp-oauth/challenge';
import { oauthIssuer } from '@/lib/mcp-oauth/config';
import { callsWriteTool, hasWriteScope } from '@/lib/mcp-oauth/scopes';

export const dynamic = 'force-dynamic';
// Node, not the edge: get_content_draft_package reads pages with jsdom.
export const runtime = 'nodejs';

/** The request's JSON-RPC body, read from a copy; undefined when it isn't JSON (the transport answers that). */
async function readBody(req: Request): Promise<unknown> {
  if (req.method !== 'POST') return undefined;
  try {
    return await req.clone().json();
  } catch {
    return undefined;
  }
}

/**
 * Streamable HTTP entry point for the Ansvisor MCP server. Claude Desktop,
 * Claude Code, Cursor, Zed, and other MCP-aware clients hit this URL with a
 * Bearer API key, or an app's access token from signing in (MCP over OAuth,
 * #2141; on unless MCP_OAUTH_ENABLED=false). Each request gets a fresh
 * `McpServer` + transport bound to the caller's user context, then is
 * discarded — stateless, no session memory between requests.
 */
async function handle(req: Request): Promise<Response> {
  // Every MCP call is a POST: its tools are gated one by one (createMcpServer).
  const auth = await authenticateMcpRequest(req, { gateWrites: false, allowOAuth: true });
  if (auth instanceof NextResponse) return auth;

  const parsedBody = await readBody(req);
  // A connection allowed only to read asks the person for more before a change
  // (the spec's step-up), before the SDK turns any answer into a 200.
  const issuer = oauthIssuer();
  if (
    auth.via === 'oauth' &&
    issuer &&
    callsWriteTool(parsedBody) &&
    !hasWriteScope(auth.oauthScopes)
  ) {
    return insufficientScope(issuer);
  }

  const server = createMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(
      req,
      parsedBody === undefined ? undefined : { parsedBody },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'MCP request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function DELETE(req: Request) {
  return handle(req);
}
