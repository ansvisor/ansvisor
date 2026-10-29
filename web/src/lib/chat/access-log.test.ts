// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessDeniedEvent, recordAccessDenied, type AccessDeniedContext } from './access-log';

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
  it('writes the event to the server log', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await recordAccessDenied(ctx, { code: 'forbidden_role', role: 'analyst', roles: ['admin'] });
    expect(info).toHaveBeenCalledWith(
      '[chat] access.denied',
      expect.stringContaining('"forbidden_role"'),
    );
  });

  it('never fails the run', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('log down');
    });
    await expect(recordAccessDenied(ctx, { code: 'policy_never' })).resolves.toBeUndefined();
  });
});
