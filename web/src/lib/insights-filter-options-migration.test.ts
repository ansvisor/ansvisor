// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 00544: insights_filter_options (the region and model filter options) reads
 * a small per-brand counts table for a brand whose backfill has finished, and
 * the 00026 scan of prompt_results for every other brand. The repository has
 * no database tests, so the SQL is read; the PR that brought 00544 ran it on a
 * local Postgres with generated answers.
 */

const dir = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));
const read = (prefix: string): string => {
  const file = readdirSync(dir).find((name) => name.startsWith(prefix));
  if (!file) throw new Error(`no migration ${prefix}`);
  return readFileSync(`${dir}/${file}`, 'utf8');
};

const uncommented = (sql: string) => sql.replace(/--[^\n]*/g, '');
const oneLine = (sql: string) => uncommented(sql).replace(/\s+/g, ' ').trim().toLowerCase();

const RAW = read('00544_');
const SQL = oneLine(RAW);
/** What runs when the migration applies: function bodies left out. */
const TOP = oneLine(RAW.replace(/\$\$[\s\S]*?\$\$/g, '$$$$'));
const STATEMENTS = TOP.split(';')
  .map((s) => s.trim())
  .filter(Boolean);

/** A function's definition in a migration: its header (up to the body) and its body. */
function definition(sql: string, name: string): { header: string; body: string } {
  const m = sql.match(
    new RegExp(
      String.raw`create or replace function public\.${name}\s*\(([\s\S]*?)\bas \$\$([\s\S]*?)\$\$;`,
      'i',
    ),
  );
  if (!m) throw new Error(`no function ${name}`);
  return { header: oneLine(m[1]), body: oneLine(m[2]) };
}

const READ = definition(RAW, 'insights_filter_options');
const OLD = definition(read('00026_'), 'insights_filter_options');

