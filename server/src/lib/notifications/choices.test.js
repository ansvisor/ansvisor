import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rows: [], error: null, orgs: [] }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        then: (resolve) =>
          table === 'organizations'
            ? resolve({ data: db.orgs, error: null })
            : resolve({ data: db.error ? null : db.rows, error: db.error }),
      };
      return chain;
    },
  },
}));
const readers = vi.hoisted(() => ({ map: new Map() }));
vi.mock('../access.js', () => ({ brandReaders: async () => readers.map }));

const { KIND_DEFAULTS, activeOrgIds, brandAudience, choosing } = await import('./choices.js');

const here = path.dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  db.rows = [];
  db.error = null;
  readers.map = new Map([
    ['ana', new Set(['b1'])],
    ['bo', new Set(['b1'])],
    ['cy', new Set(['b1'])],
  ]);
});

describe('who gets a notification e-mail of a brand (Settings › Notifications)', () => {
  it('uses the defaults the web page shows a person who hasn’t saved', () => {
    const web = fs.readFileSync(
      path.join(here, '../../../../web/src/lib/notification-preferences.ts'),
      'utf8',
    );
    const specs = [...web.matchAll(/kind: '([a-z_]+)',[\s\S]*?fallback: '([a-z]+)'/g)];
    const fromWeb = Object.fromEntries(
      specs.map(([, kind, fallback]) => [kind, fallback]).filter(([kind]) => kind in KIND_DEFAULTS),
    );
    expect(fromWeb).toEqual({ ...KIND_DEFAULTS });
  });

  it('gives each reader of the brand their brand row, else All my brands, else the default', async () => {
    db.rows = [
      { user_id: 'ana', brand_id: null, frequency: 'daily' },
      { user_id: 'ana', brand_id: 'b1', frequency: 'instant' },
      { user_id: 'bo', brand_id: null, frequency: 'daily' },
      { user_id: 'bo', brand_id: 'b2', frequency: 'instant' },
      // Someone who can't see the brand.
      { user_id: 'zed', brand_id: null, frequency: 'instant' },
    ];
    const audience = await brandAudience('o1', 'b1', 'critical_action');
    expect(Object.fromEntries(audience)).toEqual({ ana: 'instant', bo: 'daily', cy: 'off' });
    expect(choosing(audience, 'daily')).toEqual(['bo']);
  });

  it('gives everyone the default on a database without 00554, and throws any other error', async () => {
    db.error = { code: '42P01', message: 'missing' };
    expect(Object.fromEntries(await brandAudience('o1', 'b1', 'drafts_review'))).toEqual({
      ana: 'weekly',
      bo: 'weekly',
      cy: 'weekly',
    });
    db.error = { code: 'XX000', message: 'boom' };
    await expect(brandAudience('o1', 'b1', 'drafts_review')).rejects.toThrow('boom');
  });
});

describe('active workspaces only (as the Pulse)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps workspaces active or trialing on Ansvisor Cloud, and every one self-hosted', async () => {
    db.orgs = [
      { id: 'o1', subscription_status: 'active' },
      { id: 'o2', subscription_status: 'trialing' },
      { id: 'o3', subscription_status: 'canceled' },
      { id: 'o4', subscription_status: null },
    ];
    vi.stubEnv('IS_CLOUD', 'true');
    expect([...(await activeOrgIds(['o1', 'o2', 'o3', 'o4']))]).toEqual(['o1', 'o2']);
    vi.stubEnv('IS_CLOUD', 'false');
    expect((await activeOrgIds(['o1', 'o3'])).has('o3')).toBe(true);
  });
});
