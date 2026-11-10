import { isReadTool } from '@/lib/mcp/subscription-gate';

/**
 * What a connected app may do (MCP over OAuth, #2141). Scopes only narrow:
 * the person's role, brand access and plan decide the rest, as for an API key.
 *
 *   * mcp:read: every list_ and get_ tool (isReadTool, the reads a read-only
 *     workspace keeps). Always granted.
 *   * mcp:write: every other tool. The consent page's "Make changes you ask
 *     for" box; unticked, the connection reads only, and a write answers 403
 *     insufficient_scope so the app can ask for more (the spec's step-up).
 */

export const MCP_READ_SCOPE = 'mcp:read';
export const MCP_WRITE_SCOPE = 'mcp:write';
export const MCP_SCOPES = [MCP_READ_SCOPE, MCP_WRITE_SCOPE] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/**
 * The scopes an app asks for. A scope we don't know (offline_access,
 * openid…) is left out, as RFC 6749 §3.3 lets a server do, and refresh tokens
 * come anyway; asking for none we know, or for write alone, means both: the
 * person can still untick changes on the consent page.
 */
export function parseScopeParam(value: string | null | undefined): McpScope[] {
  const asked = new Set((value ?? '').split(/\s+/).filter(Boolean));
  if (!asked.has(MCP_READ_SCOPE) && !asked.has(MCP_WRITE_SCOPE)) return [...MCP_SCOPES];
  return asked.has(MCP_WRITE_SCOPE) ? [...MCP_SCOPES] : [MCP_READ_SCOPE];
}

/** Scopes as the `scope` parameter writes them. */
export function scopeString(scopes: readonly string[]): string {
  return MCP_SCOPES.filter((scope) => scopes.includes(scope)).join(' ');
}

export function hasWriteScope(scopes: readonly string[] | undefined): boolean {
  return !!scopes?.includes(MCP_WRITE_SCOPE);
}

/** Whether a JSON-RPC message, or a batch of them, calls a tool that isn't a read. */
export function callsWriteTool(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some((message) => {
    if (!message || typeof message !== 'object') return false;
    const { method, params } = message as { method?: unknown; params?: { name?: unknown } };
    if (method !== 'tools/call') return false;
    const name = params?.name;
    return typeof name === 'string' && !isReadTool(name);
  });
}