describe('00544 applies in seconds: schema and functions only', () => {
  it('fills nothing, rewrites nothing and builds no index', () => {
    const allowed =
      /^(?:set lock_timeout = '5s'|reset lock_timeout|notify pgrst, 'reload schema'|create table if not exists public\.\w+ \(|alter table public\.\w+ (?:enable row level security|set \()|comment on (?:table|function) |drop policy if exists |create policy |drop trigger if exists |create trigger |create or replace function |revoke |grant )/;
    expect(STATEMENTS.filter((s) => !allowed.test(s))).toEqual([]);
    // No statement writes rows (the allowed starts above), and no index anywhere.
    expect(TOP).not.toMatch(/\bcreate (?:unique )?index\b|\bconcurrently\b/);
    // Gives up instead of queueing writes behind a long transaction.
    expect(STATEMENTS[0]).toBe("set lock_timeout = '5s'");
    expect(STATEMENTS).toContain('reset lock_timeout');
  });

  it('is safe to run again', () => {
    for (const s of STATEMENTS.filter((x) => x.startsWith('create table'))) {
      expect(s).toMatch(/^create table if not exists /);
    }
    const dropped = (kind: 'trigger' | 'policy', name: string, table: string) =>
      STATEMENTS.indexOf(`drop ${kind} if exists ${name} on ${table}`);
    for (const s of STATEMENTS.filter((x) => x.startsWith('create trigger'))) {
      const [, name, table] = s.match(/^create trigger (\S+) .*? on (public\.\w+)/) ?? [];
      expect(dropped('trigger', name, table), name).toBeGreaterThanOrEqual(0);
      expect(dropped('trigger', name, table)).toBeLessThan(STATEMENTS.indexOf(s));
    }
    for (const s of STATEMENTS.filter((x) => x.startsWith('create policy'))) {
      const [, name, table] = s.match(/^create policy ("[^"]+") on (public\.\w+)/) ?? [];
      expect(dropped('policy', name, table), name).toBeGreaterThanOrEqual(0);
    }
    expect(SQL).not.toMatch(/\bcreate function\b/);
  });
});

describe('insights_filter_options', () => {
  it('keeps its signature, security, search_path and grant', () => {
    for (const part of [
      'p_brand_id uuid) returns table ( regions text[], models text[] )',
      'stable',
      'security invoker',
      'set search_path = public',
    ]) {
      expect(OLD.header).toContain(part);
      expect(READ.header).toContain(part);
    }
    expect(READ.header).not.toContain('security definer');
    expect(STATEMENTS).toContain(
      'grant execute on function public.insights_filter_options(uuid) to authenticated',
    );
    expect(TOP).not.toMatch(/revoke [^;]* on function public\.insights_filter_options/);
  });

  it('runs the 00026 scan, unchanged, for every brand not ready', () => {
    const scan = OLD.body;
    expect(scan).toMatch(
      /^select coalesce\(\( select array_agg\(distinct pr\.region order by pr\.region\)/,
    );
    const ready =
      'if exists ( select 1 from public.brand_filter_values_backfill r where r.brand_id = p_brand_id and r.ready_at is not null ) then return query';
    expect(READ.body.startsWith(`begin ${ready}`)).toBe(true);
    // The counts' branch ends with its own return; the scan is what's left.
    expect(READ.body).toContain(`return; end if; return query ${scan}; end;`);
  });

  it('offers a ready brand’s values whose count is above zero, sorted as the scan sorts', () => {
    for (const kind of ['region', 'model']) {
      expect(READ.body).toContain(
        `select array_agg(f.value order by f.value) from ( select v.value from public.brand_filter_values v where v.brand_id = p_brand_id and v.kind = '${kind}' group by v.value having sum(v.n) > 0 ) f`,
      );
    }
  });

  it('is still the last definition in schema.sql', () => {
    const schema = readFileSync(
      fileURLToPath(new URL('../../../supabase/schema.sql', import.meta.url)),
      'utf8',
    );
    const at = schema
      .toLowerCase()
      .lastIndexOf('create or replace function public.insights_filter_options(');
    const marker = [...schema.slice(0, at).matchAll(/^-- migrations\/(\S+\.sql)$/gm)].pop()?.[1];
    expect(marker).toMatch(/^00544_/);
  });
});

describe('the counts', () => {
  it('count what the scan reads: no shopping answer, no null or empty value', () => {
    const counting = ['brand_filter_values_move_answer', 'brand_filter_values_remove_answers'].map(
      (name) => definition(RAW, name).body,
    );
    for (const body of counting) {
      expect(body).toContain("platform <> 'chatgpt-shopping'");
      expect(body).toContain("v.value is not null and v.value <> ''");
    }
    const add = definition(RAW, 'brand_filter_values_add_answer').body;
    expect(add).toContain("v.value is not null and v.value <> ''");
    // The insert trigger leaves shopping answers out before calling it.
    expect(STATEMENTS).toContain(
      "create trigger prompt_results_filter_values_insert after insert on public.prompt_results for each row when (new.platform <> 'chatgpt-shopping' and (new.region <> '' or new.model_used <> '')) execute function public.brand_filter_values_add_answer()",
    );
    const backfill = definition(RAW, 'backfill_brand_filter_values').body;
    expect(backfill.match(/pr\.platform <> 'chatgpt-shopping'/g)).toHaveLength(2);
  });

  it('follow every write to prompt_results, and a new brand starts ready', () => {
    expect(STATEMENTS).toContain(
      'create trigger prompt_results_filter_values_update after update of brand_id, platform, region, model_used, created_at on public.prompt_results for each row when ((old.brand_id, old.platform, old.region, old.model_used, old.created_at) is distinct from (new.brand_id, new.platform, new.region, new.model_used, new.created_at)) execute function public.brand_filter_values_move_answer()',
    );
    expect(STATEMENTS).toContain(
      'create trigger prompt_results_filter_values_delete after delete on public.prompt_results referencing old table as old_rows for each statement execute function public.brand_filter_values_remove_answers()',
    );
    expect(STATEMENTS).toContain(
      'create trigger prompt_results_filter_values_truncate after truncate on public.prompt_results for each statement execute function public.brand_filter_values_truncated()',
    );
    expect(STATEMENTS).toContain(
      'create trigger brands_filter_values_ready after insert on public.brands for each row execute function public.brand_filter_values_new_brand()',
    );
    // Every write of counts takes the brand's lock first.
    for (const name of [
      'brand_filter_values_add_answer',
      'brand_filter_values_move_answer',
      'brand_filter_values_remove_answers',
    ]) {
      const { body } = definition(RAW, name);
      const lock = body.indexOf("hashtextextended('brand_filter_values:' ||");
      expect(lock, name).toBeGreaterThan(0);
      expect(lock, name).toBeLessThan(body.indexOf('insert into public.brand_filter_values'));
    }
  });

  it('are read through prompt_results’ policy, and written only by the server', () => {
    const policy =
      'using (brand_id in ( select b.id from public.brands b join public.profiles p on p.organization_id = b.organization_id where p.id = auth.uid()))';
    for (const table of ['brand_filter_values', 'brand_filter_values_backfill']) {
      expect(STATEMENTS).toContain(`alter table public.${table} enable row level security`);
      const policies = STATEMENTS.filter(
        (s) => s.startsWith('create policy') && s.includes(` on public.${table} `),
      );
      expect(policies).toHaveLength(1);
      expect(policies[0]).toContain(`on public.${table} for select ${policy}`);
      expect(STATEMENTS).toContain(`revoke all on table public.${table} from anon, authenticated`);
      expect(STATEMENTS).toContain(`grant select on table public.${table} to anon, authenticated`);
    }
    const writes = STATEMENTS.filter(
      (s) =>
        /^grant /.test(s) &&
        /\b(?:anon|authenticated)\b/.test(s) &&
        !/^grant (?:select|execute) on /.test(s),
    );
    expect(writes).toEqual([]);
  });

  it('have their triggers and backfill for the server only', () => {
    for (const name of [
      'brand_filter_values_add_answer',
      'brand_filter_values_move_answer',
      'brand_filter_values_remove_answers',
      'brand_filter_values_truncated',
      'brand_filter_values_new_brand',
    ]) {
      const { header } = definition(RAW, name);
      expect(header, name).toContain('returns trigger');
      expect(header, name).toContain('security definer set search_path = public');
      expect(STATEMENTS).toContain(
        `revoke execute on function public.${name}() from public, anon, authenticated`,
      );
    }
    for (const [name, args] of [
      ['backfill_brand_filter_values', 'uuid, integer'],
      ['brand_filter_values_backfill_brands', ''],
    ]) {
      const { header } = definition(RAW, name);
      expect(header, name).not.toContain('security definer');
      expect(header, name).toContain('set search_path = public');
      expect(STATEMENTS).toContain(
        `revoke execute on function public.${name}(${args}) from public, anon, authenticated`,
      );
      expect(STATEMENTS).toContain(
        `grant execute on function public.${name}(${args}) to service_role`,
      );
    }
  });

  it('are backfilled a few months per call, checked, and ready only with the last month', () => {
    const { header, body } = definition(RAW, 'backfill_brand_filter_values');
    expect(header).toContain('p_months integer default 1');
    expect(body).toContain('p_months < 1 or p_months > 24');
    // One call per brand at a time; the triggers' lock before the counts are written.
    expect(body).toContain(
      "hashtextextended('backfill_brand_filter_values:' || p_brand_id::text, 0)",
    );
    expect(body.indexOf("hashtextextended('brand_filter_values:'")).toBeLessThan(
      body.indexOf('insert into public.brand_filter_values as t'),
    );
    // The check fails the call when a count is off afterwards.
    expect(body).toContain("don''t match its answers after the correction");
    expect(body).toContain('v_ready := v_to >= v_last');
    expect(body).toContain('case when v_ready then now() end');
  });
});
