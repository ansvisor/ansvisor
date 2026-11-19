import { describe, expect, it } from 'vitest';
import messages from '../../messages/en.json';
import { SERVER_ERROR_CODES, serverErrorKey } from './server-error';

/** The text at a dotted key in en.json, or undefined. */
function text(key: string | null): unknown {
  return key
    ?.split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      messages,
    );
}

describe('serverErrorKey (LOC-008)', () => {
  it('maps the server’s stable codes to message keys that exist', () => {
    const cases: Array<[unknown, number | undefined, string]> = [
      [{ code: 'subscription_inactive' }, 402, 'apiFailure.subscription'],
      [{ code: 'demo_brand' }, 403, 'apiFailure.subscription'],
      [{ code: 'not_in_workspace' }, 403, 'apiFailure.workspace'],
      [{ code: 'no_brand_access' }, 403, 'apiFailure.workspace'],
      [{ code: 'not_found' }, 404, 'apiFailure.not_found'],
      [{ error: 'quota_exhausted' }, 429, 'apiFailure.limit'],
      [{ error: 'plan_limit' }, 429, 'apiFailure.limit'],
      [{ error: 'plan_limit' }, 403, 'apiFailure.plan'],
      [{ code: 'rate_limited' }, 429, 'serverErrors.rate_limited'],
      [{ error: 'rate_limited', code: 'onboarding_daily_limit' }, 429, 'serverErrors.rate_limited'],
      [{ code: 'invalid' }, 400, 'serverErrors.invalid'],
      [{ code: 'server_error' }, 500, 'serverErrors.server_error'],
    ];
    for (const [body, status, key] of cases) {
      expect(serverErrorKey(body, status), JSON.stringify(body)).toBe(key);
      expect(typeof text(key), key).toBe('string');
    }
  });

  it('has words for every code it maps itself', () => {
    for (const code of SERVER_ERROR_CODES) {
      expect(typeof text(`serverErrors.${code}`), code).toBe('string');
    }
  });

  it('leaves what it does not know to the caller', () => {
    expect(serverErrorKey({ error: 'Draft not found' })).toBeNull();
    expect(serverErrorKey({ code: 'something_new' })).toBeNull();
    expect(serverErrorKey(null)).toBeNull();
    expect(serverErrorKey('boom')).toBeNull();
  });
});
