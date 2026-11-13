-- Brand content rules: banned phrases and source allow/deny lists, one jsonb
-- value per brand: { bannedPhrases, blockedDomains, allowedDomains,
-- onlyAllowedDomains }. Schema only, no backfill: null means no rules. The
-- brands row policies already limit who reads and who changes it
-- (member select, admin/manager update).
alter table public.brands add column if not exists content_rules jsonb;
