-- ============================================================================
-- 00540: Perception's live read at 90 days, from one row per entity and day
-- ============================================================================
-- The morning health report (server/src/lib/health) timed the live
-- Perception read (the 'mentions_perception_live' probe: the unfiltered view
-- with an end, which skips the 00241 snapshot) at 5.29 s for 90 days on
-- production. The target is 3 s.
--
-- Since 00536 a brand in fast_rollups_ready reads the window's terms from
-- mentions_terms_daily_all: one index entry per entity, day and term, each
-- repeating the brand, the entity (a competitor's id, 36 characters) and the
-- day for one term and one count. The five entities the tab shows name a few
-- thousand terms a day each, so 90 days are about a million entries. On a
-- copy of the largest brand's volume (3,640 answers a day, 19 entities) the
-- read touched 83,000 pages for them, 15,500 read from disk cold, against
-- about 500 for everything else it does; read cold, those pages are the
-- time.
--
-- mentions_terms_daily_packed holds the same rows as one row per brand,
-- entity and day: the day's terms and their counts in two arrays, sorted by
-- term, which Postgres compresses (TOAST). The five entities' 90 days are
-- 450 rows, 2,000 to 4,000 pages as the terms compress instead of 83,000,
-- and the read sums the arrays an entity at a time. Nothing else the read
-- does changes: the window before (the brand's 15 terms, by 00537's index),
-- the mentions and co-mentions (mentions_entities_daily) and every filtered
-- view read as before.
--
--   * pack_mention_terms_daily(brand, from, to) makes a brand's packed days
--     match mentions_terms_daily_all, writing only the rows that changed.
--     refresh_mention_terms_daily calls it after it rewrites
--     mentions_terms_daily_all, for every brand from the moment this
--     applies; backfill_fast_rollups calls it when it changed a term row.
--   * This fills nothing, so it applies in seconds. backfill_mention_terms_packed
--     (below) packs one brand's days at a time under the terms refresh's
--     lock and is safe to re-run; server/src/scripts/backfill-perception-packed.js
--     calls it in chunks, brand by brand, and lists a brand in
--     mentions_terms_packed_ready with its last chunk. Only a brand in
--     fast_rollups_ready is packed: its mentions_terms_daily_all holds its
--     whole history.
--   * mentions_perception_live reads the packed days only for a brand in
--     both lists. Every other brand reads exactly as before 00540, so no read
--     comes back short. To send a brand back, delete its
--     mentions_terms_packed_ready row.
--   * The packed table's only index is its key, one entry per entity and
--     day, so it fills as the rows are written: no index to build after.
-- The order (apply, the backfill script, re-run the last days, vacuum
-- analyze) is in the PR that brought this file. Signatures, results, grants
-- and the brand access check (00434) are unchanged.

-- The new tables' foreign keys hold brands' writes for a moment: if a long
-- transaction holds brands, this gives up after 5 s instead of queueing every
-- brands write behind it (apply it again; everything here is idempotent).
set lock_timeout = '5s';

-- ── Perception: a day's terms, one row per entity ──────────────────────────

create table if not exists public.mentions_terms_daily_packed (
  brand_id uuid not null references public.brands(id) on delete cascade,
  entity   text not null,
  day      date not null,
  -- mentions_terms_daily_all's terms of the entity's day, sorted, and each
  -- one's answers at the same position.
  terms    text[] not null,
  answers  integer[] not null,
  constraint mentions_terms_daily_packed_pkey primary key (brand_id, entity, day)
);

-- The brands whose packed days hold their whole history, listed by
-- backfill_mention_terms_packed at the end of a brand's last chunk. The live
-- read uses the packed days for a listed brand only (and only while it is in
-- fast_rollups_ready too). To send a brand back, delete its row.
create table if not exists public.mentions_terms_packed_ready (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  ready_at timestamptz not null default now()
);

-- Read by the security definer read and written by the refresh and the
-- backfill only, as the rollups they come from (00231, 00536).
alter table public.mentions_terms_daily_packed enable row level security;
alter table public.mentions_terms_packed_ready enable row level security;

-- Each refresh rewrites a range of days; vacuumed about daily, as its source.
alter table public.mentions_terms_daily_packed set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);

