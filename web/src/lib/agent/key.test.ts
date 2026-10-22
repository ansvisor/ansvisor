import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The provider and key Chat uses: the organization's active key on cloud,
 * the operator's Anthropic key on self-host.
 */

let row: unknown;
const eqs: [string, unknown][] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          eqs.push([col, val]);
          return chain;
        },
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return chain;
    },
  },
}));

vi.mock('@/lib/agent/key-encryption', () => ({
  decryptApiKey: (envelope: string) => (envelope === 'bad' ? null : `plain(${envelope})`),
}));

const { isAgentKeyConfigured, resolveAgentModelConfig } = await import('./key');

beforeEach(() => {
  row = null;
  eqs.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveAgentModelConfig', () => {
  it("uses the organization's active key, with its provider and settings, on cloud", async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    vi.stubEnv('ANTHROPIC_API_KEY', 'operator-key');
    row = { provider: 'openrouter', key_encrypted: 'env1', settings: { model: 'openai/gpt-5.5' } };
    expect(await resolveAgentModelConfig('org1')).toEqual({
      provider: 'openrouter',
      apiKey: 'plain(env1)',
      settings: { model: 'openai/gpt-5.5' },
    });
    expect(eqs).toEqual([
      ['organization_id', 'org1'],
      ['active', true],
    ]);
  });

  it('is null on cloud without an active key, or with one that no longer decrypts', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    vi.stubEnv('ANTHROPIC_API_KEY', 'operator-key');
    expect(await resolveAgentModelConfig('org1')).toBeNull();
    row = { provider: 'openai', key_encrypted: 'bad', settings: {} };
    expect(await resolveAgentModelConfig('org1')).toBeNull();
  });

  it("uses the operator's Anthropic key on self-host", async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    vi.stubEnv('ANTHROPIC_API_KEY', 'operator-key');
    expect(await resolveAgentModelConfig('org1')).toEqual({
      provider: 'anthropic',
      apiKey: 'operator-key',
      settings: {},
    });
    expect(eqs).toHaveLength(0);
  });
});

describe('isAgentKeyConfigured', () => {
  it('asks whether the organization has an active key on cloud', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    expect(await isAgentKeyConfigured('org1')).toBe(false);
    row = { provider: 'google' };
    expect(await isAgentKeyConfigured('org1')).toBe(true);
  });
});
