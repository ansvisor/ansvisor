-- Site Audit Opportunities (SA-004): prompts where a competitor is cited and
-- the brand isn't.
--
-- The Opportunities inbox lists, for each such prompt, the brand page closest
-- to it, as a page worth auditing. This read gives the prompts: per active
-- prompt of the brand, over the window, how many answers cited a competitor's
-- domain and how many cited one of the brand's own, and which competitor
-- domains were cited. Only prompts with a competitor citation are returned;
-- the caller keeps the ones the brand was never cited on.
--
-- Domains match as the citation tables store them (citation_urls.domain:
-- lowercase, no "www."), a domain or any of its subdomains. The caller passes
-- the brand's and its competitors' hosts the same way.

create or replace function public.audit_competitor_cited_prompts(
  p_brand_id uuid,
  p_since timestamptz,
  p_own_domains text[],
  p_competitor_domains text[]
) returns table (
  prompt_id uuid,
  prompt_text text,
  results bigint,
  competitor_results bigint,
  own_results bigint,
  competitor_domains text[]
)
language sql
stable
set search_path = public
as $$
  with answers as (
    select pr.id, pr.prompt_id
    from prompt_results pr
    join prompts p on p.id = pr.prompt_id and p.is_active
    where pr.brand_id = p_brand_id
      and pr.created_at >= p_since
  ),
  cited as (
    select prc.prompt_result_id, cu.domain
    from prompt_result_citations prc
    join citation_urls cu on cu.id = prc.url_id
    where prc.brand_id = p_brand_id
      and prc.created_at >= p_since
  ),
  -- Each answer: whether it cited the brand, and the competitor domains it cited.
  per_answer as (
    select a.prompt_id, a.id,
      coalesce(bool_or(own.d is not null), false) as own_cited,
      array_remove(array_agg(distinct comp.d), null) as comp_domains
    from answers a
    left join cited c on c.prompt_result_id = a.id
    left join unnest(p_own_domains) as own(d)
      on c.domain = own.d or c.domain like '%.' || own.d
    left join unnest(p_competitor_domains) as comp(d)
      on c.domain = comp.d or c.domain like '%.' || comp.d
    group by a.prompt_id, a.id
  ),
  per_prompt as (
    select pa.prompt_id,
      count(*) as results,
      count(*) filter (where cardinality(pa.comp_domains) > 0) as competitor_results,
      count(*) filter (where pa.own_cited) as own_results
    from per_answer pa
    group by pa.prompt_id
  ),
  domains as (
    select pa.prompt_id, array_agg(distinct d order by d) as competitor_domains
    from per_answer pa, unnest(pa.comp_domains) as d
    group by pa.prompt_id
  )
  select pp.prompt_id, p.text, pp.results, pp.competitor_results, pp.own_results,
    d.competitor_domains
  from per_prompt pp
  join prompts p on p.id = pp.prompt_id
  join domains d on d.prompt_id = pp.prompt_id
  where pp.competitor_results > 0
  order by pp.competitor_results desc, pp.prompt_id
$$;

-- Service-role only, like the other server reads.
revoke all on function public.audit_competitor_cited_prompts(uuid, timestamptz, text[], text[])
  from public, anon, authenticated;
grant execute on function public.audit_competitor_cited_prompts(uuid, timestamptz, text[], text[])
  to service_role;

notify pgrst, 'reload schema';
