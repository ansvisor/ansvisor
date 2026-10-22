import { describe, expect, it } from 'vitest';
import { apiFailure } from './api-failure';

describe('apiFailure', () => {
  it('reads a bad or expired session from 401 only', () => {
    // middleware/index.js answers with a message.
    expect(apiFailure(401, { message: 'Unauthorized API Request' })).toBe('session');
    // The old bare "Unauthorized" was another workspace's brand, not the session.
    expect(apiFailure(403, { error: 'Unauthorized' })).toBe('workspace');
  });

  it('tells a used-up allowance from a plan without the feature', () => {
    expect(apiFailure(429, { error: 'quota_exhausted' })).toBe('limit');
    expect(apiFailure(403, { error: 'plan_limit' })).toBe('plan');
    expect(apiFailure(402, { error: 'no_subscription' })).toBe('plan');
  });

  it('reads a rate limit as busy, never as an allowance to upgrade', () => {
    // server/src/middleware/rate-limiter.js: a message, no error.
    const limiter = { success: false, message: 'Too many requests, please try again later.' };
    expect(apiFailure(429, limiter)).toBe('busy');
    // A monthly budget used up (plan-guard's PlanLimitError) is an allowance.
    expect(apiFailure(429, { error: 'plan_limit' })).toBe('limit');
    // Any other 429 is a plain failure.
    expect(apiFailure(429, { error: 'something_else' })).toBe('failed');
  });

  it("reads another workspace's brand from the server's code, and nothing else", () => {
    expect(
      apiFailure(403, { error: "This brand isn't in your workspace", code: 'not_in_workspace' }),
    ).toBe('workspace');
    // Before the server deploy, its bare 403.
    expect(apiFailure(403, { error: 'Unauthorized' })).toBe('workspace');
    // Any other 403 is no workspace, and no plan.
    expect(apiFailure(403, { error: 'Only admins can do this' })).toBe('failed');
  });

  it("doesn't take an account without an organization for a plan to upgrade", () => {
    // plan-guard's 400 carries plan_limit too.
    expect(apiFailure(400, { error: 'plan_limit' })).toBe('failed');
  });

  it('reads something gone as not found, and anything else as a failure', () => {
    expect(apiFailure(404, { error: 'Opportunity not found' })).toBe('not_found');
    expect(apiFailure(500, {})).toBe('failed');
    expect(apiFailure(502)).toBe('failed');
  });
});
