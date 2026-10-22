import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCloud } from '@/config/plans';
import { decryptApiKey } from '@/lib/agent/key-encryption';
import type { AgentModelConfig } from '@/lib/agent/model';
import { isAiProvider, type AiProviderSettings } from '@/lib/agent/providers';

/**
 * Resolve the provider and API key that the agent should use for this org.
 *
 * - **Self-host** (`isCloud() === false`): falls back to the operator's
 *   own `ANTHROPIC_API_KEY` env var. The org's keys are ignored — self-host
 *   instances belong to one customer who configures the model centrally.
 * - **Cloud**: reads the org's active row in `organization_ai_keys` (the
 *   provider picked in Settings › AI Providers), decrypts its key via
 *   `decryptApiKey`, and returns it with the provider's settings. Returns
 *   `null` if the org hasn't set a key yet or if the envelope can't be
 *   decrypted (master key rotated without re-saving, malformed row, etc.) —
 *   callers turn that into a 403 + "set a key in Settings" CTA.
 *
 * Never logs the plaintext. Never returns the env key on cloud (avoid the
 * footgun of one customer falling back to Ansvisor's own quota).
 */
export async function resolveAgentModelConfig(
  organizationId: string,
): Promise<AgentModelConfig | null> {
  if (!isCloud()) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    return apiKey ? { provider: 'anthropic', apiKey, settings: {} } : null;
  }

  const { data } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider, key_encrypted, settings')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();

  if (!data?.key_encrypted || !isAiProvider(data.provider)) return null;
  const apiKey = decryptApiKey(data.key_encrypted);
  if (!apiKey) return null;
  return {
    provider: data.provider,
    apiKey,
    settings: (data.settings ?? {}) as AiProviderSettings,
  };
}

/**
 * Lightweight "is a key configured?" check that avoids decrypt — handy for
 * page-load gating where we only need to know whether to render the chat
 * UI vs the "set a key" empty state.
 */
export async function isAgentKeyConfigured(organizationId: string): Promise<boolean> {
  if (!isCloud()) {
    return !!process.env.ANTHROPIC_API_KEY;
  }
  const { data } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  return !!data;
}
