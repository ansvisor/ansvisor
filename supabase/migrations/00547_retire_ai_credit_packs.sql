-- ============================================================================
-- 00547: AI credit packs leave the sale; AI usage top-ups take their place
-- ============================================================================
-- Growth add-ons (00546) sell one-time AI usage top-ups (+5x, +10x, +20x),
-- valid until the plan renews. CHAT-18's AI credit packs ($10 … $1,000,
-- 12 months) are no longer sold: their rows are switched off, so Billing
-- and the Get more window stop offering them. Packs already bought keep
-- their credits until they expire (ai_credit_grants is untouched), and
-- storage packs stay on sale. Four rows; nothing else changes.

update public.add_on_products
set active = false
where kind = 'ai'
  and active;
