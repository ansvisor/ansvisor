// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const recordActivity = vi.hoisted(() => vi.fn());
vi.mock('./activity', () => ({ recordActivity }));

const { accessDeniedEvent, recordAccessDenied } = await import('./access-log');
type AccessDeniedContext = import('./access-log').AccessDeniedContext;

/** Every denial is an `access.denied` event (CHAT-20 §4c). */

const ctx: AccessDeniedContext = {
  userId: 'u1',
  organizationId: 'o1',
  brandId: 'b1',
  toolKey: 'saveDraft',
  toolClass: 'write',
  surface: 'chat',
  conversationId: 'c1',
};

afterEach(() => vi.restoreAllMocks());

describe('accessDeniedEvent', () => {
  it('keeps who, which tool by its label key, why, where and in which run', () => {
    expect(accessDeniedEvent(ctx, { code: 'plan_locked', needs: 'growth' })).toEqual({
      kind: 'access.denied',
      userId: 'u1',
      organizationId: 'o1',
      brandId: 'b1',
      toolKey: 'saveDraft',
      toolClass: 'write',
      surface: 'chat',
      reason: 'plan_locked',
      detail: { needs: 'growth' },
      conversationId: 'c1',
      runId: null,
    });
  });

  it("names no brand the person can't see", () => {
    expect(accessDeniedEvent(ctx, { code: 'brand_scope' }).brandId).toBeNull();
  });
});

describe('recordAccessDenied', () => {
  it("writes the denial's row in the Activity log", async () => {
    recordActivity.mockResolvedValue('row-1');
    const denial = { code: 'forbidden_role', role: 'analyst', roles: ['admin'] } as const;
    await recordAccessDenied(ctx, denial);
    expect(recordActivity).toHaveBeenCalledWith(accessDeniedEvent(ctx, denial));
  });

  it('never fails the run', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    recordActivity.mockRejectedValue(new Error('log down'));
    await expect(recordAccessDenied(ctx, { code: 'policy_never' })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
