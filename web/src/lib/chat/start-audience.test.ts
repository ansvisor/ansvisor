import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { chatStartAudience, readChatStartAudience } from './start-audience';

/**
 * Who starts on Chat (owner decision 2026-11-06): the free trial, and a
 * workspace that never had a plan exploring the demo brand.
 */

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const org = (status: string | null, extra: Record<string, unknown> = {}) => ({
  plan: 'starter',
  subscription_status: status,
  stripe_subscription_id: null,
  ...extra,
});

describe('chatStartAudience', () => {
  it('is the trial while the workspace is trialing', () => {
    expect(
      chatStartAudience({
        org: org('trialing', { stripe_subscription_id: 'sub1' }),
        demoShown: false,
      }),
    ).toBe('trial');
  });

  it("leaves out an Enterprise deal's trial and every paid plan", () => {
    expect(
      chatStartAudience({ org: org('trialing', { plan: 'enterprise' }), demoShown: false }),
    ).toBeNull();
    expect(
      chatStartAudience({
        org: org('active', { stripe_subscription_id: 'sub1' }),
        demoShown: false,
      }),
    ).toBeNull();
  });

  it('is the demo for a workspace that never had a plan, with its demo brand shown', () => {
    expect(chatStartAudience({ org: org(null), demoShown: true })).toBe('demo');
    expect(chatStartAudience({ org: org('incomplete_expired'), demoShown: true })).toBe('demo');
  });

  it('leaves out a workspace without the demo brand, or whose plan ended', () => {
    expect(chatStartAudience({ org: org(null), demoShown: false })).toBeNull();
    // An ended trial or a canceled plan keeps its own data, even with the demo shown.
    expect(
      chatStartAudience({
        org: org('canceled', { stripe_subscription_id: 'sub1' }),
        demoShown: true,
      }),
    ).toBeNull();
  });

  it('is nobody off the cloud, or without the row', () => {
    expect(chatStartAudience({ org: null, demoShown: true })).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(chatStartAudience({ org: org('trialing'), demoShown: false })).toBeNull();
    expect(chatStartAudience({ org: org(null), demoShown: true })).toBeNull();
  });
});

/** A client whose two reads answer as given, keeping the filters each was made with. */
function reader(answers: {
  org: { data: unknown; error: unknown };
  demo: { data: unknown; error: unknown };
}) {
  const filters: [string, string, unknown][] = [];
  const client = {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([table, column, value]);
          return query;
        },
        is: (column: string, value: unknown) => {
          filters.push([table, column, value]);
          return query;
        },
        limit: async () => answers.demo,
        maybeSingle: async () => answers.org,
      };
      return query;
    },
  };
  return { client: client as never, filters };
}

describe('readChatStartAudience', () => {
  it("reads the organization's plan and its shown demo brand", async () => {
    const { client, filters } = reader({
      org: { data: org(null), error: null },
      demo: { data: [{ id: 'demo1' }], error: null },
    });
    await expect(readChatStartAudience(client, 'org1')).resolves.toBe('demo');
    expect(filters).toEqual(
      expect.arrayContaining([
        ['organizations', 'id', 'org1'],
        ['brands', 'organization_id', 'org1'],
        ['brands', 'is_demo', true],
        ['brands', 'demo_hidden_at', null],
      ]),
    );
  });

  it('decides nothing when a read fails', async () => {
    const { client } = reader({
      org: { data: org('trialing'), error: null },
      demo: { data: null, error: { message: 'down' } },
    });
    await expect(readChatStartAudience(client, 'org1')).resolves.toBeNull();
  });
});
