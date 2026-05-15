import { NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { authenticateMcpRequest } from '@/lib/mcp-auth';
import { createMcpServer } from '@/lib/mcp/server';

export const dynamic = 'force-dynamic';

/**
 * Streamable HTTP entry point for the Ansvisor MCP server. Claude Desktop,
 * Claude Code, Cursor, Zed, and other MCP-aware clients hit this URL with a
 * Bearer API key. Each request gets a fresh `McpServer` + transport bound to
 * the caller's user context, then is discarded — stateless, no session
 * memory between requests.
 */
async function handle(req: Request): Promise<Response> {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const server = createMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
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
