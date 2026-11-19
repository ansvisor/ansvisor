-- Head-to-head follows the Competitors page's date picker (UX audit CP-02).
--
-- head_to_head_daily (00169, body 00434) read every day of the rollups, so
-- the head-to-head summary, Gaps, Strengths and Prompt-by-Prompt were all
-- time while the competitor cards above them followed the picker (7d, 30d,
-- 90d, a custom range). head_to_head_window_daily is the same read over the
-- picker's days, as the other Insights reads take them
-- (insights_topic_competitors_daily, 00434): p_day_from / p_day_to, both
-- inclusive UTC days, null for no bound, both null for all time.
--
-- A function of its own beside head_to_head_daily, which stays as it is for
-- a caller still on it (the app before this change) and can be dropped once
-- nothing calls it. Not an overload of it: a call naming only the brand and
-- the competitor would then match both (with defaulted bounds), and the
-- brand-access checks keep one definition per function name.
--
-- Functions only: nothing is backfilled; it applies in seconds.

create function public.head_to_head_window_daily(
  p_brand_id uuid,
  p_competitor_id text,
  p_day_from date,
  p_day_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
    return null;
  end if;

  with brand_groups as (
    select d.prompt_id, d.platform, d.model_used, d.region,
           sum(d.answer_count)   as runs,
           sum(d.sum_visibility) as brand_total,
           max(d.max_created_at) as latest_at
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    group by d.prompt_id, d.platform, d.model_used, d.region
  ),
  comp_groups as (
    select cd.prompt_id, cd.platform, cd.model_used, cd.region,
           sum(cd.sum_visibility) as comp_total
    from public.insights_competitor_prompt_daily cd
    where cd.brand_id = p_brand_id
      and cd.competitor_id = p_competitor_id
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
    group by cd.prompt_id, cd.platform, cd.model_used, cd.region
  ),
  brand_engines as (
    select d.platform, d.model_used,
           sum(d.answer_count)   as brand_count,
           sum(d.sum_visibility) as brand_total
    from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    group by d.platform, d.model_used
  ),
  comp_engines as (
    select cd.platform, cd.model_used,
           sum(cd.answer_count)   as comp_count,
           sum(cd.sum_visibility) as comp_total
    from public.insights_competitor_daily cd
    where cd.brand_id = p_brand_id
      and cd.competitor_id = p_competitor_id
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
    group by cd.platform, cd.model_used
  )
  select jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'prompt_id',       g.prompt_id,
               'platform',        g.platform,
               'model_used',      g.model_used,
               'region',          g.region,
               'runs',            g.runs,
               'brand_total',     coalesce(g.brand_total, 0),
               'comp_total',      coalesce(c.comp_total, 0),
               'latest_at',       g.latest_at))
      from brand_groups g
      left join comp_groups c
        on c.prompt_id = g.prompt_id
       and c.platform is not distinct from g.platform
       and c.model_used is not distinct from g.model_used
       and c.region is not distinct from g.region
    ), '[]'::jsonb),
    -- Each prompt's text once, rather than on each of its groups.
    'prompts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'text', p.text, 'category', p.category))
      from public.prompts p
      where p.id in (select g.prompt_id from brand_groups g)
    ), '[]'::jsonb),
    'engines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'platform',    e.platform,
               'model_used',  e.model_used,
               'brand_count', e.brand_count,
               'brand_total', coalesce(e.brand_total, 0),
               'comp_count',  coalesce(c.comp_count, 0),
               'comp_total',  coalesce(c.comp_total, 0)))
      from brand_engines e
      left join comp_engines c
        on c.platform is not distinct from e.platform
       and c.model_used is not distinct from e.model_used
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.head_to_head_window_daily(uuid, text, date, date) from public, anon;
grant execute on function public.head_to_head_window_daily(uuid, text, date, date) to authenticated, service_role;

comment on function public.head_to_head_window_daily(uuid, text, date, date) is
  'Head-to-head on the Competitors page (#923) over the picker''s days, beside the all-time head_to_head_daily (p_day_from..p_day_to, inclusive UTC days; null for no bound, both null for all time; CP-02), from the daily rollups (00164): per (prompt, platform, model, region) the runs and the brand''s and the competitor''s visibility, their averages per engine and overall, and each prompt''s text once. Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads null.';
