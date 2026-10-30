import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCloud } from '@/config/plans';
import { resolveAgentModelConfig } from '@/lib/agent/key';
import type { AgentModelConfig } from '@/lib/agent/model';
import { isAiProvider } from '@/lib/agent/providers';
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
  subscription_status: string | null;
  legacy_key_grandfathered: boolean | null;
}

/**
 * Own keys come with Growth and Enterprise (CHAT-16 item 19); not in a
 * Growth free trial, which is locked as Starter is. Enterprise trials are a
 * deal's, with its terms.
 */
export function ownKeyInPlan(org: Pick<OwnKeyOrg, 'plan' | 'subscription_status'>): boolean {
  return (
    org.plan === 'enterprise' || (org.plan === 'growth' && org.subscription_status !== 'trialing')
  );
}

/**
 * Whether Chat may run on the workspace's own key: its plan includes them,
 * or it saved one on Starter (or in a free trial) before Chat drew on the AI
 * budget, and keeps it (CHAT-16 item 28, organizations.legacy_key_grandfathered).
 */
export function ownKeyAllowed(org: OwnKeyOrg | null | undefined): boolean {
  if (!org) return false;
  return ownKeyInPlan(org) || org.legacy_key_grandfathered === true;
}

/**
 * The key a Chat step runs on, in order:
 *   1. The workspace's own (its active key in Settings › AI Providers), when
 *      its plan allows it (ownKeyAllowed): the provider bills the workspace,
 *      and the usage percent doesn't move.
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

  if (isCloud()) {
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('plan, subscription_status, legacy_key_grandfathered')
      .eq('id', organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (ownKeyAllowed(org)) {
      const own = await resolveAgentModelConfig(organizationId);
      if (own) return { source: 'own', config: own };
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey
    ? { source: 'ansvisor', config: { provider: 'anthropic', apiKey, settings: {} } }
    : null;
}

/**
 * Whether the workspace's Chat runs on its own key, as resolveChatModelKey
 * would pick it, without decrypting the key: its plan allows own keys and
 * Settings › AI Providers has an active one. Such steps never draw on the AI
 * budget (reserve_chat_ai_usage writes them unchecked), so the composer
 * stays on at the cap. False with Chat off or self-hosted, where nothing is
 * metered, and when it can't be read: the server's hold still decides a run.
 */
export async function chatRunsOnOwnKey(organizationId: string): Promise<boolean> {
  if (!isCloud() || !chatAgenticEnabled(organizationId)) return false;
  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select('plan, subscription_status, legacy_key_grandfathered')
    .eq('id', organizationId)
    .maybeSingle();
  if (error || !ownKeyAllowed(org)) return false;
  const { data: key } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider, key_encrypted')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  return !!key?.key_encrypted && isAiProvider(key.provider);
}
