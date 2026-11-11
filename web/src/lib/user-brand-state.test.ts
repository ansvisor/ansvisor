// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FOCUS_MAX,
  NAV_AREAS,
  STATE_MAX_BYTES,
  focusColumn,
  isCardHidden,
  isHiddenKey,
  isNavArea,
  jsonbTextBytes,
  parseUserBrandState,
  readFocus,
  readHidden,
  readNavSeen,
  skipKey,
  topicKey,
  ITEM_SEEN_MAX,
  actionSeenKey,
  isSeenKey,
  readSeenKeys,
  withHidden,
  withSeen,
  withSeenKey,
} from './user-brand-state';

/**
 * A person's Today and menu state on a brand (00529): what a row reads as,
 * how one key changes, and the table as the migration leaves it (the
 * repository has no database tests, so the SQL is read).
 */

const NOW = new Date('2026-11-11T10:00:00.000Z');
const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const A3 = '33333333-3333-4333-8333-333333333333';
const A4 = '44444444-4444-4444-8444-444444444444';
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

describe('the names the state accepts', () => {
  it('knows the menu areas a dot or Today compares with', () => {
    expect(NAV_AREAS).toEqual([
      'today',
      'action-center/actions',
      'insights',
      'mentions',
      'citations',
      'prompts/tracked',
      'prompts/suggestions',
      'traffic',
      'content',
      'settings/members',
      'settings/integrations',
      'settings/api',
    ]);
    expect(isNavArea('prompts/tracked')).toBe(true);
    for (const value of ['agents', 'Today', '', null, 3]) expect(isNavArea(value)).toBe(false);
  });

  it('knows the cards a person can hide, by key', () => {
    for (const key of [
      'setup',
      'prompts_check',
      skipKey(A1),
      skipKey(A1.toUpperCase()),
      topicKey('  Hiking backpacks '),
      'topic:Çanta ve sırt çantaları',
      `topic:${'x'.repeat(120)}`,
    ]) {
      expect(isHiddenKey(key), key).toBe(true);
    }
    expect(skipKey(A1.toUpperCase())).toBe(`skip:${A1}`);
    expect(topicKey('  Hiking backpacks ')).toBe('topic:Hiking backpacks');
    for (const key of [
      'Setup',
      'skip:42',
      'skip:',
      'topic:',
      'topic: padded',
      `topic:${'x'.repeat(121)}`,
      'topic:line\nbreak',
      '__proto__',
      null,
    ]) {
      expect(isHiddenKey(key), String(key)).toBe(false);
    }
  });
});

describe('reading a row', () => {
  it('is the empty state with no row yet', () => {
    expect(parseUserBrandState(null, NOW)).toEqual({ navSeen: {}, focus: [], hidden: {} });
  });

  it('keeps the known areas with a readable time, as ISO', () => {
    expect(
      readNavSeen({
        today: '2026-11-11T08:00:00Z',
        insights: '2026-11-10T08:00:00.000Z',
        agents: '2026-11-10T08:00:00Z',
        mentions: 'yesterday',
        citations: 7,
      }),
    ).toEqual({ today: '2026-11-11T08:00:00.000Z', insights: '2026-11-10T08:00:00.000Z' });
    expect(readNavSeen([])).toEqual({});
  });

  it('keeps up to 3 actions in the focus, each once, with when they were added', () => {
    const at = '2026-11-10T08:00:00.000Z';
    expect(
      readFocus([
        { id: A1, added_at: at },
        { id: A1.toUpperCase(), added_at: at },
        { id: 'nope', added_at: at },
        { id: A2 },
        { id: A2, added_at: 'soon' },
        'x',
        { id: A3, added_at: at },
        { id: A2, added_at: at },
        { id: A4, added_at: at },
      ]),
    ).toEqual([
      { id: A1, addedAt: at },
      { id: A3, addedAt: at },
      { id: A2, addedAt: at },
    ]);
    expect(readFocus({})).toEqual([]);
  });

  it('keeps the cards hidden for good or until a time still ahead', () => {
    expect(
      readHidden(
        {
          setup: null,
          prompts_check: later(-1),
          [skipKey(A1)]: later(7),
          'topic:Bags': later(30),
          'topic:Old': NOW.toISOString(),
          nope: null,
          [skipKey(A2)]: 5,
        },
        NOW,
      ),
    ).toEqual({ setup: null, [skipKey(A1)]: later(7), 'topic:Bags': later(30) });
  });

  it('says whether a card is hidden at a time', () => {
    const hidden = { setup: null, [skipKey(A1)]: later(7) };
    expect(isCardHidden(hidden, 'setup', NOW)).toBe(true);
    expect(isCardHidden(hidden, skipKey(A1), NOW)).toBe(true);
    expect(isCardHidden(hidden, skipKey(A1), new Date(later(8)))).toBe(false);
    expect(isCardHidden(hidden, 'prompts_check', NOW)).toBe(false);
  });
});

