import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCloud } from '@/config/plans';
import { resolveAgentModelConfig } from '@/lib/agent/key';
import type { AgentModelConfig } from '@/lib/agent/model';
import { chatAgenticEnabled } from './flag';

/**
 * Whose key a Chat step runs on (CHAT-16 item 22, owner decision 11 of the
 * Chat P0 plan): the workspace's own, which its provider bills, or
 * Ansvisor's, which draws on the workspace's monthly AI budget (CHAT-04 §C,
 * lib/chat/budget.ts). Both write the step's usage row; only Ansvisor's
 * counts.
 */
export type ChatKeySource = 'own' | 'ansvisor';

export interface ChatModelKey {
  source: ChatKeySource;
  config: AgentModelConfig;
}

/** What decides whether a workspace's own key may run Chat. */
export interface OwnKeyOrg {
  plan: string | null;
  legacy_key_grandfathered: boolean | null;
  /** When a kept key's days end; null until Chat first needs it (00414). */
  legacy_key_until: string | null;
}

/** How long a key saved before Chat went live keeps running it (CHAT-16 item 28). */
export const LEGACY_KEY_DAYS = 30;

/**
 * Own keys come with Enterprise only (CHAT-16 item 19, owner decision
 * 2026-10-30): on Growth they would take the place of AI credit packs.
 * Enterprise trials are a deal's, with its terms.
 */
export function ownKeyInPlan(org: Pick<OwnKeyOrg, 'plan'>): boolean {
  return org.plan === 'enterprise';
}

/**
 * Whether a key saved before Chat went live for the workspace still runs it
 * (CHAT-16 item 28, organizations.legacy_key_grandfathered): for 30 days, on
 * any plan. Not started yet counts as running; they start the first time
 * Chat or Settings › AI Providers needs them (startLegacyKeyDays).
 */
export function legacyKeyRunning(
  org: Pick<OwnKeyOrg, 'legacy_key_grandfathered' | 'legacy_key_until'>,
  now = Date.now(),
): boolean {
  if (org.legacy_key_grandfathered !== true) return false;
  return org.legacy_key_until === null || Date.parse(org.legacy_key_until) > now;
}

/** Whether Chat may run on the workspace's own key: Enterprise, or a kept key's days. */
export function ownKeyAllowed(org: OwnKeyOrg | null | undefined, now = Date.now()): boolean {
  if (!org) return false;
  return ownKeyInPlan(org) || legacyKeyRunning(org, now);
}

/**
 * Starts a kept key's 30 days, once: a start at the same moment can't move
 * the date (the update only fills an empty one). The date they end.
 */
export async function startLegacyKeyDays(organizationId: string): Promise<string | null> {
  const until = new Date(Date.now() + LEGACY_KEY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .update({ legacy_key_until: until })
    .eq('id', organizationId)
    .eq('legacy_key_grandfathered', true)
    .is('legacy_key_until', null)
    .select('legacy_key_until')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data.legacy_key_until;
  const { data: org, error: readError } = await supabaseAdmin
    .from('organizations')
    .select('legacy_key_until')
    .eq('id', organizationId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  return org?.legacy_key_until ?? null;
}

/**
 * What a workspace's own keys do, for Chat and Settings › AI Providers:
 * - `open`: Chat is off for it (today's Agent Chat, which runs on its own
 *   key on any plan) or self-hosted.
 * - `plan`: its plan includes own keys (Enterprise).
 * - `kept`: a key saved before Chat went live runs it until `until`.
 * - `locked`: Chat runs on the plan's AI limit; own keys need Enterprise.
 */
export type OwnKeyAccess =
  | { state: 'open' | 'plan' | 'locked' }
  | { state: 'kept'; until: string | null };

export async function ownKeyAccess(organizationId: string): Promise<OwnKeyAccess> {
  if (!isCloud() || !chatAgenticEnabled(organizationId)) return { state: 'open' };
  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select('plan, legacy_key_grandfathered, legacy_key_until')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!org) return { state: 'locked' };
  if (ownKeyInPlan(org)) return { state: 'plan' };
  if (org.legacy_key_grandfathered && org.legacy_key_until === null) {
    org.legacy_key_until = await startLegacyKeyDays(organizationId);
  }
  return legacyKeyRunning(org)
    ? { state: 'kept', until: org.legacy_key_until }
    : { state: 'locked' };
}

/**
 * The key a Chat step runs on, in order:
 *   1. The workspace's own (its active key in Settings › AI Providers), on
 *      Enterprise or for a kept key's 30 days (ownKeyAccess): the provider
 *      bills the workspace, and the usage percent doesn't move.
 *   2. Ansvisor's (ANTHROPIC_API_KEY; Auto is Anthropic first-party): the
 *      step draws on the workspace's AI budget.
 * Null when neither is there. Self-hosted, the operator's own key is
 * Ansvisor's here, with no budget to draw on (the server meters nothing).
 *
 * Only with CHAT_AGENTIC on for the workspace. Off, it is today's Agent
 * Chat: on the cloud the workspace's own key or nothing, never Ansvisor's
 * (resolveAgentModelConfig), and nothing is metered; it reads as 'own'.
 */
export async function resolveChatModelKey(organizationId: string): Promise<ChatModelKey | null> {
  if (!chatAgenticEnabled(organizationId)) {
    const config = await resolveAgentModelConfig(organizationId);
    return config ? { source: 'own', config } : null;
  }

  const access = await ownKeyAccess(organizationId);
  if (access.state === 'plan' || access.state === 'kept') {
    const own = await resolveAgentModelConfig(organizationId);
    if (own) return { source: 'own', config: own };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey
    ? { source: 'ansvisor', config: { provider: 'anthropic', apiKey, settings: {} } }
    : null;
}