comment on table public.mentions_terms_daily_packed is
  'mentions_terms_daily_all per (brand, entity, day): the day''s terms, sorted, and their answers in two arrays. The Perception tab''s unfiltered live read for a brand in mentions_terms_packed_ready (mentions_perception_live, 00540). Rewritten with it by refresh_mention_terms_daily; filled by backfill_mention_terms_packed.';
comment on table public.mentions_terms_packed_ready is
  'Brands whose mentions_terms_daily_packed holds their whole history (00540): mentions_perception_live reads it for them while they are in fast_rollups_ready too, and mentions_terms_daily_all for every other brand. Listed by backfill_mention_terms_packed.';

-- ── Packing: a brand's days from mentions_terms_daily_all ──────────────────

-- Makes the packed days of one brand match mentions_terms_daily_all: a
-- missing row inserted, a changed one rewritten (an unchanged row is left
-- alone, so a re-run writes nothing), and a row whose entity has no terms
-- that day any more deleted. mentions_terms_daily_all's key leads with the
-- entity, so it is read by the entities those days name, as
-- refresh_mention_terms_daily writes it. The caller holds the brand's terms
-- refresh lock. Returns the rows written.
create or replace function public.pack_mention_terms_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to   date
) returns bigint
language plpgsql
set search_path to 'public'
as $$
declare
  v_rows bigint;
begin
  with src as materialized (
    select d.entity, d.day,
           array_agg(d.term order by d.term) as terms,
           array_agg(d.answers order by d.term) as answers
    from public.mentions_terms_daily_all d
    where d.brand_id = p_brand_id
      and d.entity in (
        select distinct e.entity
        from public.mentions_entities_daily e
        where e.brand_id = p_brand_id and e.day between p_day_from and p_day_to)
      and d.day between p_day_from and p_day_to
    group by d.entity, d.day
  ),
  gone as (
    delete from public.mentions_terms_daily_packed t
    where t.brand_id = p_brand_id
      and t.day between p_day_from and p_day_to
      and not exists (select 1 from src s where s.entity = t.entity and s.day = t.day)
  )
  insert into public.mentions_terms_daily_packed as t (brand_id, entity, day, terms, answers)
  select p_brand_id, s.entity, s.day, s.terms, s.answers
  from src s
  on conflict (brand_id, entity, day) do update set
    terms   = excluded.terms,
    answers = excluded.answers
  where (t.terms, t.answers) is distinct from (excluded.terms, excluded.answers);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ── refresh_mention_terms_daily (00536), the packed days added ────────────

create or replace function public.refresh_mention_terms_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to   date
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_from timestamptz := p_day_from::timestamp at time zone 'utc';
  v_to   timestamptz := (p_day_to + 1)::timestamp at time zone 'utc';
