-- ============================================================================
-- 00370: real demand for a tracked prompt (PROMPT-014)
-- ============================================================================
-- A prompt's AI search volume is an estimate (PROMPT-013). Its Demand card
-- shows what says people really ask it, each signal with its source and date:
--
--   * Search Console: impressions and clicks over 28 days for the brand's
--     queries that match the prompt (gsc_query_stats, read every night).
--   * Google Trends: the 12 months of its keyword, rising, steady or falling.
--   * People Also Ask: the questions Google lists for its keyword.
--   * YouTube: the videos for its keyword, and their views.
--
-- The last three are DataForSEO's queued (Standard) tasks, read once a week:
-- the keyword is the prompt's volume analysis's own (prompt_volumes), where
-- it is measured, so a prompt never analysed has none of them. A task is set
-- one night and read when it's done, that night or the next (`tasks`).
--
-- The level (high, medium, low) weighs the signals there are; `signals` is
-- how many of the four were read. The Action Center's priority reads it.
--
--   * Members read their brands' rows; the server's nightly sweep writes
--     them (service role). The app reads them through the server
--     (GET /api/prompts/:id/demand).
--   * prompt_demand_gsc_queries: a brand's Search Console queries over a
--     window, with their clicks and impressions, for the sweep to match to
--     its prompts. Service role only.

create table if not exists public.prompt_demand (
  prompt_id     uuid primary key references public.prompts(id) on delete cascade,
  brand_id      uuid not null references public.brands(id) on delete cascade,
  -- What the paid signals were read for: the volume analysis's top keyword,
  -- its DataForSEO location and language.
  keyword       text,
  location_code integer,
  language_code text,
  -- Each { ..., at }: what was read and when. Null: never read, or the
  -- source isn't there (no Search Console property, no keyword).
  gsc           jsonb,
  trends        jsonb,
  paa           jsonb,
  youtube       jsonb,
  -- The DataForSEO tasks set and not read yet: { posted_at, trends, paa, youtube } (task ids).
  tasks         jsonb,
  -- When the paid signals were last set to be read: once a week.
  posted_at     timestamptz,
  level         text
    constraint prompt_demand_level_check check (level in ('high', 'medium', 'low')),
  signals       smallint not null default 0
    constraint prompt_demand_signals_check check (signals between 0 and 4),
  updated_at    timestamptz not null default now()
);

create index if not exists prompt_demand_brand_idx on public.prompt_demand (brand_id);
create index if not exists prompt_demand_posted_idx on public.prompt_demand (posted_at nulls first);
-- The tasks waiting to be read: few at a time, looked up every night.
create index if not exists prompt_demand_tasks_idx
  on public.prompt_demand (prompt_id) where tasks is not null;

-- Read by the brand's members (the policy below); written by the server.
alter table public.prompt_demand enable row level security;
revoke all on table public.prompt_demand from anon, authenticated;
grant select on table public.prompt_demand to authenticated;
grant all on table public.prompt_demand to service_role;

drop policy if exists "prompt_demand: member select" on public.prompt_demand;
create policy "prompt_demand: member select"
  on public.prompt_demand
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

comment on table public.prompt_demand is
  'Real demand for a tracked prompt (PROMPT-014): Search Console impressions and clicks (nightly), Google Trends, People Also Ask and YouTube (DataForSEO, weekly), and the level they come to. Written by the server''s nightly sweep; members read.';

-- A brand's Search Console queries over a window, the most seen first, with
-- their clicks and impressions: the sweep matches each one to a prompt.
-- jsonb, so PostgREST's row cap doesn't cut the list at 1,000.
create or replace function public.prompt_demand_gsc_queries(
  p_brand_id uuid, p_from date, p_to date, p_limit integer default 5000
) returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select g.query,
           sum(g.clicks)::bigint as clicks,
           sum(g.impressions)::bigint as impressions
    from public.gsc_query_stats g
    where g.brand_id = p_brand_id and g.date between p_from and p_to
    group by g.query
    order by sum(g.impressions) desc, g.query
    limit greatest(least(coalesce(p_limit, 5000), 20000), 1)
  ) x
$$;

revoke all on function public.prompt_demand_gsc_queries(uuid, date, date, integer) from public, anon, authenticated;
grant execute on function public.prompt_demand_gsc_queries(uuid, date, date, integer) to service_role;

comment on function public.prompt_demand_gsc_queries(uuid, date, date, integer) is
  'PROMPT-014 (00370): a brand''s Search Console queries between two days with their clicks and impressions, the most seen first, at most p_limit (default 5,000). The demand sweep matches them to prompts. Service role only.';

notify pgrst, 'reload schema';
