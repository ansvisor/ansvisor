-- Serialize concurrent refreshes of one brand's daily rollups (#1020).
--
-- refresh_insights_daily and refresh_citations_daily each delete a brand's
-- rows for a day range, then recompute and insert them. The tables have no
-- unique key, and several callers can refresh the same brand and days at once:
-- a completed run, the nightly sweep, and the topic-move rebuild. When two
-- overlap, the second one's DELETE waits for the first to commit, but its
-- snapshot predates the first one's INSERT, so it skips those rows and adds
-- its own. The overlapping days end up with every row twice.
--
-- Each function now takes a transaction-scoped advisory lock on the brand
-- before deleting. A second refresh of the same brand waits for the first to
-- commit and then deletes its rows; refreshes of different brands still run in
-- parallel. The two functions write different tables, so each has its own key.
--
-- The lock lasts one call. refreshCitationHistory rebuilds a brand in
-- HISTORY_CHUNK_DAYS (14-day) calls, so a refresh queued behind a rebuild
-- waits for one chunk, not the whole history, and stays inside the service
-- role's 120s statement_timeout (00100).
--
-- The bodies are 00131's and 00118's unchanged apart from the lock.

-- ─── Insights ───────────────────────────────────────────────────────────────

create or replace function public.refresh_insights_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to date
) returns void
language plpgsql
set search_path to 'public'
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('refresh_insights_daily:' || p_brand_id::text, 0));

  delete from public.insights_brand_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.insights_brand_daily (
    brand_id, day, model_used, platform, region,
    answer_count, mention_answers, citation_answers, mentioning_answers,
    sum_visibility, sum_visibility_visible, total_mentions, total_citations,
    positive_count, sum_inv_position, position_count, max_created_at,
    negative_count, sum_position)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.model_used, pr.platform, pr.region,
    count(*),
    count(*) filter (where pr.mention_count > 0),
    count(*) filter (where pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0),
    coalesce(sum(pr.visibility_score), 0),
    coalesce(sum(pr.visibility_score)
      filter (where pr.mention_count > 0 or pr.citation_count > 0), 0),
    coalesce(sum(pr.mention_count), 0),
    coalesce(sum(pr.citation_count), 0),
    count(*) filter (where pr.sentiment = 'positive'),
    sum(1.0 / pr.mention_position) filter (where pr.mention_position is not null),
    count(*) filter (where pr.mention_position is not null),
    max(pr.created_at),
    count(*) filter (where pr.sentiment = 'negative'),
    sum(pr.mention_position) filter (where pr.mention_position is not null)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.model_used, pr.platform, pr.region;

  insert into public.insights_prompt_daily (
    brand_id, day, prompt_id, model_used, platform, region,
    answer_count, has_mention, has_citation,
    mention_answers, citation_answers, mentioning_answers, positive_count,
    total_mentions, total_citations, sum_inv_position, position_count,
    negative_count, sum_position)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    count(*),
    bool_or(pr.mention_count > 0),
    bool_or(pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0),
    count(*) filter (where pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0),
    count(*) filter (where pr.sentiment = 'positive'),
    coalesce(sum(pr.mention_count), 0),
    coalesce(sum(pr.citation_count), 0),
    sum(1.0 / pr.mention_position) filter (where pr.mention_position is not null),
    count(*) filter (where pr.mention_position is not null),
    count(*) filter (where pr.sentiment = 'negative'),
    sum(pr.mention_position) filter (where pr.mention_position is not null)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.prompt_id, pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_daily (
    brand_id, day, competitor_id, model_used, platform, region,
    answer_count, sum_visibility, total_mentions, total_citations,
    mention_answers, citation_answers, sum_inv_position, position_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.model_used, pr.platform, pr.region,
    count(*),
    sum((cm.value->>'visibility_score')::numeric),
    coalesce(sum(coalesce((cm.value->>'mention_count')::int, 0)), 0),
    coalesce(sum(coalesce((cm.value->>'citation_count')::int, 0)), 0),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position') is not null),
    count(*) filter (where (cm.value->>'mention_position') is not null)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
  group by 2, cm.value->>'competitor_id', pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_prompt_daily (
    brand_id, day, competitor_id, prompt_id, model_used, platform, region, mention_count,
    mention_answers, citation_answers, sum_inv_position, position_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    sum(coalesce((cm.value->>'mention_count')::int, 0)),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position') is not null),
    count(*) filter (where (cm.value->>'mention_position') is not null)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
    and (coalesce((cm.value->>'mention_count')::int, 0) > 0
      or coalesce((cm.value->>'citation_count')::int, 0) > 0
      or coalesce((cm.value->>'visibility_score')::numeric, 0) > 0)
  group by 2, cm.value->>'competitor_id', pr.prompt_id, pr.model_used, pr.platform, pr.region;
end;
$$;

revoke execute on function public.refresh_insights_daily(uuid, date, date)
  from public, anon, authenticated;

-- ─── Citations ──────────────────────────────────────────────────────────────

create or replace function public.refresh_citations_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to date
) returns void
language plpgsql
set search_path to 'public'
set work_mem to '256MB'
as $$
declare
  ts_from timestamptz := p_day_from::timestamp at time zone 'utc';
  ts_to   timestamptz := (p_day_to + 1)::timestamp at time zone 'utc';
begin
  perform pg_advisory_xact_lock(hashtextextended('refresh_citations_daily:' || p_brand_id::text, 0));

  delete from public.citation_result_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.citation_domain_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.citation_url_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.citation_result_daily (
    brand_id, day, model_used, platform, region, topic_id, answers)
  select p_brand_id,
         (pr.created_at at time zone 'utc')::date,
         pr.model_used, pr.platform, pr.region, p.topic_id,
         count(*)
  from public.prompt_results pr
  left join public.prompts p on p.id = pr.prompt_id
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from analytics
    and pr.created_at >= ts_from and pr.created_at < ts_to
  group by 2, pr.model_used, pr.platform, pr.region, p.topic_id;

  -- A citation row carries its answer's created_at, so the citation index
  -- bounds the scan; the answer supplies the bucket.
  insert into public.citation_domain_daily (
    brand_id, day, model_used, platform, region, topic_id, domain, citations, results)
  select p_brand_id,
         (pr.created_at at time zone 'utc')::date,
         pr.model_used, pr.platform, pr.region, p.topic_id, cu.domain,
         count(*),
         count(distinct c.prompt_result_id)
  from public.prompt_result_citations c
  join public.prompt_results pr on pr.id = c.prompt_result_id
  left join public.prompts p on p.id = pr.prompt_id
  join public.citation_urls cu on cu.id = c.url_id
  where c.brand_id = p_brand_id
    and c.created_at >= ts_from and c.created_at < ts_to
    and pr.platform <> 'chatgpt-shopping'
  group by 2, pr.model_used, pr.platform, pr.region, p.topic_id, cu.domain;

  insert into public.citation_url_daily (
    brand_id, day, model_used, platform, region, topic_id, url_id, citations, results)
  select p_brand_id,
         (pr.created_at at time zone 'utc')::date,
         pr.model_used, pr.platform, pr.region, p.topic_id, c.url_id,
         count(*),
         count(distinct c.prompt_result_id)
  from public.prompt_result_citations c
  join public.prompt_results pr on pr.id = c.prompt_result_id
  left join public.prompts p on p.id = pr.prompt_id
  where c.brand_id = p_brand_id
    and c.created_at >= ts_from and c.created_at < ts_to
    and pr.platform <> 'chatgpt-shopping'
  group by 2, pr.model_used, pr.platform, pr.region, p.topic_id, c.url_id;
end;
$$;

revoke execute on function public.refresh_citations_daily(uuid, date, date)
  from public, anon, authenticated;
