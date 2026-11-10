import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NextResponse } from 'next/server';
import { isCloud, isSubscriptionActive } from '@/config/plans';
import {
  planFactsFromOrgRow,
  planGateLock,
  type OrgPlanRow,
  type PlanFacts,
} from '@/lib/chat/plan-facts';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/plan-row';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  SUBSCRIPTION_INACTIVE,
  SubscriptionInactiveError,
  failedCallResponse,
  subscriptionInactiveResponse,
} from '@/lib/subscription-guard';
import { callOnDemoBrand, demoBrandToolResult } from './demo-gate';

/**
 * Ansvisor Cloud's read-only mode on the API key surface (MCP tools, the
 * /api/mcp REST routes): while a workspace's plan isn't active — its trial
 * ended, or it was canceled — reading stays open and anything that writes,
 * runs or spends answers with the server's 402 body, as the dashboard's
 * upgrade dialog reads it. Self-hosted is never gated. The refusal itself is
 * shared with the web app's own writes (lib/subscription-guard.ts).
 *
 * MCP per plan (CHAT-22 feature 3 item 13; DECISIONS S, 2026-10-30): reads
 * work on every plan, the free trial included; writing, running and
 * spending through MCP or the REST routes need Growth or above, paid: the
 * Growth trial reads only, as Starter does. The same lock as the plan
 * card's MCP chip (planGateLock).
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

/** The plan MCP writes need: Growth, past its free trial, or Enterprise. */
export const MCP_WRITE_PLAN = 'growth' as const;

/** A write refused for the plan, as subscription_inactive is for a plan that isn't active. */
export const PLAN_REQUIRED = {
  error: 'plan_limit',
  code: 'plan_required',
  required_plan: MCP_WRITE_PLAN,
  message:
    "On Starter and in the free trial, Ansvisor's MCP tools and API can read. Changes, runs " +
    'and anything that uses credits need the Growth plan or above: an admin can upgrade in ' +
    'Settings › Billing.',
} as const;

/** The REST routes' answer to a write the plan doesn't include. */
export function planRequiredResponse(): NextResponse {
  return NextResponse.json(PLAN_REQUIRED, { status: 402 });
}

/** Whether a write may go through: yes, its plan isn't active, or its plan doesn't include it. */
export type McpWriteAccess = 'ok' | 'inactive' | 'plan';

/**
 * Whether the organization may write over MCP or the REST routes, from one
 * read of its plan and subscription: always self-hosted, and for a key
 * without an organization. A plan that isn't active is `inactive` first.
 */
export async function mcpWriteAccess(organizationId: string | null): Promise<McpWriteAccess> {
  if (!isCloud() || !organizationId) return 'ok';
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(ORG_PLAN_COLUMNS)
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const facts = planFactsFromOrgRow(data as OrgPlanRow);
  if (!facts.writable) return 'inactive';
  return planGateLock(facts, { minPlan: MCP_WRITE_PLAN }) ? 'plan' : 'ok';
}

/**
 * Whether an app may use a sign-in connection (MCP over OAuth, #2141; owner,
 * 2026-11-09): on every paid plan, not in the free trial, not once the plan
 * has ended; always self-hosted. A plan-ranked gate (planGateLock, minPlan
 * Starter) is exactly "paid": it locks in the trial and nowhere else, and an
 * Enterprise trial, a deal's, counts as paid as everywhere else. Not a plan
 * feature: features follow the entitled plan, which the trial has.
 * API keys don't ask this: they read in the trial and on an ended plan.
 */
export type OAuthMcpAccess = 'ok' | 'trial' | 'ended';

export function oauthAccessFromFacts(facts: PlanFacts): OAuthMcpAccess {
  if (facts.selfHosted) return 'ok';
  if (!facts.writable) return 'ended';
  return planGateLock(facts, { minPlan: 'starter' }) ? 'trial' : 'ok';
}

/** oauthAccessFromFacts from one read of the organization's plan. A read that fails throws. */
export async function oauthMcpAccess(organizationId: string): Promise<OAuthMcpAccess> {
  if (!isCloud()) return 'ok';
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(ORG_PLAN_COLUMNS)
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return oauthAccessFromFacts(planFactsFromOrgRow(data as OrgPlanRow));
}

/**
 * Every tool's answer, reads too, over a sign-in connection whose workspace
 * isn't on a paid plan: a tool error that says why, for the app to tell the
 * person. Not a 401, which would send them through sign-in again for
 * nothing; the connection works again once a plan is chosen.
 */
export const OAUTH_PLAN_REQUIRED = {
  trial: {
    error: 'plan_limit',
    code: 'oauth_plan_required',
    message:
      'Apps connect to Ansvisor by sign-in on paid plans, and this workspace is in its free ' +
      'trial. An admin can choose a plan in Settings › Billing. Until then, an API key from ' +
      'Settings › MCP & API Keys can read.',
  },
  ended: {
    error: 'plan_limit',
    code: 'oauth_plan_required',
    message:
      "Apps connect to Ansvisor by sign-in on paid plans, and this workspace's plan isn't " +
      'active. An admin can choose a plan in Settings › Billing, and this connection works ' +
      'again as soon as they do. Until then, an API key from Settings › MCP & API Keys can read.',
  },
} as const;

export function oauthPlanToolResult(access: Exclude<OAuthMcpAccess, 'ok'>) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(OAUTH_PLAN_REQUIRED[access], null, 2) },
    ],
    isError: true,
  };
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

/**
 * A write tool's answer on a plan without MCP writes: a tool error with the
 * plan it needs, for the host model to tell the person why. The tool stays
 * listed, so the host can say so instead of not finding it.
 */
export function planRequiredToolResult() {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(PLAN_REQUIRED, null, 2) }],
    isError: true,
  };
}

type AnyToolCallback = (...args: unknown[]) => unknown;
type LooseRegisterTool = (name: string, config: unknown, cb: AnyToolCallback) => unknown;

/**
 * Have every tool registered on `server` from here on, other than a read
 * tool, check the organization's plan before it runs: a call on the demo
 * brand is refused first, whatever the plan (demo-gate.ts), then a plan
 * that isn't active (subscription_inactive), then a plan without MCP writes
 * (plan_required). The plan that can't be read refuses the call too
 * (mcpWriteAccess throws). The plan is read once per server, which the MCP
 * route builds per request, and only when a gated tool is called.
 * With `refuseAll` (a sign-in connection off a paid plan, oauthMcpAccess),
 * every tool answers it instead, reads too.
 */
export function gateWriteTools(
  server: McpServer,
  organizationId: string | null,
  { refuseAll }: { refuseAll?: ReturnType<typeof oauthPlanToolResult> } = {},
): McpServer {
  let access: Promise<McpWriteAccess> | null = null;
  const register = server.registerTool.bind(server) as unknown as LooseRegisterTool;
  const gated: LooseRegisterTool = (name, config, cb) =>
    register(
      name,
      config,
      refuseAll
        ? async () => refuseAll
        : isReadTool(name)
          ? cb
          : async (...args: unknown[]) => {
              if (await callOnDemoBrand(name, organizationId, args[0]))
                return demoBrandToolResult();
              access ??= mcpWriteAccess(organizationId);
              const allowed = await access;
              if (allowed === 'inactive') return subscriptionInactiveToolResult();
              if (allowed === 'plan') return planRequiredToolResult();
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
