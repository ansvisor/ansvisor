-- 00566: Enterprise buys extra brands and AI usage top-ups itself
--
-- Extra brands and AI usage top-ups (00546) were sold to Growth only; an
-- Enterprise workspace had to ask Ansvisor to raise its limits. Enterprise
-- now buys them in Settings › Billing at the same prices, on the same Stripe
-- prices (lookup keys addon_brand_month / _year, addon_ai_topup_5x / 10x /
-- 20x): brands as items on its plan's subscription, read by the plan's limit
-- as Growth's (plan-row.ts); top-ups granted as Growth's, whatever the plan.

update public.add_on_products
set plans = array_append(plans, 'enterprise')
where kind in ('brand', 'ai_topup')
  and plans is not null
  and not ('enterprise' = any (plans));
