import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isCloud, isSubscriptionActive } from '@/config/plans';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  SUBSCRIPTION_INACTIVE,
  SubscriptionInactiveError,
  failedCallResponse,
  subscriptionInactiveResponse,
} from '@/lib/subscription-guard';

/**
 * Ansvisor Cloud's read-only mode on the API key surface (MCP tools, the
 * /api/mcp REST routes): while a workspace's plan isn't active — its trial
 * ended, or it was canceled — reading stays open and anything that writes,
 * runs or spends answers with the server's 402 body, as the dashboard's
 * upgrade dialog reads it. Self-hosted is never gated. The refusal itself is
 * shared with the web app's own writes (lib/subscription-guard.ts).
 */
export {
  SUBSCRIPTION_INACTIVE,
  SubscriptionInactiveError,
  failedCallResponse,
  subscriptionInactiveResponse,
};

/**
 * The tools that only read: open while read-only. Any other tool — a new one
 * too, until it is named as a read — needs an active plan.
 */
export function isReadTool(name: string): boolean {
  return name.startsWith('list_') || name.startsWith('get_');
}

/** Whether the organization may write: always self-hosted, and for a key without one. */
export async function subscriptionActiveFor(organizationId: string | null): Promise<boolean> {
  if (!isCloud() || !organizationId) return true;
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('subscription_status')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return isSubscriptionActive(data?.subscription_status as string | null | undefined);
}

/**
 * Refuse a costly call (the server's internal endpoints: a brief, a Site
 * Audit, an Improve action) while the workspace is read-only, whoever calls
 * it: an MCP tool, a REST route, the in-product agent, or one added later.
 */
export async function assertSubscriptionActive(organizationId: string | null): Promise<void> {
  if (!(await subscriptionActiveFor(organizationId))) throw new SubscriptionInactiveError();
}

/** A tool's answer to a call while read-only: a tool error carrying the same body. */
export function subscriptionInactiveToolResult() {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(SUBSCRIPTION_INACTIVE, null, 2) }],
    isError: true,
  };
}

type AnyToolCallback = (...args: unknown[]) => unknown;
type LooseRegisterTool = (name: string, config: unknown, cb: AnyToolCallback) => unknown;

/**
 * Have every tool registered on `server` from here on, other than a read
 * tool, check the organization's plan before it runs. The plan that can't be
 * read refuses the call too (subscriptionActiveFor throws). The plan is read once
 * per server, which the MCP route builds per request, and only when a gated
 * tool is called.
 */
export function gateWriteTools(server: McpServer, organizationId: string | null): McpServer {
  let active: Promise<boolean> | null = null;
  const register = server.registerTool.bind(server) as unknown as LooseRegisterTool;
  const gated: LooseRegisterTool = (name, config, cb) =>
    register(
      name,
      config,
      isReadTool(name)
        ? cb
        : async (...args: unknown[]) => {
            active ??= subscriptionActiveFor(organizationId);
            if (!(await active)) return subscriptionInactiveToolResult();
            return cb(...args);
          },
    );
  server.registerTool = gated as unknown as McpServer['registerTool'];
  // The SDK's older tool() would register around the gate: refused, so every
  // tool goes through registerTool above.
  server.tool = (() => {
    throw new Error('Register MCP tools with registerTool: the read-only gate wraps it');
  }) as McpServer['tool'];
  return server;
}