begin
  -- One rebuild per brand at a time: a run's refresh and the deleted-prompt
  -- rebuild can cover the same days. The lock releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_mention_terms_daily:' || p_brand_id::text, 0));

  -- The terms' key leads with the entity, so their rows go by the entities
  -- those days name (the same rows the entities' come from), before those.
  delete from public.mentions_terms_daily
    where brand_id = p_brand_id
      and entity in (
        select distinct e.entity
        from public.mentions_entities_daily e
        where e.brand_id = p_brand_id and e.day between p_day_from and p_day_to)
      and day between p_day_from and p_day_to;
  -- 00536: their every-platform sums, by the same entities and days.
  delete from public.mentions_terms_daily_all
    where brand_id = p_brand_id
      and entity in (
        select distinct e.entity
        from public.mentions_entities_daily e
        where e.brand_id = p_brand_id and e.day between p_day_from and p_day_to)
      and day between p_day_from and p_day_to;
  delete from public.mentions_entities_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.mentions_entities_daily (
    brand_id, day, platform, region, entity, answers, with_brand)
  select p_brand_id, x.day, x.platform, x.region, x.entity,
         count(*), count(*) filter (where x.with_brand)
  from (
    select (t.created_at at time zone 'utc')::date as day, t.platform, t.region, t.entity,
           bool_or(t.entity = 'brand') over (partition by t.result_id) as with_brand
    from public.mentions_answer_terms t
    where t.brand_id = p_brand_id
      and t.created_at >= v_from
      and t.created_at < v_to
  ) x
  group by x.day, x.platform, x.region, x.entity;

  with c as materialized (
    select (t.created_at at time zone 'utc')::date as day, t.platform, t.region, t.entity,
           term, count(*)::integer as answers
    from public.mentions_answer_terms t
    cross join lateral unnest(t.terms) as term
    where t.brand_id = p_brand_id
      and t.created_at >= v_from
      and t.created_at < v_to
    group by 1, 2, 3, 4, 5
  ),
  -- The terms among any entity's 200 most frequent of a day, platform and
  -- region, kept for every entity there. coalesce rather than "is not
  -- distinct from", so the join below can hash.
  keep as (
    select distinct r.day, r.platform, coalesce(r.region, '') as region_key, r.term
    from (
      select c.day, c.platform, c.region, c.term,
             row_number() over (
               partition by c.day, c.platform, c.region, c.entity
               order by c.answers desc, c.term) as rn
      from c
    ) r
    where r.rn <= 200
  )
  insert into public.mentions_terms_daily (
    brand_id, day, platform, region, entity, term, answers)
  select p_brand_id, c.day, c.platform, c.region, c.entity, c.term, c.answers
  from c
  join keep k on k.day = c.day and k.platform = c.platform
             and k.region_key = coalesce(c.region, '') and k.term = c.term;

  -- 00536: the same terms summed over every platform and region, which the
  -- Perception tab's unfiltered live read sums (mentions_perception_live).
  -- Written for every brand, ready or not (fast_rollups_ready).
  insert into public.mentions_terms_daily_all (brand_id, entity, day, term, answers)
  select d.brand_id, d.entity, d.day, d.term, sum(d.answers)
  from public.mentions_terms_daily d
  where d.brand_id = p_brand_id
    and d.entity in (
      select distinct e.entity
      from public.mentions_entities_daily e
      where e.brand_id = p_brand_id and e.day between p_day_from and p_day_to)
    and d.day between p_day_from and p_day_to
  group by d.brand_id, d.entity, d.day, d.term
  on conflict (brand_id, entity, day, term) do update set answers = excluded.answers;

  -- 00540: the same days packed, one row per entity and day, which a
  -- packed-ready brand's unfiltered live read sums (mentions_perception_live).
  -- Written for every brand, packed-ready or not (mentions_terms_packed_ready).
  perform public.pack_mention_terms_daily(p_brand_id, p_day_from, p_day_to);

  -- The brand's precomputed default views (00241) now count from rollups
  -- older than these: set aside, as forget_mentions_perception_snapshots
  -- does, so the tab reads the rollups live until the server refreshes
  -- them, never older figures. Last, in the same transaction: a refresh
  -- that started before this (and read the old rollups) can't write over
  -- it, as its computed_at is earlier.
  update public.mentions_perception_snapshots
  set day_to = date '1970-01-01', computed_at = clock_timestamp()
  where brand_id = p_brand_id;
end;
$$;

-- ── backfill_fast_rollups (00536), the packed days following its term rows ─

create or replace function public.backfill_fast_rollups(
  p_brand_id   uuid,
  p_day_from   date,
  p_day_to     date,
  p_mark_ready boolean default false
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_prompts     bigint;
  v_competitors bigint;
  v_terms       bigint;
begin
  if p_brand_id is null or p_day_from is null or p_day_to is null or p_day_from > p_day_to then
    raise exception 'backfill_fast_rollups: a brand and a day range from <= to are required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refresh_insights_daily:' || p_brand_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_mention_terms_daily:' || p_brand_id::text, 0));

  with src as materialized (
    select d.day, d.prompt_id,
           sum(d.answer_count)       as answer_count,
           sum(d.mention_answers)    as mention_answers,
           sum(d.citation_answers)   as citation_answers,
           sum(d.mentioning_answers) as mentioning_answers,
           sum(d.total_mentions)     as total_mentions,
           sum(d.total_citations)    as total_citations,
           sum(d.sum_inv_position)   as sum_inv_position,
           sum(d.position_count)     as position_count,
           max(d.max_created_at)     as max_created_at
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id and d.day between p_day_from and p_day_to
    group by d.day, d.prompt_id
  ),
  gone as (
    delete from public.topics_prompt_daily t
    where t.brand_id = p_brand_id
      and t.day between p_day_from and p_day_to
      and not exists (select 1 from src s where s.day = t.day and s.prompt_id = t.prompt_id)
  )
  insert into public.topics_prompt_daily as t (
    brand_id, day, prompt_id, answer_count, mention_answers, citation_answers,
    mentioning_answers, total_mentions, total_citations, sum_inv_position,
    position_count, max_created_at)
  select p_brand_id, s.day, s.prompt_id, s.answer_count, s.mention_answers,
         s.citation_answers, s.mentioning_answers, s.total_mentions,
         s.total_citations, s.sum_inv_position, s.position_count, s.max_created_at
  from src s
  on conflict (brand_id, day, prompt_id) do update set
    answer_count       = excluded.answer_count,
    mention_answers    = excluded.mention_answers,
    citation_answers   = excluded.citation_answers,
    mentioning_answers = excluded.mentioning_answers,
    total_mentions     = excluded.total_mentions,
    total_citations    = excluded.total_citations,
    sum_inv_position   = excluded.sum_inv_position,
    position_count     = excluded.position_count,
    max_created_at     = excluded.max_created_at
  where (t.answer_count, t.mention_answers, t.citation_answers, t.mentioning_answers,
         t.total_mentions, t.total_citations, t.sum_inv_position, t.position_count,
         t.max_created_at)
        is distinct from
        (excluded.answer_count, excluded.mention_answers, excluded.citation_answers,
         excluded.mentioning_answers, excluded.total_mentions, excluded.total_citations,
         excluded.sum_inv_position, excluded.position_count, excluded.max_created_at);
  get diagnostics v_prompts = row_count;

  with src as materialized (
    select d.day, d.prompt_id, d.competitor_id, sum(d.mention_count) as mention_count
    from public.insights_competitor_prompt_daily d
    where d.brand_id = p_brand_id and d.day between p_day_from and p_day_to
    group by d.day, d.prompt_id, d.competitor_id
  ),
  gone as (
    delete from public.topics_competitor_daily t
    where t.brand_id = p_brand_id
      and t.day between p_day_from and p_day_to
      and not exists (
        select 1 from src s
        where s.day = t.day and s.prompt_id = t.prompt_id and s.competitor_id = t.competitor_id)
  )
  insert into public.topics_competitor_daily as t (
    brand_id, day, prompt_id, competitor_id, mention_count)
  select p_brand_id, s.day, s.prompt_id, s.competitor_id, s.mention_count
  from src s
  on conflict (brand_id, day, prompt_id, competitor_id) do update set
    mention_count = excluded.mention_count
  where t.mention_count is distinct from excluded.mention_count;
  get diagnostics v_competitors = row_count;

  -- The terms' key leads with the entity: read by the entities those days
  -- name, as refresh_mention_terms_daily rewrites them.
  with entities as (
    select distinct e.entity
    from public.mentions_entities_daily e
    where e.brand_id = p_brand_id and e.day between p_day_from and p_day_to
  ),
  src as materialized (
    select d.entity, d.day, d.term, sum(d.answers) as answers
    from public.mentions_terms_daily d
    where d.brand_id = p_brand_id
      and d.entity in (select x.entity from entities x)
      and d.day between p_day_from and p_day_to
    group by d.entity, d.day, d.term
  ),
  gone as (
    delete from public.mentions_terms_daily_all t
    where t.brand_id = p_brand_id
      and t.entity in (select x.entity from entities x)
      and t.day between p_day_from and p_day_to
      and not exists (
        select 1 from src s
        where s.entity = t.entity and s.day = t.day and s.term = t.term)
  )
  insert into public.mentions_terms_daily_all as t (brand_id, entity, day, term, answers)
  select p_brand_id, s.entity, s.day, s.term, s.answers
  from src s
  on conflict (brand_id, entity, day, term) do update set
    answers = excluded.answers
  where t.answers is distinct from excluded.answers;
  get diagnostics v_terms = row_count;

  -- 00540: the packed days follow mentions_terms_daily_all. Only when a term
  -- row changed (a brand's first fill, or days a refresh left out of step):
  -- a re-run that writes nothing packs nothing.
  if v_terms > 0 then
    perform public.pack_mention_terms_daily(p_brand_id, p_day_from, p_day_to);
  end if;

  if p_mark_ready then
    insert into public.fast_rollups_ready (brand_id) values (p_brand_id)
    on conflict (brand_id) do nothing;
  end if;

  return jsonb_build_object(
    'prompt_rows', v_prompts, 'competitor_rows', v_competitors, 'term_rows', v_terms);
end;
$$;

-- ── mentions_perception_live (00536), a packed-ready brand's unfiltered days from the packed terms

create or replace function public.mentions_perception_live(
  p_brand_id  uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz default null,
  p_platform  text default null,
  p_region    text default null,
  p_topic_id  uuid default null,
  p_search    text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
-- 00536: no JIT. The phrase check's estimate passes jit_above_cost, and
-- compiling took longer than the read (about 0.1 s of 0.12 s).
set jit to 'off'
as $$
declare
  v_to         timestamptz := coalesce(p_date_to, now());
  v_from       timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  v_days       integer;
  v_day_to     date;
  v_start      timestamptz;
  v_end        timestamptz;
  v_prev_start timestamptz;
  v_search     text := nullif(btrim(lower(coalesce(p_search, ''))), '');
  v_rollup     boolean;
  -- No platform or region, and the brand's summed terms hold its whole
  -- history (00536): the every-platform terms.
  v_all        boolean;
  -- And its packed days hold its whole history too (00540): the terms of
  -- the window from one row per entity and day.
  v_packed     boolean;
  v_start_day  date;
  v_end_day    date;
  v_prev_day   date;
  v_result     jsonb;
begin
  v_days := greatest(1, ceil(extract(epoch from v_to - v_from) / 86400.0 - 1.0 / 24)::integer);
  if v_days < 2 then
    v_start := v_from;
    v_end   := v_to + interval '1 microsecond';
  else
    v_day_to := (v_to at time zone 'utc')::date;
    v_start  := (v_day_to - (v_days - 1))::timestamp at time zone 'utc';
    v_end    := (v_day_to + 1)::timestamp at time zone 'utc';
  end if;
  v_prev_start := v_start - (v_end - v_start);
  -- Whole UTC days with no topic or search read the daily rollups (00231);
  -- a window under two days, or a filter on the prompts, reads the answers'
  -- terms as before. The branch not taken is pruned (plan_cache_mode).
  v_rollup    := v_days >= 2 and p_topic_id is null and v_search is null;
  v_all       := v_rollup and p_platform is null and p_region is null
                 and exists (select 1 from public.fast_rollups_ready r where r.brand_id = p_brand_id);
  v_packed    := v_all
                 and exists (select 1 from public.mentions_terms_packed_ready r where r.brand_id = p_brand_id);
  v_start_day := (v_start at time zone 'utc')::date;
  v_end_day   := (v_end at time zone 'utc')::date;
  v_prev_day  := (v_prev_start at time zone 'utc')::date;

  with
  prompts_in as (
    select p.id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and (p_topic_id is null or p.topic_id = p_topic_id)
      and (v_search is null or position(v_search in lower(p.text)) > 0)
  ),
  rows_in as (
    select t.result_id, t.entity, t.terms, (t.created_at >= v_start) as cur
    from public.mentions_answer_terms t
    join prompts_in pi on pi.id = t.prompt_id
    where not v_rollup
      and t.brand_id = p_brand_id
      and t.created_at >= v_prev_start
      and t.created_at < v_end
      and (p_platform is null or t.platform = p_platform)
      and (p_region is null or t.region = p_region)
  ),
  entity_counts as (
    select entity,
           count(*) filter (where cur)     as mentions,
           count(*) filter (where not cur) as prev_mentions
    from rows_in
    group by entity
    union all
    select d.entity,
           coalesce(sum(d.answers) filter (where d.day >= v_start_day), 0),
           coalesce(sum(d.answers) filter (where d.day < v_start_day), 0)
    from public.mentions_entities_daily d
    where v_rollup
      and d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity
  ),
  shown as (
    select 'brand'::text as entity, 0 as rank
    union all
    select * from (
      select ec.entity, row_number() over (order by ec.mentions desc, ec.entity)::int
      from entity_counts ec
      join public.competitors co on co.id::text = ec.entity and co.brand_id = p_brand_id
      where ec.mentions > 0
      order by ec.mentions desc, ec.entity
      limit 4
    ) top_competitors
  ),
  -- The shown entities' terms in the window. The window before is read
  -- only for the brand's terms shown (brand_prev).
  term_counts_all as (
    select r.entity, term, count(*) as answers
    from rows_in r
    join shown s on s.entity = r.entity
    cross join lateral unnest(r.terms) as term
    where r.cur
    group by r.entity, term
    union all
    select d.entity, d.term, sum(d.answers)
    from public.mentions_terms_daily d
    join shown s on s.entity = d.entity
    where v_rollup
      and not v_all
      and d.brand_id = p_brand_id
      and d.day >= v_start_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity, d.term
    union all
    select d.entity, d.term, sum(d.answers)
    from public.mentions_terms_daily_all d
    join shown s on s.entity = d.entity
    where v_all
      and not v_packed
      and d.brand_id = p_brand_id
      and d.day >= v_start_day
      and d.day < v_end_day
    group by d.entity, d.term
    union all
    -- 00540: the same sums from the packed days, an entity at a time: a
    -- row per day, its terms and counts side by side.
    select s.entity, x.term, x.answers
    from shown s
    cross join lateral (
      select u.term, sum(u.answers) as answers
      from public.mentions_terms_daily_packed p
      cross join lateral unnest(p.terms, p.answers) as u(term, answers)
      where p.brand_id = p_brand_id
        and p.entity = s.entity
        and p.day >= v_start_day
        and p.day < v_end_day
      group by u.term
    ) x
    where v_packed
  ),
  -- Each entity's 60 most frequent terms are the candidates.
  candidates as (
    select entity, term, answers
    from (
      select t.*, row_number() over (partition by t.entity order by t.answers desc, t.term) as rn
      from term_counts_all t
      where t.answers > 0
    ) ranked
    where rn <= 60
  ),
  -- A word that nearly always comes in one phrase is that phrase: "fresh" and
  -- "roast" give way to "fresh roast" when it has 80% of their answers.
  term_counts as (
    select c.*
    from candidates c
    where position(' ' in c.term) > 0
       or not exists (
         select 1 from candidates p
         where p.entity = c.entity
           and position(' ' in p.term) > 0
           and (p.term like c.term || ' %' or p.term like '% ' || c.term)
           and p.answers >= 0.8 * c.answers)
  ),
  brand_terms as (
    select term, answers
    from term_counts
    where entity = 'brand' and answers > 0
    order by answers desc, term
    limit 15
  ),
  -- Those terms' answers in the window before, for their trend.
  brand_prev as (
    select term, count(*) as prev_answers
    from rows_in r
    cross join lateral unnest(r.terms) as term
    where not r.cur
      and r.entity = 'brand'
      and term in (select bt.term from brand_terms bt)
    group by term
    union all
    select d.term, sum(d.answers)
    from public.mentions_terms_daily d
    where v_rollup
      and not v_all
      and d.brand_id = p_brand_id
      and d.entity = 'brand'
      and d.day >= v_prev_day
      and d.day < v_start_day
      and d.term in (select bt.term from brand_terms bt)
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.term
    union all
    -- Each of the 15 terms' own days, by mentions_terms_daily_all_term (00537)
    -- once it is built, by the key's day range before.
    select d.term, sum(d.answers)
    from public.mentions_terms_daily_all d
    where v_all
      and d.brand_id = p_brand_id
      and d.entity = 'brand'
      and d.term in (select bt.term from brand_terms bt)
      and d.day >= v_prev_day
      and d.day < v_start_day
    group by d.term
  ),
  -- The terms that tell the brands apart most: the widest spread between the
  -- highest and lowest share of mentions, then the highest shares.
  attributes as (
    select u.term
    from (select distinct term from term_counts) u
    cross join shown s
    left join term_counts_all tc on tc.entity = s.entity and tc.term = u.term
    left join entity_counts ec on ec.entity = s.entity
    group by u.term
    order by
      max(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0))
        - min(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0)) desc nulls last,
      sum(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0)) desc nulls last,
      u.term
    limit 8
  ),
  -- A competitor's rows in answers that name the brand too, in one pass.
  co as (
    select x.entity,
           count(*) filter (where x.cur)     as co_mentions,
           count(*) filter (where not x.cur) as prev_co_mentions
    from (
      select r.entity, r.cur,
             bool_or(r.entity = 'brand') over (partition by r.result_id) as with_brand
      from rows_in r
    ) x
    where x.entity <> 'brand' and x.with_brand
    group by x.entity
    union all
    select d.entity,
           coalesce(sum(d.with_brand) filter (where d.day >= v_start_day), 0),
           coalesce(sum(d.with_brand) filter (where d.day < v_start_day), 0)
    from public.mentions_entities_daily d
    where v_rollup
      and d.entity <> 'brand'
      and d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity
    having sum(d.with_brand) > 0
  )
  select jsonb_build_object(
    'window', jsonb_build_object('from', v_start, 'to', v_end, 'days', v_days),
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entity', s.entity,
               'name', case when s.entity = 'brand' then b.name else co.name end,
               'is_brand', s.entity = 'brand',
               'mentions', coalesce(ec.mentions, 0),
               'prev_mentions', coalesce(ec.prev_mentions, 0))
             order by s.rank)
      from shown s
      left join entity_counts ec on ec.entity = s.entity
      left join public.brands b on s.entity = 'brand' and b.id = p_brand_id
      left join public.competitors co on co.id::text = s.entity and co.brand_id = p_brand_id
    ), '[]'::jsonb),
    'brand_terms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'term', bt.term, 'answers', bt.answers,
               'prev_answers', coalesce(bp.prev_answers, 0))
             order by bt.answers desc, bt.term)
      from brand_terms bt
      left join brand_prev bp on bp.term = bt.term
    ), '[]'::jsonb),
    'attributes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'term', a.term,
               'values', (
                 select jsonb_agg(jsonb_build_object(
                          'entity', s.entity, 'answers', coalesce(tc.answers, 0))
                        order by s.rank)
                 from shown s
                 left join term_counts_all tc on tc.entity = s.entity and tc.term = a.term)))
      from attributes a
    ), '[]'::jsonb),
    'co_mentions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'competitor_id', c.entity,
               'name', comp.name,
               'co_mentions', c.co_mentions,
               'prev_co_mentions', c.prev_co_mentions)
             order by c.co_mentions desc, comp.name)
      from co c
      join public.competitors comp on comp.id::text = c.entity and comp.brand_id = p_brand_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ── The backfill: one brand's days at a time ───────────────────────────────

