// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_MERGED_AT_ONCE } from './competitor-merge';

/**
 * Merging duplicate competitors' migration (00543), read from the SQL as the
 * repository has no database tests (supabase/schema.sql is every migration
 * in order): schema and functions only, so it applies in seconds and again
 * without harm; a merged competitor's row moves out of competitors, so every
 * read of the brand's competitors leaves it out, and only the merge's own
 * functions read where it went.
 */

const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const SCHEMA = readFileSync(root('supabase/schema.sql'), 'utf8');

/** SQL on one line, its comments left out. */
const flat = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const parts = SCHEMA.split(/^-- migrations\/(\S+\.sql)$/m);
function migration(number: string): string {
  const at = parts.findIndex((part) => part.startsWith(`${number}_`));
  if (at < 0) throw new Error(`No migration ${number}`);
  return flat(parts[at + 1]);
}

const sql = migration('00543');
/** Its top-level statements: function bodies ($$ … $$) and comment texts left out. */
const statements = sql
  .replace(/\$\$.*?\$\$/g, '$$body$$')
  .replace(/comment on (table|column|function) [^;]*? is '(?:[^']|'')*';/g, '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

/** A function's body in 00543. */
function body(name: string): string {
  const match = new RegExp(
    `create or replace function public\\.${name}\\(.*?\\$\\$(.*?)\\$\\$`,
  ).exec(sql);
  if (!match) throw new Error(`No function ${name}`);
  return match[1];
}

