import { describe, expect, it } from 'vitest';
import messages from '../../messages/en.json';
import { SERVER_ERROR_CODES, caughtErrorText, refusalError, serverErrorKey } from './server-error';

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
      // The demo brand has words of its own: its plan is fine, its data is a sample.
      [{ code: 'demo_brand' }, 403, 'serverErrors.demo_brand'],
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

  it('maps the web actions’ own refusals: a full plan, a missing role, a masked throw', () => {
    const cases: Array<[unknown, string]> = [
      [
        { code: 'plan_limit', limit: 'locations', error: 'Your Growth plan…' },
        'serverErrors.location_limit',
      ],
      [
        { code: 'plan_limit', limit: 'brands', error: 'Your plan includes 1 brand…' },
        'serverErrors.brand_limit',
      ],
      [{ code: 'not_allowed' }, 'serverErrors.forbidden'],
      [{ code: 'forbidden_role' }, 'serverErrors.forbidden'],
      [{ code: 'role_required' }, 'serverErrors.forbidden'],
      // An Admin-only change: requireAdmin's digest, the plan routes' admin_only.
      [
        Object.assign(new Error('masked'), { digest: 'admin_required' }),
        'serverErrors.admin_required',
      ],
      [
        { code: 'admin_only', error: 'Only admins can change the plan' },
        'serverErrors.admin_required',
      ],
      [Object.assign(new Error('masked'), { digest: 'demo_brand' }), 'serverErrors.demo_brand'],
      // Production keeps only a thrown server action error's digest.
      [
        Object.assign(new Error('masked'), { digest: 'subscription_inactive' }),
        'apiFailure.subscription',
      ],
      [Object.assign(new Error('masked'), { digest: 'plan_limit' }), 'apiFailure.plan'],
    ];
    for (const [body, key] of cases) {
      expect(serverErrorKey(body), JSON.stringify(body)).toBe(key);
      expect(typeof text(key), key).toBe('string');
    }
    expect(serverErrorKey(Object.assign(new Error('masked'), { digest: '1234567' }))).toBeNull();
  });

  it('keeps a refused call’s code and status on the error it throws', () => {
    const err = refusalError({ error: 'quota_exhausted' }, 'Failed', 429);
    expect(err.message).toBe('quota_exhausted');
    expect(serverErrorKey(err, 429)).toBe('apiFailure.limit');
    const plain = refusalError({}, 'Couldn’t cancel.', 500);
    expect(plain.message).toBe('Couldn’t cancel.');
    expect(serverErrorKey(plain)).toBeNull();
    expect(refusalError(null, 'Fallback').message).toBe('Fallback');
  });

  it('says what a caught error said, unless a server action threw it', () => {
    expect(caughtErrorText(new TypeError('Failed to fetch'), 'Fallback')).toBe('Failed to fetch');
    expect(caughtErrorText(Object.assign(new Error('masked'), { digest: '1' }), 'Fallback')).toBe(
      'Fallback',
    );
    expect(caughtErrorText('boom', 'Fallback')).toBe('Fallback');
    expect(caughtErrorText(new Error(''), 'Fallback')).toBe('Fallback');
  });

  it('leaves what it does not know to the caller', () => {
    expect(serverErrorKey({ error: 'Draft not found' })).toBeNull();
    expect(serverErrorKey({ code: 'something_new' })).toBeNull();
    expect(serverErrorKey(null)).toBeNull();
    expect(serverErrorKey('boom')).toBeNull();
  });
});
