import { describe, expect, it } from 'vitest';
import { apiFailure } from './api-failure';

describe('apiFailure', () => {
  it('reads a bad or expired session from 401 only', () => {
    expect(apiFailure(401, { error: 'Unauthorized API Request' })).toBe('session');
    // The old bare "Unauthorized" was another workspace's brand, not the session.
    expect(apiFailure(403, { error: 'Unauthorized' })).toBe('workspace');
  });

  it('tells a used-up allowance from a plan without the feature', () => {
    expect(apiFailure(429, { error: 'quota_exhausted' })).toBe('limit');
    expect(apiFailure(403, { error: 'plan_limit' })).toBe('plan');
    expect(apiFailure(402, { error: 'no_subscription' })).toBe('plan');
  });

  it('reads something gone as not found, and anything else as a failure', () => {
    expect(apiFailure(404, { error: 'Opportunity not found' })).toBe('not_found');
    expect(apiFailure(500, {})).toBe('failed');
    expect(apiFailure(502)).toBe('failed');
  });
});
