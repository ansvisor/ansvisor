// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The precedence's facts, read fresh for every call with the service role:
 * the live role above all (CHAT-20 §4, §21), the plan, the workspace's Chat
 * settings and the person's ticks.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '33333333-3333-4333-8333-333333333333';
const USER = 'user-1';

type Result = { data: unknown; error: { message: string } | null };
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  errors: {} as Record<string, string>,
  reads: [] as { table: string; filters: [string, unknown][] }[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from(table: string) {
      const read = { table, filters: [] as [string, unknown][] };
      db.reads.push(read);
      const result = (): Result => ({
        data: db.tables[table] ?? null,
        error: db.errors[table] ? { message: db.errors[table] } : null,
      });
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          read.filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => result(),
        then: (resolve: (r: Result) => unknown) =>
          resolve({ ...result(), data: (db.tables[table] as unknown[]) ?? [] }),
      };
      return builder;
    },
  },
}));

const { readPrecedenceContext, readToolCall, parseChatSettings, readBrandIsDemo } =
  await import('./precedence-context');
const { decideToolCall, DEFAULT_CHAT_SETTINGS } = await import('./precedence');
const { defineTool } = await import('./registry/define-tool');
const { z } = await import('zod');

const addPrompts = defineTool({
  name: 'add_prompts',
  class: 'write',
  area: 'prompts',
  description: 'fixture',
  minRole: 'manager',
  planGate: null,
  costClass: 'C1',
  labelKey: 'addPrompts',
  route: null,
  mcpTool: null,
  specRow: '20',
  inputSchema: z.object({}),
  run: async () => null,
  fixture: { input: {} },
  defaultPolicy: 'ask_full_auto',
  maxPolicy: 'always',
});

const request = {
  userId: USER,
  organizationId: ORG,
  mode: 'auto' as const,
  surface: 'chat' as const,
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  db.tables = {
    profiles: { role: 'manager', organization_id: ORG },
    organizations: { plan: 'growth', subscription_status: 'active', plan_overrides: null },
    chat_settings: null,
    chat_auto_choices: [],
  };
  db.errors = {};
  db.reads = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('readPrecedenceContext', () => {
  it("reads the person's role again for every call: a role changed mid-run counts at once", async () => {
    const first = await readPrecedenceContext(request);
    expect(first?.role).toBe('manager');
    expect(
      decideToolCall(addPrompts, first!, { brandId: null, brandIsDemo: false, tainted: false }),
    ).toMatchObject({ kind: 'ask' });

    // An Admin makes them an Analyst while the run goes on.
    db.tables.profiles = { role: 'analyst', organization_id: ORG };
    const next = await readPrecedenceContext(request);
    expect(next?.role).toBe('analyst');
    expect(
      decideToolCall(addPrompts, next!, { brandId: null, brandIsDemo: false, tainted: false }),
    ).toEqual({
      kind: 'deny',
      denial: { code: 'forbidden_role', role: 'analyst', roles: ['admin', 'manager'] },
    });
    // From the profile, by the person's id, each time.
    const profileReads = db.reads.filter((read) => read.table === 'profiles');
    expect(profileReads).toHaveLength(2);
    expect(profileReads[1].filters).toEqual([['id', USER]]);
  });

  it('acts with live roles only, and only in the workspace the person belongs to now', async () => {
    for (const role of ['owner', 'editor', 'viewer', null]) {
      db.tables.profiles = { role, organization_id: ORG };
      expect(await readPrecedenceContext(request)).toBeNull();
    }
    db.tables.profiles = { role: 'admin', organization_id: OTHER_ORG };
    expect(await readPrecedenceContext(request)).toBeNull();
    db.tables.profiles = null;
    expect(await readPrecedenceContext(request)).toBeNull();
  });

  it('reads the plan, the settings and the ticks of this person in this workspace', async () => {
    db.tables.organizations = { plan: 'starter', subscription_status: 'active' };
    db.tables.chat_settings = {
      tool_policies: { saveDraft: 'always', addPrompts: 'never', brands: 'click' },
      full_auto_for_members: false,
      dont_ask_again: false,
      manager_execute_off: ['publishing', 'merging'],
    };
    db.tables.chat_auto_choices = [{ tool_key: 'saveDraft' }];
    const context = await readPrecedenceContext({ ...request, injectionDetected: true });
    expect(context).toMatchObject({
      role: 'manager',
      plan: { planId: 'starter', fullAuto: false },
      settings: {
        toolPolicies: { saveDraft: 'always', addPrompts: 'never' },
        fullAutoForMembers: false,
        dontAskAgain: false,
        managerExecuteOff: ['publishing'],
      },
      mode: 'auto',
      surface: 'chat',
      brandAccess: 'all',
      injectionDetected: true,
    });
    expect([...context!.autoChoices]).toEqual(['saveDraft']);
    const choices = db.reads.find((read) => read.table === 'chat_auto_choices');
    expect(choices?.filters).toEqual([
      ['user_id', USER],
      ['organization_id', ORG],
    ]);
  });

  it('decides on the defaults when the workspace has no settings row', async () => {
    const context = await readPrecedenceContext(request);
    expect(context?.settings).toEqual(DEFAULT_CHAT_SETTINGS);
    expect(parseChatSettings(null)).toBe(DEFAULT_CHAT_SETTINGS);
  });

  it('decides nothing on a read that failed', async () => {
    db.errors.chat_settings = 'timeout';
    await expect(readPrecedenceContext(request)).rejects.toThrow(/timeout/);
  });
});

describe('the demo flag', () => {
  it('is false until the demo chain merges; a call keeps its brand and its taint', async () => {
    expect(await readBrandIsDemo(ORG)).toBe(false);
    const context = (await readPrecedenceContext(request))!;
    expect(await readToolCall(context, { brandId: 'brand-a', tainted: true })).toEqual({
      brandId: 'brand-a',
      brandIsDemo: false,
      tainted: true,
    });
    const scoped = { ...context, brandAccess: ['brand-a'] };
    expect(await readToolCall(scoped, { brandId: 'brand-b', tainted: false })).toEqual({
      brandId: 'brand-b',
      brandIsDemo: false,
      tainted: false,
    });
    expect(await readToolCall(context, { brandId: null, tainted: false })).toMatchObject({
      brandIsDemo: false,
    });
  });
});
