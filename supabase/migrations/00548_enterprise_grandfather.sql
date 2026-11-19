-- ============================================================================
-- 00548: Enterprise's new defaults; existing contracts keep what they have
-- ============================================================================
-- Enterprise now starts from $1,999 a month with 1 brand and 3,000 prompt
-- locations by default (web/src/config/plans.ts, server/src/config/plans.js);
-- more is set per contract in plan_overrides, as today. Workspaces already
-- on Enterprise were sold unlimited brands and prompts: their overrides get
-- maxBrands -1 and maxPrompts -1, only where the contract set no number of
-- its own, so nothing a customer has today changes. A few rows; running it
-- again changes nothing.

update public.organizations
set plan_overrides = jsonb_build_object('maxBrands', -1, 'maxPrompts', -1)
  || coalesce(plan_overrides, '{}'::jsonb)
where plan = 'enterprise'
  and (
    plan_overrides is null
    or not (plan_overrides ? 'maxBrands')
    or not (plan_overrides ? 'maxPrompts')
  );
