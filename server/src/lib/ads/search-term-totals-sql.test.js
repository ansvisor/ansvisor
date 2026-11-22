import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 00561: the search-term totals the Overlap view reads (lib/ads/paid.js).
 * A function only, callable by the service role alone, like the tables it
 * reads (00560). Read from the SQL, as the other migration tests here do.
 */

const root = new URL('../../../../', import.meta.url);
const raw = readFileSync(
  new URL('supabase/migrations/00561_ads_search_term_totals.sql', root),
  'utf8',
);
/** Without comments, on one line. */
const sql = raw.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
const FN = 'public.ads_search_term_totals(uuid[], date, date)';

describe('00561 ads search term totals', () => {
  it('only adds a function: no table, no write, no backfill', () => {
    expect(sql).toContain('create or replace function public.ads_search_term_totals(');
    expect(sql).not.toMatch(/create table|alter table|insert into|update public|delete from/);
  });

  it('runs as its caller and only the service role may call it', () => {
    expect(sql).toContain('security invoker');
    expect(sql).not.toContain('security definer');
    expect(sql).toContain(`revoke all on function ${FN} from public, anon, authenticated;`);
    expect(sql).toContain(`grant execute on function ${FN} to service_role;`);
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\b(anon|authenticated|public)\b/);
  });

  it('sums the given accounts over the range and keeps only terms that cost something', () => {
    expect(sql).toContain('where d.account_id = any (p_account_ids)');
    expect(sql).toContain('d.day between p_from and p_to');
    expect(sql).toContain('group by d.account_id, d.search_term');
    expect(sql).toContain('having sum(d.cost_micros) > 0');
    // A fixed order, so the server can read it in pages.
    expect(sql).toContain('order by d.account_id, d.search_term');
  });
});