-- Packs one brand's days (pack_mention_terms_daily), safe to re-run over any
-- days. With p_mark_ready, it then lists the brand in
-- mentions_terms_packed_ready, in the same transaction: the script passes it
-- on the brand's last chunk only, and a brand not in fast_rollups_ready (its
-- mentions_terms_daily_all may not hold its history yet) is refused.
--
-- It takes the terms refresh's lock, as refresh_mention_terms_daily does, so
-- a refresh of the brand runs before or after a chunk, never across it. It
-- takes no other lock, so it can't wait on backfill_fast_rollups the other
-- way round. A chunk's memory is bounded by its days, not the table.
create or replace function public.backfill_mention_terms_packed(
  p_brand_id   uuid,
  p_day_from   date,
  p_day_to     date,
  p_mark_ready boolean default false
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_rows bigint;
begin
  if p_brand_id is null or p_day_from is null or p_day_to is null or p_day_from > p_day_to then
    raise exception 'backfill_mention_terms_packed: a brand and a day range from <= to are required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refresh_mention_terms_daily:' || p_brand_id::text, 0));

  v_rows := public.pack_mention_terms_daily(p_brand_id, p_day_from, p_day_to);

  if p_mark_ready then
    if not exists (select 1 from public.fast_rollups_ready r where r.brand_id = p_brand_id) then
      raise exception 'backfill_mention_terms_packed: brand % is not in fast_rollups_ready; run backfill-fast-rollups.js for it first',
        p_brand_id;
    end if;
    insert into public.mentions_terms_packed_ready (brand_id) values (p_brand_id)
    on conflict (brand_id) do nothing;
  end if;

  return jsonb_build_object('packed_rows', v_rows);
