// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The AEO Operator's plan card, approved in the app (AEO Operator plan
 * §4.2 step 6): the subscription guard first, with the plan's brand (the
 * demo brand and a read-only workspace refused before anything else); then
 * only the person the Operator's run acts as; then the start itself
 * (lib/chat/operator/approve.ts), as that person, in the run.
 */

const ME = 'aaaaaaaa-0000-4000-8000-000000000002';
const SOMEONE = 'aaaaaaaa-0000-4000-8000-000000000004';
const ORG = '11111111-1111-4111-8111-111111111111';
const BRAND = '22222222-2222-4222-8222-222222222222';
const PLAN = 'f0f0f0f0-0000-4000-8000-000000000001';
const RUN = 'eeeeeeee-0000-4000-8000-0000000000f1';

const fakes = vi.hoisted(() => ({
  order: [] as string[],
  user: { id: 'aaaaaaaa-0000-4000-8000-000000000002' } as { id: string } | null,
  assertWritable: vi.fn(),
  approvePlan: vi.fn(),
}));
vi.mock('@/lib/subscription-guard', async (original) => ({
  ...(await original<typeof import('@/lib/subscription-guard')>()),
  assertWritable: fakes.assertWritable,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        fakes.order.push('session');
        return { data: { user: fakes.user } };
      },
    },
  }),
}));
vi.mock('@/lib/chat/operator/approve', () => ({ approvePlan: fakes.approvePlan }));

const { approveAgentPlanFromChat } = await import('./chat-operator');
const { DemoBrandError, SubscriptionInactiveError } = await import('@/lib/subscription-guard');

const input = { plan_id: PLAN, brand_id: BRAND };
const place = { userId: ME, organizationId: ORG, agentRunId: RUN };
const started = { ok: true, plan_id: PLAN, repeated: false, started: 2, skipped: 0, children: [] };

beforeEach(() => {
  vi.clearAllMocks();
  fakes.order = [];
  fakes.user = { id: ME };
  fakes.assertWritable.mockImplementation(async () => {
    fakes.order.push('guard');
  });
  fakes.approvePlan.mockImplementation(async () => {
    fakes.order.push('start');
    return started;
  });
});

describe('approveAgentPlanFromChat', () => {
  it('checks the plan first, with its brand, then starts it as the run’s person', async () => {
    expect(await approveAgentPlanFromChat(input, place)).toEqual(started);
    expect(fakes.assertWritable).toHaveBeenCalledWith({ brandId: BRAND });
    expect(fakes.order).toEqual(['guard', 'session', 'start']);
    expect(fakes.approvePlan).toHaveBeenCalledWith({ userId: ME, organizationId: ORG }, input, RUN);
  });

  it('starts nothing on the demo brand or a read-only workspace', async () => {
    fakes.assertWritable.mockRejectedValueOnce(new DemoBrandError());
    await expect(approveAgentPlanFromChat(input, place)).rejects.toBeInstanceOf(DemoBrandError);
    fakes.assertWritable.mockRejectedValueOnce(new SubscriptionInactiveError());
    await expect(approveAgentPlanFromChat(input, place)).rejects.toBeInstanceOf(
      SubscriptionInactiveError,
    );
    expect(fakes.approvePlan).not.toHaveBeenCalled();
  });

  it('starts nothing for anyone but the person the run acts as, nor signed out', async () => {
    fakes.user = { id: SOMEONE };
    expect(await approveAgentPlanFromChat(input, place)).toMatchObject({
      ok: false,
      reason: 'not_yours',
    });
    fakes.user = null;
    expect(await approveAgentPlanFromChat(input, place)).toMatchObject({ ok: false });
    expect(await approveAgentPlanFromChat(input, { ...place, organizationId: null })).toMatchObject(
      { ok: false },
    );
    expect(fakes.approvePlan).not.toHaveBeenCalled();
  });
});
