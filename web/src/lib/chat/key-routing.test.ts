import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which key a picked model's step runs on (W4-06, CHAT-16 item 23): the
 * own key for its provider, then the own OpenRouter key, then Ansvisor's;
 * a key saved for images only isn't Chat's; a key that can't be read stops
 * it; "Use Ansvisor's limit" skips the own keys.
 */

const ORG = '22222222-2222-4222-8222-222222222222';

let plan = 'enterprise';
/** The saved keys by provider; `active`: the one Auto runs on. */
let keys: Record<string, { key_encrypted: string; settings: unknown; active?: boolean }> = {};

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        is: () => chain,
        maybeSingle: async () => {
          if (table === 'organizations') {
            return {
              data: { plan, legacy_key_grandfathered: false, legacy_key_until: null },
              error: null,
            };
          }
          const entry = Object.entries(keys).find(([provider, key]) =>
            filters.provider ? provider === filters.provider : key.active,
          );
          return {
            data: entry ? { provider: entry[0], active: !!entry[1].active, ...entry[1] } : null,
            error: null,
          };
        },
      };
      return chain;
    },
  },
}));
vi.mock('@/lib/agent/key-encryption', () => ({
  decryptApiKey: (envelope: string) => (envelope === 'bad' ? null : `plain(${envelope})`),
}));
const markKeyFailing = vi.fn(async () => ({ started: true, since: null }));
vi.mock('./key-health', () => ({
  markKeyFailing: (...args: unknown[]) => markKeyFailing(...(args as [])),
}));

const { OwnKeyUnreadableError, resolveChatModelKey, resolvePickedModelKey } = await import('./key');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', 'ansvisor-anthropic');
  vi.stubEnv('OPENROUTER_API_KEY', '');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  plan = 'enterprise';
  keys = {};
  markKeyFailing.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('resolvePickedModelKey', () => {
  it('takes the own key for the model’s provider when it is for Chat', async () => {
    keys = { anthropic: { key_encrypted: 'ant', settings: { useFor: ['chat'] } } };
    expect(await resolvePickedModelKey(ORG, 'anthropic')).toEqual({
      source: 'own',
      config: { provider: 'anthropic', apiKey: 'plain(ant)', settings: { useFor: ['chat'] } },
    });
  });

  it('goes on to the own OpenRouter key, then Ansvisor’s, past a key for images only', async () => {
    keys = {
      anthropic: { key_encrypted: 'ant', settings: { useFor: ['images'] } },
      openrouter: { key_encrypted: 'or', settings: { model: 'anthropic/claude-sonnet-5.5' } },
    };
    expect(await resolvePickedModelKey(ORG, 'anthropic')).toMatchObject({
      source: 'own',
      config: { provider: 'openrouter', apiKey: 'plain(or)' },
    });
    keys = { openrouter: { key_encrypted: 'or', settings: { useFor: ['images'] } } };
    expect(await resolvePickedModelKey(ORG, 'anthropic')).toEqual({
      source: 'ansvisor',
      config: { provider: 'anthropic', apiKey: 'ansvisor-anthropic', settings: {} },
    });
  });

  it('stops on an own key it can’t read, marked failing, never Ansvisor’s in its place', async () => {
    keys = { anthropic: { key_encrypted: 'bad', settings: {} } };
    await expect(resolvePickedModelKey(ORG, 'anthropic')).rejects.toBeInstanceOf(
      OwnKeyUnreadableError,
    );
    expect(markKeyFailing).toHaveBeenCalledWith(ORG, 'anthropic', {
      class: 'unreadable',
      status: null,
    });
  });

  it('uses Ansvisor’s key below Enterprise, or on "Use Ansvisor’s limit"', async () => {
    keys = { anthropic: { key_encrypted: 'ant', settings: {} } };
    plan = 'growth';
    expect((await resolvePickedModelKey(ORG, 'anthropic'))?.source).toBe('ansvisor');
    plan = 'enterprise';
    expect((await resolvePickedModelKey(ORG, 'anthropic', { ansvisorOnly: true }))?.source).toBe(
      'ansvisor',
    );
  });

  it('runs an OpenRouter model on Ansvisor’s OpenRouter key only where it is set', async () => {
    expect(await resolvePickedModelKey(ORG, 'openrouter')).toBeNull();
    vi.stubEnv('OPENROUTER_API_KEY', 'ansvisor-or');
    expect(await resolvePickedModelKey(ORG, 'openrouter')).toEqual({
      source: 'ansvisor',
      config: { provider: 'openrouter', apiKey: 'ansvisor-or', settings: {} },
    });
  });
});

describe('resolveChatModelKey (Auto)', () => {
  it('runs on the active key only when it is for Chat', async () => {
    keys = { openai: { key_encrypted: 'oa', settings: { useFor: ['images'] }, active: true } };
    expect((await resolveChatModelKey(ORG))?.source).toBe('ansvisor');
    keys = { openai: { key_encrypted: 'oa', settings: {}, active: true } };
    expect((await resolveChatModelKey(ORG))?.source).toBe('own');
    expect((await resolveChatModelKey(ORG, { ansvisorOnly: true }))?.source).toBe('ansvisor');
  });
});
