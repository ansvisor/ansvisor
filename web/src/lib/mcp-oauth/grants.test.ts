// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Connections and their tokens (00510): an access token is good only while
 * it and its connection stand, before it expires, for the MCP endpoint; a
 * revoke ends the connection and every token; only hashes are written.
 */

interface Call {
  table: string;
  op: string;
  payload?: unknown;
  filters: [string, string, unknown][];
}
const calls: Call[] = [];
const result = vi.hoisted(() => ({ data: null as unknown, error: null as unknown }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const query = {
        select: () => query,
        insert: (payload: unknown) => {
          call.op = 'insert';
          call.payload = payload;
          return query;
        },
        update: (payload: unknown) => {
          call.op = 'update';
          call.payload = payload;
          return query;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push(['eq', column, value]);
          return query;
        },
        is: (column: string, value: unknown) => {
          call.filters.push(['is', column, value]);
          return query;
        },
        maybeSingle: async () => result,
        single: async () => result,
        then: (resolve: (value: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve({ data: null, error: result.error }).then(resolve, reject),
      };
      return query;
    },
  },
}));

const { checkAccessToken, issueTokenPair, narrowScopes, revokeGrant, touchGrant } =
  await import('./grants');
const { hashSecret } = await import('./tokens');

const RESOURCE = 'https://app.ansvisor.com/api/mcp';
const TOKEN = 'ans_oat_abc';
const grant = {
  id: 'grant-1',
  user_id: 'user-1',
  organization_id: 'org-1',
  client_id: 'ansc_x',
  client_name: 'Claude',
  redirect_host: 'claude.ai',
  scopes: ['mcp:read', 'mcp:write'],
  resource: RESOURCE,
  created_at: '2026-11-01T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
};
const inAnHour = () => new Date(Date.now() + 3600_000).toISOString();

beforeEach(() => {
  calls.length = 0;
  result.data = null;
  result.error = null;
});

describe('checkAccessToken', () => {
  it('finds the connection by the hash, never the token', async () => {
    result.data = {
      scopes: ['mcp:read'],
      expires_at: inAnHour(),
      revoked_at: null,
      oauth_grants: grant,
    };
    expect(await checkAccessToken(TOKEN, RESOURCE)).toEqual({
      ok: true,
      grant,
      scopes: ['mcp:read'],
    });
    expect(calls[0].table).toBe('oauth_tokens');
    expect(calls[0].filters).toEqual([
      ['eq', 'token_hash', hashSecret(TOKEN)],
      ['eq', 'kind', 'access'],
    ]);
  });

  it('refuses what is not an access token without a lookup', async () => {
    expect(await checkAccessToken('ans_ort_abc', RESOURCE)).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses an unknown, revoked, expired or foreign token', async () => {
    expect(await checkAccessToken(TOKEN, RESOURCE)).toEqual({ ok: false, reason: 'unknown' });

    const row = {
      scopes: ['mcp:read'],
      expires_at: inAnHour(),
      revoked_at: null,
      oauth_grants: grant,
    };
    result.data = { ...row, revoked_at: '2026-11-02T00:00:00Z' };
    expect(await checkAccessToken(TOKEN, RESOURCE)).toEqual({ ok: false, reason: 'revoked' });

    result.data = { ...row, oauth_grants: { ...grant, revoked_at: '2026-11-02T00:00:00Z' } };
    expect(await checkAccessToken(TOKEN, RESOURCE)).toEqual({ ok: false, reason: 'revoked' });

    result.data = { ...row, expires_at: new Date(Date.now() - 1000).toISOString() };
    expect(await checkAccessToken(TOKEN, RESOURCE)).toEqual({ ok: false, reason: 'expired' });

    result.data = { ...row, oauth_grants: { ...grant, resource: 'https://other.example/api/mcp' } };
    expect(await checkAccessToken(TOKEN, RESOURCE)).toEqual({
      ok: false,
      reason: 'wrong_resource',
    });
  });

  it('never gives a token more than its connection', async () => {
    result.data = {
      scopes: ['mcp:read', 'mcp:write'],
      expires_at: inAnHour(),
      revoked_at: null,
      oauth_grants: { ...grant, scopes: ['mcp:read'] },
    };
    expect(await checkAccessToken(TOKEN, RESOURCE)).toMatchObject({
      ok: true,
      scopes: ['mcp:read'],
    });
    expect(narrowScopes(['mcp:write', 'mcp:read'], ['mcp:read', 'mcp:write'])).toEqual([
      'mcp:read',
      'mcp:write',
    ]);
  });

  it('throws when the token cannot be read', async () => {
    result.error = { message: 'down' };
    await expect(checkAccessToken(TOKEN, RESOURCE)).rejects.toThrow('down');
  });
});

describe('revokeGrant', () => {
  it('ends the connection, with why, and every token it has', async () => {
    await revokeGrant('grant-1', 'person');
    expect(calls.map((call) => [call.table, call.op])).toEqual([
      ['oauth_grants', 'update'],
      ['oauth_tokens', 'update'],
    ]);
    expect(calls[0].payload).toMatchObject({ revoked_reason: 'person' });
    expect(calls[0].filters).toEqual([
      ['eq', 'id', 'grant-1'],
      ['is', 'revoked_at', null],
    ]);
    expect(calls[1].filters).toEqual([
      ['eq', 'grant_id', 'grant-1'],
      ['is', 'revoked_at', null],
    ]);
  });
});

describe('issueTokenPair', () => {
  it('stores only the hashes of a new access and refresh token', async () => {
    const pair = await issueTokenPair('grant-1', ['mcp:read']);
    expect(pair.accessToken).toMatch(/^ans_oat_/);
    expect(pair.refreshToken).toMatch(/^ans_ort_/);
    expect(pair.expiresIn).toBe(3600);
    const rows = calls[0].payload as Record<string, unknown>[];
    expect(rows).toEqual([
      expect.objectContaining({
        grant_id: 'grant-1',
        kind: 'access',
        token_hash: hashSecret(pair.accessToken),
        scopes: ['mcp:read'],
      }),
      expect.objectContaining({ kind: 'refresh', token_hash: hashSecret(pair.refreshToken) }),
    ]);
    expect(JSON.stringify(rows)).not.toContain(pair.accessToken);
    const refreshDays = (Date.parse(rows[1].expires_at as string) - Date.now()) / (24 * 3600_000);
    expect(Math.round(refreshDays)).toBe(30);
  });
});

describe('touchGrant', () => {
  it('writes the last use at most every five minutes', () => {
    touchGrant({ id: 'grant-1', last_used_at: new Date().toISOString() });
    expect(calls).toHaveLength(0);
    touchGrant({ id: 'grant-1', last_used_at: new Date(Date.now() - 6 * 60_000).toISOString() });
    touchGrant({ id: 'grant-2', last_used_at: null });
    expect(calls.map((call) => call.filters[0])).toEqual([
      ['eq', 'id', 'grant-1'],
      ['eq', 'id', 'grant-2'],
    ]);
  });
});
