import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCloud } from '@/config/plans';
import { decryptApiKey } from '@/lib/agent/key-encryption';

/**
 * Resolve the Anthropic API key that the agent should use for this org.
 *
 * - **Self-host** (`isCloud() === false`): falls back to the operator's
 *   own `ANTHROPIC_API_KEY` env var. The org table is ignored — self-host
 *   instances belong to one customer who configures the model centrally.
 * - **Cloud**: reads `organizations.anthropic_api_key_encrypted`, decrypts
 *   via `decryptApiKey`, and returns the plaintext. Returns `null` if the
 *   org hasn't set a key yet or if the envelope can't be decrypted (master
 *   key rotated without re-saving, malformed row, etc.) — callers turn
 *   that into a 403 + "set a key in Settings" CTA.
 *
 * Never logs the plaintext. Never returns the env key on cloud (avoid the
 * footgun of one customer falling back to Ansvisor's own quota).
 */
export async function resolveAnthropicKey(organizationId: string): Promise<string | null> {
  if (!isCloud()) {
    return process.env.ANTHROPIC_API_KEY ?? null;
  }

  const { data } = await supabaseAdmin
    .from('organizations')
    .select('anthropic_api_key_encrypted')
    .eq('id', organizationId)
    .maybeSingle();

  if (!data?.anthropic_api_key_encrypted) return null;
  return decryptApiKey(data.anthropic_api_key_encrypted);
}

/**
 * Lightweight "is a key configured?" check that avoids decrypt — handy for
 * page-load gating where we only need to know whether to render the chat
 * UI vs the "set a key" empty state.
 */
export async function isAnthropicKeyConfigured(organizationId: string): Promise<boolean> {
  if (!isCloud()) {
    return !!process.env.ANTHROPIC_API_KEY;
  }
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('anthropic_api_key_encrypted')
    .eq('id', organizationId)
    .maybeSingle();
  return !!data?.anthropic_api_key_encrypted;
}
