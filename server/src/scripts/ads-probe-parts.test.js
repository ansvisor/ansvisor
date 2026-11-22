import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  accessibleCustomerIds,
  customerId,
  googleAdsErrorCodes,
  googleAdsHeaders,
  googleAdsVerdict,
  redact,
  safeProbePath,
  shapeOf,
} from './ads-probe-parts.js';

/** A Google Ads error answer with one error code. */
const adsError = (status, kind, code, message = 'Request failed') => ({
  error: {
    code: status,
    message,
    details: [{ errors: [{ errorCode: { [kind]: code }, message: 'detail' }] }],
  },
});

describe('Google Ads headers and ids', () => {
  it('sends the developer token, and login-customer-id only when a manager is named', () => {
    expect(googleAdsHeaders({ developerToken: 'dev-tok' })).toEqual({
      'developer-token': 'dev-tok',
    });
    expect(
      googleAdsHeaders({ developerToken: 'dev-tok', loginCustomerId: '123-456-7890' }),
    ).toEqual({ 'developer-token': 'dev-tok', 'login-customer-id': '1234567890' });
    // Google issues no developer tokens since 9 Sep 2026: none, no header.
    expect(googleAdsHeaders({ loginCustomerId: '123-456-7890' })).toEqual({
      'login-customer-id': '1234567890',
    });
    expect(googleAdsHeaders({})).toEqual({});
  });

  it('reads customer ids from resource names and dashed numbers', () => {
    expect(customerId('customers/1234567890')).toBe('1234567890');
    expect(customerId('123-456-7890')).toBe('1234567890');
    expect(accessibleCustomerIds({ resourceNames: ['customers/1', 'customers/22'] })).toEqual([
      '1',
      '22',
    ]);
    expect(accessibleCustomerIds({})).toEqual([]);
  });
});

describe('googleAdsVerdict', () => {
  it('says OK for a 2xx', () => {
    expect(googleAdsVerdict(200, {})).toBe('OK');
  });

  it('names Test access, a manager to go through, and a bad token', () => {
    expect(
      googleAdsVerdict(403, adsError(403, 'authorizationError', 'DEVELOPER_TOKEN_NOT_APPROVED')),
    ).toMatch(/Test access/);
    expect(
      googleAdsVerdict(403, adsError(403, 'authorizationError', 'USER_PERMISSION_DENIED')),
    ).toMatch(/GOOGLE_ADS_LOGIN_CUSTOMER_ID/);
    expect(
      googleAdsVerdict(401, adsError(401, 'authenticationError', 'DEVELOPER_TOKEN_INVALID')),
    ).toMatch(/developer token is wrong/);
    expect(
      googleAdsErrorCodes(adsError(403, 'authorizationError', 'CUSTOMER_NOT_ENABLED')),
    ).toEqual(['authorizationError.CUSTOMER_NOT_ENABLED']);
  });

  it('points at a retired version on 404 and a missing scope on 403', () => {
    expect(googleAdsVerdict(404, null)).toMatch(/GOOGLE_ADS_API_VERSION/);
    expect(
      googleAdsVerdict(403, {
        error: { message: 'Request had insufficient authentication scopes.' },
      }),
    ).toMatch(/adwords/);
  });

  it('says an unknown error is unexpected, with its code, rather than guess', () => {
    expect(googleAdsVerdict(500, adsError(500, 'internalError', 'INTERNAL_ERROR'))).toBe(
      'Unexpected answer (500): internalError.INTERNAL_ERROR: Request failed',
    );
  });
});

describe('redact', () => {
  it('replaces every secret, and ignores empty or short ones', () => {
    expect(redact('token abcdef123 and abcdef123', ['abcdef123', '', undefined, 'ab'])).toBe(
      'token *** and ***',
    );
  });
});

describe('shapeOf', () => {
  it('shows keys and list lengths, never values', () => {
    const shape = shapeOf({ data: [{ id: 'a1', spend: 12 }], has_more: false });
    expect(shape).toEqual({
      type: 'object',
      keys: ['data', 'has_more'],
      data: { type: 'array', length: 1, itemKeys: ['id', 'spend'] },
    });
    expect(JSON.stringify(shape)).not.toContain('a1');
    expect(shapeOf(null)).toEqual({ type: 'null' });
  });
});

describe('safeProbePath', () => {
  it('takes relative paths only, with no query, traversal or other host', () => {
    expect(safeProbePath('/accounts')).toBe('/accounts');
    expect(safeProbePath(' /v1/campaigns ')).toBe('/v1/campaigns');
    for (const bad of ['accounts', '//evil.example', '/a/../b', '/a?x=1', '/a b', '']) {
      expect(safeProbePath(bad), bad).toBeNull();
    }
  });
});

// The probes use real keys, so they only run by hand: nothing in the app or
// the server's npm scripts may import or start them.
describe('the Ads probes stay manual scripts', () => {
  const src = fileURLToPath(new URL('..', import.meta.url));
  const files = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(full);
      return entry.name.endsWith('.js') ? [full] : [];
    });

  it('are not imported outside src/scripts', () => {
    const importers = files(src)
      .filter((file) => !relative(src, file).startsWith('scripts/'))
      .filter((file) =>
        /probe-google-ads|probe-openai-ads|ads-probe-parts/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(src, file));
    expect(importers).toEqual([]);
  });

  it('are not npm scripts', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/probe-google-ads|probe-openai-ads/);
  });
});
