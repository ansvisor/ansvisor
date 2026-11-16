import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
const { AI_USAGE_FEATURES } = await import('../plan-guard.js');

/**
 * Ads' ad drafts (00532) are the server's alone: a draft is written for a
 * prompt Starter or the trial may see locked (a plan that went down keeps
 * its rows), so a person's session reads none, and the API serves the rows
 * the plan opens (opportunity.js). And the 'ads' AI usage feature, added
 * without a scan of prompt_improve_usage under its lock. Read from the SQL,
 * as the other migration tests here do: the repository has no database
 * tests.
 */

const root = new URL('../../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const raw = read('supabase/migrations/00532_ads_ad_drafts.sql');
/** Without comments, on one line. */
const sql = raw.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
const TABLE = 'public.ads_ad_drafts';

describe('00532 ads_ad_drafts', () => {
  it("refuses a member's direct select or write: RLS on, every grant revoked, none given back", () => {
    expect(sql).toContain(`alter table ${TABLE} enable row level security;`);
    expect(sql).toContain(`revoke all on table ${TABLE} from anon, authenticated;`);
    expect(sql).toContain(`grant all on table ${TABLE} to service_role;`);
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\b(anon|authenticated|public)\b/);
    expect(sql).not.toMatch(/create policy/);
  });

  it('is scoped to its organization and brand, and keeps one set of drafts per key', () => {
    const table = sql.match(
      /create table if not exists public\.ads_ad_drafts \((.*?)\); create/,
    )[1];
    for (const column of [
      'organization_id uuid not null references public.organizations(id) on delete cascade',
      'brand_id uuid not null references public.brands(id) on delete cascade',
      'prompt_id uuid not null references public.prompts(id) on delete cascade',
      "channel text not null check (channel in ('chatgpt', 'google', 'microsoft'))",
      "source text not null default 'drawer' check (source in ('drawer', 'chat', 'agent'))",
      'fact_ids uuid[] not null',
      'gate jsonb not null',
    ]) {
      expect(table, column).toContain(column);
    }
    expect(sql).toMatch(
      /create unique index if not exists ads_ad_drafts_request_key_idx on public\.ads_ad_drafts \(prompt_id, request_key, channel\) where request_key is not null;/,
    );
  });

  it('applies again as it reads, in seconds: schema only, no row written', () => {
    expect(sql.match(/create table (?!if not exists)/g)).toBeNull();
    expect(sql.match(/create (unique )?index (?!if not exists)/g)).toBeNull();
    expect(sql).not.toMatch(/\b(insert into|update public|delete from)\b/);
  });
});

describe("00532's 'ads' AI usage feature", () => {
  const check = sql.match(
    /alter table public\.prompt_improve_usage drop constraint if exists prompt_improve_usage_feature_check, add constraint prompt_improve_usage_feature_check check \((.*?)\) not valid;/,
  );

  it('swaps the check in one statement, not valid: no scan under the lock, and no wait past 3 s', () => {
    expect(check).not.toBeNull();
    expect(sql).toMatch(/set lock_timeout = '3s'; alter table public\.prompt_improve_usage drop/);
    expect(sql).toMatch(/not valid; reset lock_timeout;/);
    // Validating scans the table: run on its own, never inside the migration.
    expect(sql).not.toMatch(/validate constraint/);
    expect(raw).toMatch(/--\s+validate constraint prompt_improve_usage_feature_check;/);
  });

  it("allows every feature it did and 'ads', which the meter lists on both sides", () => {
    const allowed = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const before = read('supabase/migrations/00405_chat_ai_budget.sql')
      .match(/feature in \(([^)]*)\)/)[1]
      .match(/'([a-z_]+)'/g)
      .map((f) => f.slice(1, -1));
    expect(allowed).toEqual([...before, 'ads']);
    const written = Object.values(AI_USAGE_FEATURES)
      .flat()
      .filter((f) => f !== 'other');
    expect(allowed.filter((f) => written.includes(f)).sort()).toEqual([...written].sort());
    const web = read('web/src/lib/billing/ai-usage.ts')
      .match(/export const AI_USAGE_FEATURES = \[([^\]]*)\]/)[1]
      .match(/'([a-z_]+)'/g)
      .map((f) => f.slice(1, -1));
    expect(web).toEqual(Object.keys(AI_USAGE_FEATURES));
    const labels = JSON.parse(read('web/messages/en.json'));
    const features = JSON.stringify(labels).match(/"features":\{"improve":[^}]*\}/)[0];
    expect(JSON.parse(features.slice('"features":'.length))).toHaveProperty('ads');
  });

  it('is in schema.sql', () => {
    expect(read('supabase/schema.sql')).toContain(raw.trim());
  });
});