describe('changing one key', () => {
  it('marks an area seen, keeping the others and dropping unknown ones', () => {
    expect(withSeen({ today: '2026-11-10T08:00:00Z', agents: 'x' }, 'insights', NOW)).toEqual({
      today: '2026-11-10T08:00:00.000Z',
      insights: NOW.toISOString(),
    });
    expect(withSeen(null, 'today', NOW)).toEqual({ today: NOW.toISOString() });
  });

  it("keeps the pages' own keys beside the areas: the Audit page's parts and each action opened", () => {
    expect(isSeenKey('audit/auto')).toBe(true);
    expect(isSeenKey('audit/opportunities')).toBe(true);
    expect(isSeenKey(actionSeenKey(A1.toUpperCase()))).toBe(true);
    expect(isSeenKey('action:nope')).toBe(false);
    expect(isSeenKey('insights')).toBe(false);
    const current = {
      today: '2026-11-10T08:00:00Z',
      'audit/auto': '2026-11-09T08:00:00Z',
      [actionSeenKey(A1)]: '2026-11-08T08:00:00Z',
      other: '2026-11-08T08:00:00Z',
    };
    expect(readSeenKeys(current)).toEqual({
      'audit/auto': '2026-11-09T08:00:00.000Z',
      [actionSeenKey(A1)]: '2026-11-08T08:00:00.000Z',
    });
    // An area's visit keeps them, and a page key's keeps the areas.
    expect(withSeen(current, 'insights', NOW)).toEqual({
      today: '2026-11-10T08:00:00.000Z',
      insights: NOW.toISOString(),
      'audit/auto': '2026-11-09T08:00:00.000Z',
      [actionSeenKey(A1)]: '2026-11-08T08:00:00.000Z',
    });
    expect(withSeenKey(current, 'audit/opportunities', NOW)).toEqual({
      today: '2026-11-10T08:00:00.000Z',
      'audit/auto': '2026-11-09T08:00:00.000Z',
      'audit/opportunities': NOW.toISOString(),
      [actionSeenKey(A1)]: '2026-11-08T08:00:00.000Z',
    });
  });

  it('keeps actions opened within 30 days, the newest 60, well under the cap', () => {
    const key = (i: number) =>
      actionSeenKey(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const current: Record<string, string> = { [key(999)]: '2026-10-01T00:00:00.000Z' };
    for (let i = 0; i < 80; i++)
      current[key(i)] = new Date(NOW.getTime() - (i + 1) * 60_000).toISOString();
    const kept = withSeenKey(current, actionSeenKey(A1), NOW);
    expect(kept[actionSeenKey(A1)]).toBe(NOW.toISOString());
    expect(kept[key(999)]).toBeUndefined();
    expect(Object.keys(kept)).toHaveLength(ITEM_SEEN_MAX);
    expect(kept[key(0)]).toBeDefined();
    expect(kept[key(79)]).toBeUndefined();
    expect(
      jsonbTextBytes({
        ...kept,
        ...Object.fromEntries(NAV_AREAS.map((a) => [a, NOW.toISOString()])),
      }),
    ).toBeLessThan(STATE_MAX_BYTES);
  });

  it('writes the focus as the database keeps it', () => {
    expect(focusColumn([{ id: A1, addedAt: NOW.toISOString() }])).toEqual([
      { id: A1, added_at: NOW.toISOString() },
    ]);
  });

  it('hides a card, dropping what has expired', () => {
    expect(
      withHidden({ setup: null, [skipKey(A1)]: later(-1) }, skipKey(A2), later(7), NOW),
    ).toEqual({ setup: null, [skipKey(A2)]: later(7) });
  });

  it('stays under the database cap: the soonest to show again go first, the new key stays', () => {
    const current: Record<string, string | null> = { setup: null };
    for (let i = 0; i < 80; i++) current[topicKey(`${'t'.repeat(90)} ${i}`)] = later(i + 1);
    expect(jsonbTextBytes(current)).toBeGreaterThan(STATE_MAX_BYTES);
    const next = withHidden(current, 'prompts_check', later(1), NOW);
    expect(jsonbTextBytes(next)).toBeLessThanOrEqual(STATE_MAX_BYTES);
    expect(next.prompts_check).toBe(later(1));
    expect(next.setup).toBeNull();
    expect(next[topicKey(`${'t'.repeat(90)} 79`)]).toBe(later(80));
    expect(next[topicKey(`${'t'.repeat(90)} 0`)]).toBeUndefined();
  });

  it('counts jsonb text as PostgreSQL writes it, a space after each colon and comma', () => {
    // {"a": "b", "c": null} is 21 bytes.
    expect(jsonbTextBytes({ a: 'b', c: null })).toBeGreaterThanOrEqual(21);
    expect(jsonbTextBytes({ ç: 'é' })).toBeGreaterThanOrEqual('{"ç": "é"}'.length + 2);
  });
});

describe('00529: user_brand_state', () => {
  const dir = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));
  const file = readdirSync(dir).find((name) => name.startsWith('00529_'));
  const sql = readFileSync(`${dir}/${file}`, 'utf8')
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ');

  it('keeps one row per person and brand, gone with either', () => {
    expect(sql).toContain('create table if not exists public.user_brand_state (');
    expect(sql).toContain(
      'user_id uuid not null references auth.users(id) on delete cascade, brand_id uuid not null references public.brands(id) on delete cascade,',
    );
    expect(sql).toContain('primary key (user_id, brand_id)');
    expect(sql).toMatch(/create index if not exists \w+ on public\.user_brand_state \(brand_id\)/);
  });

  it('checks each jsonb: its type and the cap the web keeps under', () => {
    expect(sql).toContain("nav_seen jsonb not null default '{}'::jsonb");
    expect(sql).toContain("focus jsonb not null default '[]'::jsonb");
    expect(sql).toContain("hidden jsonb not null default '{}'::jsonb");
    for (const column of ['nav_seen', 'focus', 'hidden']) {
      expect(sql).toContain(`octet_length(${column}::text) <= ${STATE_MAX_BYTES}`);
    }
    expect(sql).toContain(`jsonb_array_length(focus) <= ${FOCUS_MAX}`);
    expect(sql).toContain('jsonb_path_exists(nav_seen, \'$.* ? (@.type() != "string")\')');
    expect(sql).toContain(
      'jsonb_path_exists(hidden, \'$.* ? (@.type() != "string" && @.type() != "null")\')',
    );
  });

  it('lets the person read and write only their own rows, on brands they can access', () => {
    expect(sql).toContain('alter table public.user_brand_state enable row level security');
    expect(sql).toContain('revoke all on table public.user_brand_state from anon, authenticated');
    expect(sql).toContain(
      'grant select, insert, update on table public.user_brand_state to authenticated',
    );
    expect(sql).not.toMatch(/grant [^;]*delete[^;]* to authenticated/);
    const policy = (name: string) =>
      sql.match(new RegExp(`create policy "user_brand_state: ${name}"[^;]*;`))?.[0] ?? '';
    expect(policy('own select')).toContain(
      'for select to authenticated using ( user_id = auth.uid() and brand_id in (select public.user_brand_ids()) )',
    );
    expect(policy('own insert')).toContain(
      'for insert to authenticated with check ( user_id = auth.uid() and public.can_access_brand(brand_id) )',
    );
    expect(policy('own update')).toContain(
      'for update to authenticated using ( user_id = auth.uid() and public.can_access_brand(brand_id) ) with check ( user_id = auth.uid() and public.can_access_brand(brand_id) )',
    );
  });

  it('keeps no demo-brand guard: UI state works on the demo brand', () => {
    expect(sql).not.toContain('refuse_demo_brand_writes');
  });
});
