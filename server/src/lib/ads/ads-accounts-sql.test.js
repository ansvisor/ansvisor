import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Ads Phase 1's read connections (00560): ad accounts, the ChatGPT Ads keys
 * and the daily metrics are the server's alone. Spend and keys are an Admin's
 * business and the plan decides what the Ads area shows, so a person's
 * session reads none of them. Read from the SQL, as the other migration tests
 * here do: the repository has no database tests.
 */

const root = new URL('../../../../', import.meta.url);
const raw = readFileSync(new URL('supabase/migrations/00560_ads_accounts.sql', root), 'utf8');
/** Without comments, on one line. */
const sql = raw.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
const TABLES = [
  'public.ads_accounts',
  'public.ads_account_keys',
  'public.ads_campaign_daily',
  'public.ads_search_term_daily',
];

/** One table's column list. */
function columns(name) {
  return sql.match(
    new RegExp(`create table if not exists public\\.${name} \\((.*?)\\); create`),
  )[1];
}

describe('00560 ads accounts and daily metrics', () => {
  it("refuses a member's direct select or write: RLS on, every grant revoked, none given back", () => {
    for (const table of TABLES) {
      expect(sql, table).toContain(`alter table ${table} enable row level security;`);
      expect(sql, table).toContain(
        `revoke all on table ${table} from public, anon, authenticated;`,
      );
      expect(sql, table).toContain(`grant all on table ${table} to service_role;`);
    }
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\b(anon|authenticated|public)\b/);
    expect(sql).not.toMatch(/create policy/);
  });

  it('scopes an account to its organization and brand, once per platform and external id', () => {
    const table = columns('ads_accounts');
    for (const column of [
      'organization_id uuid not null references public.organizations(id) on delete cascade',
      'brand_id uuid not null references public.brands(id) on delete cascade',
      "platform text not null check (platform in ('google', 'chatgpt'))",
      'integration_account_id uuid references public.integration_accounts(id) on delete set null',
      'unique (brand_id, platform, external_id)',
    ]) {
      expect(table, column).toContain(column);
    }
    // Google's manager id and sign-in never sit on a ChatGPT account.
    expect(table).toContain(
      "platform = 'google' or (login_customer_id is null and integration_account_id is null)",
    );
  });

  it('keeps a key and every metric row with its account, gone when the account goes', () => {
    expect(columns('ads_account_keys')).toContain(
      'account_id uuid primary key references public.ads_accounts(id) on delete cascade',
    );
    for (const name of ['ads_campaign_daily', 'ads_search_term_daily']) {
      expect(columns(name), name).toContain(
        'account_id uuid not null references public.ads_accounts(id) on delete cascade',
      );
    }
  });

  it("keys a metric row by its day, so the sync's upserts rewrite a day instead of adding one", () => {
    expect(columns('ads_campaign_daily')).toContain('primary key (account_id, campaign_id, day)');
    expect(columns('ads_search_term_daily')).toContain(
      'primary key (account_id, campaign_id, search_term, day)',
    );
  });

  it('applies again as it reads, in seconds: schema only, no row written', () => {
    expect(sql.match(/create table (?!if not exists)/g)).toBeNull();
    expect(sql.match(/create (unique )?index (?!if not exists)/g)).toBeNull();
    expect(sql).not.toMatch(/\b(insert into|update public|delete from)\b/);
  });
});
