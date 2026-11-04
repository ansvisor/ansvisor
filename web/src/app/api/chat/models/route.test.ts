// @vitest-environment node
import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/chat/models (W4-01): the person's workspace, its own keys' providers, the chat's model. */

const ORG = '11111111-1111-4111-8111-111111111111';
const actor = vi.hoisted(() => ({ value: null as unknown }));
const readModelMenu = vi.hoisted(() => vi.fn());
const ownChatKeyProviders = vi.hoisted(() => vi.fn());
const ownKeyAccess = vi.hoisted(() => vi.fn());
const orgRow = vi.hoisted(() => ({
  value: { plan: 'growth', subscription_status: 'active', plan_overrides: null } as Record<
    string,
    unknown
  >,
}));

vi.mock('@/lib/chat/run-api', () => ({
  chatActor: async () => actor.value,
  runFailure: (status: number, failure: string, code: string, error: string) =>
    NextResponse.json({ ok: false, failure, code, error }, { status }),
}));
vi.mock('@/lib/chat/model-menu', () => ({ readModelMenu }));
vi.mock('@/lib/chat/key', () => ({ ownChatKeyProviders, ownKeyAccess }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: orgRow.value, error: null }) }),
      }),
    }),
  },
}));

const { GET } = await import('./route');

const get = (query = '') => GET(new Request(`http://localhost/api/chat/models${query}`));

beforeEach(() => {
  actor.value = { userId: 'user-1', email: null, organizationId: ORG };
  readModelMenu.mockReset().mockResolvedValue({ models: [] });
  ownChatKeyProviders.mockReset().mockResolvedValue([]);
  ownKeyAccess.mockReset().mockResolvedValue({ state: 'locked' });
  orgRow.value = { plan: 'growth', subscription_status: 'active', plan_overrides: null };
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/chat/models', () => {
  it('isn’t there while Chat is off for the workspace', async () => {
    actor.value = NextResponse.json({ ok: false }, { status: 404 });
    expect((await get()).status).toBe(404);
    expect(readModelMenu).not.toHaveBeenCalled();
  });

  it('reads the menu with the own keys’ providers and the chat’s model', async () => {
    ownChatKeyProviders.mockResolvedValue(['anthropic']);
    const res = await get('?selected=anthropic/claude-opus-5.5');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      menu: { models: [] },
      access: { choiceOpen: true, planName: 'Growth', trial: false, ownKeys: { state: 'locked' } },
    });
    expect(ownChatKeyProviders).toHaveBeenCalledWith(ORG);
    expect(readModelMenu).toHaveBeenCalledWith({
      selected: 'anthropic/claude-opus-5.5',
      ownKeyProviders: ['anthropic'],
    });
  });

  it('takes no selection that isn’t a model id, and Auto as is', async () => {
    await get('?selected=../../x');
    expect(readModelMenu).toHaveBeenLastCalledWith({ selected: null, ownKeyProviders: [] });
    await get('?selected=auto');
    expect(readModelMenu).toHaveBeenLastCalledWith({ selected: 'auto', ownKeyProviders: [] });
  });

  it('answers a failure as a value', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    readModelMenu.mockRejectedValue(new Error('boom'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, failure: 'failed' });
  });
});

describe('what the person may do in the menu (W4-02)', () => {
  it('runs the free trial on Auto only, and names the plan', async () => {
    orgRow.value = { plan: 'growth', subscription_status: 'trialing', plan_overrides: null };
    const body = await (await get()).json();
    expect(body.access).toMatchObject({ choiceOpen: false, planName: 'Growth', trial: true });
  });

  it('passes the own keys’ state, Enterprise’s included', async () => {
    orgRow.value = { plan: 'enterprise', subscription_status: 'active', plan_overrides: null };
    ownKeyAccess.mockResolvedValue({ state: 'plan' });
    const body = await (await get()).json();
    expect(body.access).toMatchObject({ choiceOpen: true, ownKeys: { state: 'plan' } });
  });
});
