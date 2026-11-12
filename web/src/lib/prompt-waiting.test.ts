// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { activationDelta } from './prompt-locations';

/**
 * A prompt waiting for a spot (00535): its own state on prompts, never
 * active, so it isn't tracked and isn't counted against the plan; and
 * import_prompts' option to save the rows past the limit waiting instead of
 * skipping them. Read from the SQL and the worker, as the repository has no
 * database tests: supabase/schema.sql is every migration in order, so a
 * function's last definition there is the one that runs.
 */

const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const SCHEMA = readFileSync(root('supabase/schema.sql'), 'utf8');

/** SQL on one line, its comments left out. */
const flat = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A migration's SQL, as schema.sql holds it. */
function migration(number: string): string {
  const parts = SCHEMA.split(/^-- migrations\/(\S+\.sql)$/m);
  const at = parts.findIndex((part) => part.startsWith(`${number}_`));
  if (at < 0) throw new Error(`No migration ${number}`);
  return flat(parts[at + 1]);
}

/** A function's last definition in schema.sql, from `create` to its closing `$$;`. */
function lastDefinition(name: string): string {
  const starts = [
    ...SCHEMA.matchAll(new RegExp(`create or replace function public\\.${name}\\(`, 'gi')),
  ];
  const start = starts.at(-1)?.index;
  if (start === undefined) throw new Error(`No function ${name}`);
  return flat(SCHEMA.slice(start, SCHEMA.indexOf('$$;', SCHEMA.indexOf('$$', start) + 2) + 3));
}

const sql = migration('00535');

describe('00535: prompts.waiting_since', () => {
  it('is a time, null for every prompt that isn’t waiting', () => {
    expect(sql).toContain(
      'alter table public.prompts add column if not exists waiting_since timestamptz;',
    );
  });

  it('is never set on an active prompt, so a waiting prompt is inactive', () => {
    expect(sql).toContain(
      'alter table public.prompts add constraint prompts_waiting_not_active_check check (waiting_since is null or not is_active);',
    );
  });

  it('is indexed for the waiting prompts of a prompt set only', () => {
    expect(sql).toContain(
      'create index if not exists idx_prompts_waiting on public.prompts (prompt_set_id) where waiting_since is not null;',
    );
  });
});

describe('a waiting prompt is not tracked and not counted', () => {
  it('is left out of the tracking worker’s read, even when its id is asked for', () => {
    const worker = flat(readFileSync(root('server/src/workers/tracking-worker.js'), 'utf8'));
    expect(worker).toContain(
      "let promptsQuery = supabaseAdmin .from('prompts') .select('*') .in('prompt_set_id', setIds) .eq('is_active', true);",
    );
    expect(worker).toContain("promptsQuery = promptsQuery.eq('id', promptId);");
    expect(worker).toContain("promptsQuery = promptsQuery.in('id', promptIds);");
  });

  it('takes no room on the plan: the quota counts active prompts only', () => {
    expect(lastDefinition('org_prompt_location_usage')).toMatch(
      /where b\.organization_id = p_organization_id and not b\.is_demo and p\.is_active and/,
    );
    expect(lastDefinition('prompt_usage_actual')).toContain(
      'sum(greatest(coalesce(array_length(p.regions, 1), 0), 1)) filter (where p.is_active)',
    );
  });

  it('is metered when it is tracked, as resuming a paused prompt is', () => {
    expect(activationDelta([{ isActive: false, regions: ['US', 'DE'] }])).toBe(2);
  });
});

describe('import_prompts (00535)', () => {
  const fn = lastDefinition('import_prompts');

  it('replaces the 4-argument version with an optional p_over_limit, skip by default', () => {
    expect(sql).toContain(
      'drop function if exists public.import_prompts(uuid, uuid, integer, jsonb);',
    );
    expect(fn).toContain(
      "public.import_prompts( p_prompt_set_id uuid, p_organization_id uuid, p_max_locations integer, p_rows jsonb, p_over_limit text default 'skip' ) returns table (idx integer, id uuid, waiting boolean)",
    );
    expect(fn).toContain("if p_over_limit is null or p_over_limit not in ('skip', 'wait') then");
    expect(fn).toContain("using errcode = '22023'");
  });

  it('still runs as the caller, locked per organization, counting what is tracked', () => {
    expect(fn).toContain("security invoker set search_path = ''");
    expect(fn).toContain(
      "perform pg_advisory_xact_lock(hashtextextended('import_prompts:' || p_organization_id::text, 0));",
    );
    expect(fn).toContain('from public.org_prompt_location_usage(p_organization_id) u;');
  });

  it('skips the rows past the limit, or saves them waiting, in the order given', () => {
    expect(fn).toContain(
      'v_over := v_over or (p_max_locations <> -1 and v_used + v_cost > p_max_locations);',
    );
    expect(fn).toContain("exit when v_over and p_over_limit = 'skip';");
    expect(fn).toContain('v_regions, not v_over, case when v_over then now() end )');
    expect(fn).toContain('if not v_over then v_used := v_used + v_cost; end if;');
    expect(fn).toContain('waiting := v_over;');
  });

  it('runs for signed-in people and the server, never anon', () => {
    expect(sql).toContain(
      'revoke all on function public.import_prompts(uuid, uuid, integer, jsonb, text) from public, anon;',
    );
    expect(sql).toContain(
      'grant execute on function public.import_prompts(uuid, uuid, integer, jsonb, text) to authenticated, service_role;',
    );
  });
});
