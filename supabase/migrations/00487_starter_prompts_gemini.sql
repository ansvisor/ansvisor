-- Starter prompts track Gemini, no longer Microsoft Copilot (00487).
--
-- Cloro stopped serving Copilot and Perplexity on 2026-11-06: both block
-- logged-out sessions, and Cloro rejects their tasks. The tracking worker now
-- skips the two engines (UNAVAILABLE_PLATFORMS), and Starter's engine list in
-- config/plans (web and server) became ChatGPT and Gemini (#2181). New or
-- edited prompts follow that list, but the worker runs each prompt's stored
-- `platforms`, so a Starter prompt saved with Copilot now tracks ChatGPT only.
-- This swaps Copilot for Gemini on those prompts and drops Perplexity, which
-- Starter no longer had (00134), keeping the order and listing Gemini once,
-- as alignPromptsToPlanForOrg would on a plan change. Owner decision,
-- 2026-11-06.
--
-- Organizations on the Starter plan, in their free trial or paid, have their
-- prompts moved. Only cloud organizations are touched, as in 00134: a Stripe
-- customer exists only there, and self-hosted installs run every engine,
-- whatever `plan` holds. The demo brand is left out: its prompts are sample
-- data the server rebuilds (00380). Past Copilot and Perplexity results stay
-- as they are.

update public.prompts p
set platforms = coalesce(
  (
    select array_agg(engine.platform order by engine.first_at)
    from (
      select
        case when u.platform = 'copilot-web' then 'gemini-web' else u.platform end as platform,
        min(u.ord) as first_at
      from unnest(p.platforms) with ordinality as u(platform, ord)
      where u.platform <> 'perplexity-web'
      group by 1
    ) as engine
  ),
  '{}'::text[]
)
from public.prompt_sets ps
join public.brands b on b.id = ps.brand_id
join public.organizations o on o.id = b.organization_id
where p.prompt_set_id = ps.id
  and o.plan = 'starter'
  and o.stripe_customer_id is not null
  and not b.is_demo
  and p.platforms && array['copilot-web', 'perplexity-web']::text[];