describe('00543: merged competitors', () => {
  it('is schema and functions only: no row written, rewritten or backfilled outside a function', () => {
    for (const statement of statements) {
      expect(statement).not.toMatch(/^(update|insert|delete|truncate)\b/i);
      expect(statement).not.toMatch(/^alter table public\.(competitors|prompt_results)\b/i);
    }
  });

  it('is re-runnable: if not exists, drop … if exists, create or replace', () => {
    expect(sql).toContain('create table if not exists public.merged_competitors (');
    expect(sql).toContain('create index if not exists merged_competitors_brand_idx');
    expect(sql).toContain('create index if not exists merged_competitors_kept_idx');
    expect(sql).toContain(
      'drop trigger if exists merged_competitors_check on public.merged_competitors;',
    );
    expect(sql).toContain(
      'drop policy if exists "merged_competitors: member select" on public.merged_competitors;',
    );
    for (const statement of statements.filter((s) =>
      /^create (function|trigger|policy)/i.test(s),
    )) {
      expect(statement).toMatch(/^create (trigger|policy)/i);
    }
  });

  it('keeps the kept one live, of the same brand and not itself', () => {
    expect(sql).toContain(
      'merged_into_id uuid not null references public.competitors(id) on delete cascade',
    );
    expect(sql).toContain('constraint merged_competitors_not_itself check (id <> merged_into_id)');
    const check = body('merged_competitors_check');
    expect(check).toContain('where c.id = new.merged_into_id and c.brand_id = new.brand_id');
    expect(check).toContain('if exists (select 1 from public.competitors c where c.id = new.id)');
  });

  it('lets members who can access the brand read it, and nobody write it directly', () => {
    expect(sql).toContain('alter table public.merged_competitors enable row level security;');
    expect(sql).toContain(
      'revoke all on table public.merged_competitors from anon, authenticated;',
    );
    expect(sql).toContain('grant select on table public.merged_competitors to authenticated;');
    expect(sql).toMatch(
      /create policy "merged_competitors: member select" on public\.merged_competitors for select to authenticated using \(public\.can_access_brand\(brand_id\)\);/,
    );
    expect(sql).not.toMatch(/on public\.merged_competitors for (insert|update|delete|all)/);
  });

  it('merges and unmerges only for an admin or a manager who can access the brand, the service role for a named person', () => {
    for (const name of ['merge_competitors', 'unmerge_competitor']) {
      const fn = body(name);
      expect(fn).toContain(
        "v_person uuid := case when auth.role() = 'service_role' then p_user_id else auth.uid() end;",
      );
      expect(fn).toContain("p.role = any (array['admin', 'manager']::public.user_role[])");
      expect(fn).toContain('public.can_access_brand(p_brand_id, p.id)');
      expect(fn).toContain("errcode = '42501'");
    }
    expect(sql).toMatch(
      /create or replace function public\.merge_competitors\(.*?\) returns jsonb language plpgsql security definer set search_path to 'public'/,
    );
    expect(sql).toMatch(
      /create or replace function public\.unmerge_competitor\(.*?\) returns jsonb language plpgsql security definer set search_path to 'public'/,
    );
    expect(sql).toContain(
      'revoke all on function public.merge_competitors(uuid, uuid, uuid[], uuid) from public, anon;',
    );
  });

  it('merges only the brand’s own, never into itself, at most as many as the app sends', () => {
    const fn = body('merge_competitors');
    expect(fn).toContain('where c.id = p_kept_id and c.brand_id = p_brand_id');
    expect(fn).toContain('where c.id = v_id and c.brand_id = p_brand_id');
    expect(fn).toContain("raise exception 'A competitor can''t be merged into itself.'");
    expect(fn).toContain(`cardinality(v_ids) > ${MAX_MERGED_AT_ONCE}`);
    // Already merged: listed, left as it is.
    expect(fn).toMatch(
      /where m\.id = v_id and m\.brand_id = p_brand_id; if found then v_already := .*?continue;/,
    );
  });

  it('moves the merged row out of competitors and keeps what its foreign keys drop', () => {
    const fn = body('merge_competitors');
    expect(fn).toContain('delete from public.competitors where id = v_id;');
    expect(fn).toContain('from public.competitor_page_events e where e.competitor_id = v_id;');
    expect(fn).toContain('from public.competitor_timeline_scans s where s.competitor_id = v_id;');
    // Its history stays where it is: no answer and no rollup is touched.
    expect(fn).not.toMatch(/prompt_results|_daily|mentions_answer_terms/);
  });

  it('unmerges by putting the same row back, with its pages and Action Center links', () => {
    const fn = body('unmerge_competitor');
    expect(fn).toContain(
      'insert into public.competitors (id, brand_id, name, domain, type, created_at) values (v_m.id, v_m.brand_id, v_m.name, v_m.domain, v_m.type, v_m.created_at);',
    );
    expect(fn).toContain('insert into public.competitor_page_events');
    expect(fn).toContain("and e.removed_reason = 'deleted' and e.removed_at = v_m.merged_at;");
    expect(fn).not.toMatch(/prompt_results|_daily|mentions_answer_terms/);
  });

  it('counts the merged names for the kept one in the terms of answers from the merge on', () => {
    const fn = body('refresh_mention_terms');
    expect(fn).toContain('merged_names as materialized (');
    expect(fn).toContain('where mn.entity = cn.entity and pr.created_at >= mn.since');
  });
});

describe('a merged competitor is out of every read', () => {
  /** Each function's last definition in schema.sql, by name. */
  const latest = new Map<string, string>();
  for (const match of flat(SCHEMA).matchAll(
    /create (?:or replace )?function (?:"?public"?\.)?"?(\w+)"?\s*\(.*?(\$\w*\$)(.*?)\2/gi,
  )) {
    latest.set(match[1].toLowerCase(), match[3]);
  }

  it('reads merged_competitors only in the merge’s own functions', () => {
    const readers = [...latest]
      .filter(([, text]) => /\bmerged_competitors\b/.test(text))
      .map(([name]) => name);
    expect(readers.sort()).toEqual([
      'merge_competitors',
      'refresh_mention_terms',
      'unmerge_competitor',
    ]);
  });

  it('leaves every read of competitors as it was: they join the live table', () => {
    // The functions that name competitors still read public.competitors, which
    // a merged one has left (the way a deleted one leaves it).
    const readers = [...latest].filter(([, text]) =>
      /\b(from|join) (public\.)?"?competitors"?\b/i.test(text),
    );
    expect(readers.length).toBeGreaterThan(20);
  });
});