end;
$$;

-- What the backfill script walks: every brand in fast_rollups_ready but a
-- demo one (fast_rollups_backfill_ranges leaves those out too), by id, with
-- the first and last day of its Perception rollups, found by the (brand_id,
-- day) index. One jsonb value, not rows: an API call's rows are capped
-- (PostgREST max-rows).
create or replace function public.mentions_terms_packed_backfill_ranges()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'brand_id', x.brand_id,
           'day_from', x.day_from,
           'day_to',   x.day_to,
           'ready',    x.ready)
         order by x.brand_id), '[]'::jsonb)
  from (
    select b.id as brand_id,
           (select min(d.day) from public.mentions_entities_daily d where d.brand_id = b.id) as day_from,
           (select max(d.day) from public.mentions_entities_daily d where d.brand_id = b.id) as day_to,
           exists (select 1 from public.mentions_terms_packed_ready r where r.brand_id = b.id) as ready
    from public.brands b
    join public.fast_rollups_ready f on f.brand_id = b.id
    where not b.is_demo
  ) x
  where x.day_from is not null;
$$;

revoke execute on function public.pack_mention_terms_daily(uuid, date, date)
  from public, anon, authenticated;
revoke execute on function public.refresh_mention_terms_daily(uuid, date, date)
  from public, anon, authenticated;
revoke execute on function public.backfill_fast_rollups(uuid, date, date, boolean)
  from public, anon, authenticated;
revoke execute on function public.backfill_mention_terms_packed(uuid, date, date, boolean)
  from public, anon, authenticated;
revoke execute on function public.mentions_terms_packed_backfill_ranges()
  from public, anon, authenticated;
revoke all on function public.mentions_perception_live(uuid, timestamptz, timestamptz, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mentions_perception_live(uuid, timestamptz, timestamptz, text, text, uuid, text)
  to service_role;

reset lock_timeout;
