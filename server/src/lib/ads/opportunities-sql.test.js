import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Ads' thresholds, decisions and weekly snapshots (00531) are the server's
 * alone. A snapshot or a decision is written for every buying-intent prompt,
 * the rows Starter and the trial see locked too (ADS-01 §8), so a person's
 * session must read none of them: the API serves the rows the plan reads.
 * Read from the SQL, as the other migration tests here do: the repository
 * has no database tests.
 */

const root = new URL('../../../../', import.meta.url);
const raw = readFileSync(new URL('supabase/migrations/00531_ads_opportunities.sql', root), 'utf8');
/** Without comments, on one line. */
const sql = raw.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
const TABLES = ['ads_settings', 'ads_decision_overrides', 'ads_opportunity_snapshots'];

describe('00531 ads tables', () => {
  it("refuses a member's direct select: RLS on, every grant revoked, none given back", () => {
    for (const table of TABLES) {
      expect(sql, table).toContain(`alter table public.${table} enable row level security;`);
      expect(sql, table).toContain(`revoke all on table public.${table} from anon, authenticated;`);
      expect(sql, table).toContain(`grant all on table public.${table} to service_role;`);
    }
    // A session's role is given nothing back, on any table, nor through a policy.
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\b(anon|authenticated|public)\b/);
    expect(sql).not.toMatch(/create policy/);
  });

  it('applies again as it reads: every table and index if not exists', () => {
    expect(sql.match(/create table (?!if not exists)/g)).toBeNull();
    expect(sql.match(/create index (?!if not exists)/g)).toBeNull();
  });
});
