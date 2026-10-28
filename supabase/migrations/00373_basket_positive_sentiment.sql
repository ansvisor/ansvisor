-- ============================================================================
-- 00373: a basket's positive sentiment (learning D1)
-- ============================================================================
-- An action sent from Mentions (MS-08) is measured on its answers' prompts
-- (opportunity_basket_metrics, 00116), but the basket read mentions,
-- visibility and citations only: an action sent to turn negative answers
-- around was judged by how often the brand was named, not by how it was
-- spoken of. The basket now reads its prompts' answers naming the brand and
-- the positive ones among them, from the prompt-grain rollup (00130), as
-- Insights' Positive sentiment card counts them; the server turns them into
-- the positive share (basket-metrics.js). Null while a day of the window
-- isn't rewritten with them yet. Otherwise as 00116.

create or replace function public.opportunity_basket_metrics(
  p_brand_id uuid,
  p_prompt_ids uuid[],
  p_page_keys text[],
  p_page_domains text[],
  p_page_paths text[],
  p_from date,
  p_to date
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with cells as (
    select count(*) as cells,
           count(*) filter (where has_mention or has_citation) as visible,
           coalesce(sum(answer_count) filter (where has_mention), 0) as mention_answers,
           -- Sentiment (00373): the answers naming the brand, and the positive
           -- ones among them, as Insights' Positive sentiment card counts them.
           coalesce(sum(mentioning_answers), 0) as mentioning_answers,
           coalesce(sum(positive_count), 0) as positive_answers,
           count(*) filter (where mentioning_answers is null or positive_count is null) as unfilled
    from insights_prompt_daily
    where brand_id = p_brand_id
      and day between p_from and p_to
      and prompt_id = any(p_prompt_ids)
  ),
  comp as (
    select d.competitor_id, count(*) as visible
    from insights_competitor_prompt_daily d
    join competitors c on c.id::text = d.competitor_id and c.brand_id = p_brand_id
    where d.brand_id = p_brand_id
      and d.day between p_from and p_to
      and d.prompt_id = any(p_prompt_ids)
    group by d.competitor_id
  ),
  urls as (
    select id
    from citation_urls
    where domain = any(p_page_domains)
      and rtrim(
            regexp_replace(split_part(split_part(lower(url), '#', 1), '?', 1), '^https?://(www\.)?', ''),
            '/'
          ) = any(p_page_keys)
  )
  select jsonb_build_object(
    'cells', (select cells from cells),
    'visible', (select visible from cells),
    'mention_answers', (select mention_answers from cells),
    -- Null while a day of the window isn't rewritten with them yet (00130):
    -- a partial count would read as a change.
    'mentioning_answers', (select case when unfilled = 0 then mentioning_answers end from cells),
    'positive_answers', (select case when unfilled = 0 then positive_answers end from cells),
    'competitor_visible_total', (select coalesce(sum(visible), 0) from comp),
    'top_competitor_visible', (select coalesce(max(visible), 0) from comp),
    'page_citations', (
      select count(*)
      from prompt_result_citations
      where brand_id = p_brand_id
        and created_at >= p_from
        and created_at < p_to + 1
        and url_id in (select id from urls)
    ),
    'ga_connected', exists (
      select 1 from ga_ai_traffic_stats
      where brand_id = p_brand_id and date between p_from and p_to
    ),
    'page_ai_sessions', (
      select coalesce(sum(sessions), 0)
      from ga_ai_traffic_stats
      where brand_id = p_brand_id
        and date between p_from and p_to
        and coalesce(nullif(rtrim(split_part(landing_page, '?', 1), '/'), ''), '/') = any(p_page_paths)
    )
  );
$$;

revoke all on function public.opportunity_basket_metrics(uuid, uuid[], text[], text[], text[], date, date)
  from public, anon, authenticated;
grant execute on function public.opportunity_basket_metrics(uuid, uuid[], text[], text[], text[], date, date)
  to service_role;

notify pgrst, 'reload schema';
