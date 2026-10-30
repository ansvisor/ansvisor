import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Whose key a Chat step runs on: with Chat on, the workspace's own when its
 * plan allows it (Growth+, or a Starter key kept from before), else
 * Ansvisor's, which draws on the AI budget. With Chat off, today's Agent
 * Chat: the workspace's own key or nothing on the cloud.
 */

const ORG = '22222222-2222-4222-8222-222222222222';

let org: Record<string, unknown> | null;
let ownKey: Record<string, unknown> | null;
const reads: string[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      reads.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: table === 'organizations' ? org : ownKey,
          error: null,
        }),
      };
      return chain;
    },
  },
}));

vi.mock('@/lib/agent/key-encryption', () => ({
  decryptApiKey: (envelope: string) => `plain(${envelope})`,
}));

const { chatRunsOnOwnKey, ownKeyAllowed, resolveChatModelKey } = await import('./key');

const CUSTOMER = {
  provider: 'openai',
  key_encrypted: 'env1',
  settings: { model: 'gpt-5.5' },
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', 'ansvisor-key');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  org = { plan: 'starter', subscription_status: 'active', legacy_key_grandfathered: false };
  ownKey = null;
  reads.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const ANSVISOR = {
  source: 'ansvisor',
  config: { provider: 'anthropic', apiKey: 'ansvisor-key', settings: {} },
};
const OWN = {
  source: 'own',
  config: { provider: 'openai', apiKey: 'plain(env1)', settings: { model: 'gpt-5.5' } },
};

describe('ownKeyAllowed', () => {
  it('opens own keys to Growth and Enterprise, not to Starter or a Growth trial', () => {
    const at = (plan: string, subscription_status = 'active', legacy = false) =>
      ownKeyAllowed({ plan, subscription_status, legacy_key_grandfathered: legacy });
    expect(at('growth')).toBe(true);
    expect(at('enterprise')).toBe(true);
    expect(at('enterprise', 'trialing')).toBe(true);
    expect(at('starter')).toBe(false);
    expect(at('growth', 'trialing')).toBe(false);
    // A key kept from before Chat drew on the budget (CHAT-16 item 28).
    expect(at('starter', 'active', true)).toBe(true);
    expect(at('growth', 'trialing', true)).toBe(true);
    expect(ownKeyAllowed(null)).toBe(false);
  });
});

describe('resolveChatModelKey, Chat on', () => {
  it('runs a Growth workspace on its own key: its provider bills it', async () => {
    org = { plan: 'growth', subscription_status: 'active', legacy_key_grandfathered: false };
    ownKey = CUSTOMER;
    expect(await resolveChatModelKey(ORG)).toEqual(OWN);
  });

  it('runs Starter on Ansvisor’s key, its own key saved since left aside', async () => {
    ownKey = CUSTOMER;
    expect(await resolveChatModelKey(ORG)).toEqual(ANSVISOR);
    // Not even read: the plan doesn't include it.
    expect(reads).toEqual(['organizations']);
  });

  it('keeps a Starter workspace’s key from before on its own key', async () => {
    org = { plan: 'starter', subscription_status: 'active', legacy_key_grandfathered: true };
    ownKey = CUSTOMER;
    expect(await resolveChatModelKey(ORG)).toEqual(OWN);
  });

  it('falls back to Ansvisor’s key when a Growth workspace has none', async () => {
    org = { plan: 'growth', subscription_status: 'active', legacy_key_grandfathered: false };
    expect(await resolveChatModelKey(ORG)).toEqual(ANSVISOR);
  });

  it('runs a Growth free trial on Ansvisor’s key, as Starter', async () => {
    org = { plan: 'growth', subscription_status: 'trialing', legacy_key_grandfathered: false };
    ownKey = CUSTOMER;
    expect(await resolveChatModelKey(ORG)).toEqual(ANSVISOR);
  });

  it('is null with neither key', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(await resolveChatModelKey(ORG)).toBeNull();
  });

  it('uses the operator’s key self-hosted, where nothing is metered', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await resolveChatModelKey(ORG)).toEqual(ANSVISOR);
    expect(reads).toEqual([]);
  });
});

describe('resolveChatModelKey, Chat off', () => {
  beforeEach(() => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
  });

  it('keeps today’s Agent Chat: the workspace’s own key, on any plan', async () => {
    ownKey = CUSTOMER;
    expect(await resolveChatModelKey(ORG)).toEqual(OWN);
    // The plan isn't read: Agent Chat never looked at it.
    expect(reads).toEqual(['organization_ai_keys']);
  });

  it('never falls back to Ansvisor’s key on the cloud', async () => {
    org = { plan: 'growth', subscription_status: 'active', legacy_key_grandfathered: false };
    expect(await resolveChatModelKey(ORG)).toBeNull();
  });

  it('is on for the listed workspaces only', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '33333333-3333-4333-8333-333333333333');
    expect(await resolveChatModelKey(ORG)).toBeNull();
  });
});

describe('chatRunsOnOwnKey', () => {
  it('says yes only where resolveChatModelKey would pick the workspace’s own key', async () => {
    org = { plan: 'growth', subscription_status: 'active', legacy_key_grandfathered: false };
    ownKey = CUSTOMER;
    expect(await chatRunsOnOwnKey(ORG)).toBe(true);

    // No key saved, or the plan leaves it aside: Ansvisor's key, on the budget.
    ownKey = null;
    expect(await chatRunsOnOwnKey(ORG)).toBe(false);
    org = { plan: 'starter', subscription_status: 'active', legacy_key_grandfathered: false };
    ownKey = CUSTOMER;
    expect(await chatRunsOnOwnKey(ORG)).toBe(false);
    org = { plan: 'growth', subscription_status: 'trialing', legacy_key_grandfathered: false };
    expect(await chatRunsOnOwnKey(ORG)).toBe(false);
    org = { plan: 'starter', subscription_status: 'active', legacy_key_grandfathered: true };
    expect(await chatRunsOnOwnKey(ORG)).toBe(true);
  });

  it('is no with Chat off or self-hosted, where nothing is metered', async () => {
    org = { plan: 'growth', subscription_status: 'active', legacy_key_grandfathered: false };
    ownKey = CUSTOMER;
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await chatRunsOnOwnKey(ORG)).toBe(false);
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await chatRunsOnOwnKey(ORG)).toBe(false);
    expect(reads).toEqual([]);
  });
});
