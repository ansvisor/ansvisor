-- Add inline_products column to prompt_results
-- Mirrors the existing shopping_cards column for ChatGPT Shopping product data
ALTER TABLE prompt_results
ADD COLUMN IF NOT EXISTS inline_products jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN prompt_results.inline_products IS 'Structured product data from inlineProducts field (ChatGPT Shopping, AI Mode)';
