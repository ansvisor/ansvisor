import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCloud } from '@/config/plans';
import { decryptApiKey } from '@/lib/agent/key-encryption';
import type { AgentModelConfig } from '@/lib/agent/model';
import {
  isAiProvider,
  OPENROUTER_MODEL_EXAMPLE,
  type AiProvider,
  type AiProviderSettings,
} from '@/lib/agent/providers';

/**
 * The organization's active key in Settings › AI Providers (cloud): none
 * saved, saved but unreadable (its envelope can't be decrypted: the master
 * key rotated without a re-save, a malformed row), or ready with its
 * provider's settings. Never logs the plaintext.
 */
export type ActiveKeyRead =
  | { state: 'none' }
  | { state: 'unreadable'; provider: AiProvider }
  | { state: 'ready'; config: AgentModelConfig };

export async function readActiveKey(organizationId: string): Promise<ActiveKeyRead> {
  const { data } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider, key_encrypted, settings')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  return keyReadOf(data);
}

/** A provider's saved key, as readActiveKey reads the active one, and whether Chat uses it. */
export async function readProviderKey(
  organizationId: string,
  provider: AiProvider,
): Promise<ActiveKeyRead & { active: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider, key_encrypted, settings, active')
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw new Error(`Could not read the AI key: ${error.message}`);
  return { ...keyReadOf(data), active: data?.active === true };
}

function keyReadOf(
  data: { provider: unknown; key_encrypted: string | null; settings: unknown } | null,
): ActiveKeyRead {
  if (!data?.key_encrypted || !isAiProvider(data.provider)) return { state: 'none' };
  const apiKey = decryptApiKey(data.key_encrypted);
  if (!apiKey) return { state: 'unreadable', provider: data.provider };
  return {
    state: 'ready',
    config: {
      provider: data.provider,
      apiKey,
      settings: (data.settings ?? {}) as AiProviderSettings,
    },
  };
}

/**
 * The operator's env-configured key for a self-host instance, in the order
 * the docs name them: Anthropic first, then OpenRouter (one key, any model;
 * `OPENROUTER_MODEL` picks it, defaulting to the Settings-page example),
 * then Gemini behind `AGENT_ALLOW_GOOGLE_KEY` (Google's SDKs read
 * `GOOGLE_GENERATIVE_AI_API_KEY` for other features too, so the agent runs
 * on it only when the operator asks). Null when none is set. Cloud never
 * calls this: there the org's key decides, and the vendor's Anthropic key
 * stays the only app-level one.
 */
export function selfHostModelConfig(): AgentModelConfig | null {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) return { provider: 'anthropic', apiKey: anthropicKey, settings: {} };
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey)
    return {
      provider: 'openrouter',
      apiKey: openrouterKey,
      settings: { model: process.env.OPENROUTER_MODEL || OPENROUTER_MODEL_EXAMPLE },
    };
  // No paid-provider key on this box? Run the agent on the operator's
  // Google AI Studio key (Gemini), but only when the operator says so:
  // GOOGLE_GENERATIVE_AI_API_KEY serves other features on this box too,
  // and setting it for one of them shouldn't turn the agent on.
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (googleKey && process.env.AGENT_ALLOW_GOOGLE_KEY === 'true') {
    return { provider: 'google', apiKey: googleKey, settings: {} };
  }
  return null;
}

/**
 * Resolve the provider and API key that the agent should use for this org.
 *
 * - **Self-host** (`isCloud() === false`): falls back to the operator's
 *   own `ANTHROPIC_API_KEY` env var. The org's keys are ignored — self-host
 *   instances belong to one customer who configures the model centrally.
 * - **Cloud**: the org's active key (readActiveKey). Returns `null` if the
 *   org hasn't set a key yet or if it can't be decrypted — callers turn that
 *   into a 403 + "set a key in Settings" CTA. Chat tells the two apart
 *   (lib/chat/key.ts): a key that can't be read stops it.
 *
 * Never returns the env key on cloud (avoid the footgun of one customer
 * falling back to Ansvisor's own quota).
 */
export async function resolveAgentModelConfig(
  organizationId: string,
): Promise<AgentModelConfig | null> {
  if (!isCloud()) {
    return selfHostModelConfig();
  }
  const key = await readActiveKey(organizationId);
  return key.state === 'ready' ? key.config : null;
}

/**
 * Lightweight "is a key configured?" check that avoids decrypt — handy for
 * page-load gating where we only need to know whether to render the chat
 * UI vs the "set a key" empty state.
 */
export async function isAgentKeyConfigured(organizationId: string): Promise<boolean> {
  if (!isCloud()) {
    return !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      (process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.AGENT_ALLOW_GOOGLE_KEY === 'true')
    );
  }
  const { data } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  return !!data;
}
