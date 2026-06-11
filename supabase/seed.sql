-- Demo data fixture for local development.
--
-- Runs automatically on `supabase db reset` (Supabase only sources seed.sql
-- through the local CLI — it never executes against a hosted project).
--
-- Every row uses a fixed UUID and `ON CONFLICT DO NOTHING`, so re-running
-- the reset is idempotent.
--
-- Sign-in: demo@ansvisor.local / demo123

-- ─── Auth user + identity ────────────────────────────────────────────────────

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  -- GoTrue scans these token columns into Go strings; NULL aborts every
  -- login with "converting NULL to string is unsupported". Manual inserts
  -- must seed them as empty strings.
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'demo@ansvisor.local',
  extensions.crypt('demo123', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Demo User"}'::jsonb,
  now() - interval '30 days',
  now(),
  '', '', '', '', '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  created_at,
  updated_at,
  last_sign_in_at
)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '{"sub": "11111111-1111-1111-1111-111111111111", "email": "demo@ansvisor.local", "email_verified": true}'::jsonb,
  'email',
  now() - interval '30 days',
  now(),
  now()
)
ON CONFLICT (provider, provider_id) DO NOTHING;

-- ─── Organization + profile wiring ───────────────────────────────────────────

INSERT INTO public.organizations (id, name, slug, plan, subscription_status, created_at)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'Demo Org',
  'demo-org',
  'self_hosted',
  'active',
  now() - interval '30 days'
)
ON CONFLICT (id) DO NOTHING;

-- The on_auth_user_created trigger already inserted a row in public.profiles
-- when the auth user landed; attach it to the org and mark onboarding done.
UPDATE public.profiles
SET
  organization_id = '22222222-2222-2222-2222-222222222222',
  role = 'admin',
  full_name = 'Demo User',
  onboarding_completed = true
WHERE id = '11111111-1111-1111-1111-111111111111';

-- ─── Brand + domain + platforms ──────────────────────────────────────────────

INSERT INTO public.brands (
  id, organization_id, name, slug, industry, description, region, language, created_at
)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  'Acme Coffee',
  'acme-coffee',
  'Food & Beverage',
  'Fictional specialty coffee subscription service. Demo fixture only.',
  'US',
  'en',
  now() - interval '30 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brand_domains (id, brand_id, domain, country, is_primary)
VALUES (
  '44444444-4444-4444-4444-444444444401',
  '33333333-3333-3333-3333-333333333333',
  'acme-coffee.example.com',
  'US',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brand_platforms (id, brand_id, platform, is_enabled, check_frequency, api_model) VALUES
  ('55555555-5555-5555-5555-555555555501', '33333333-3333-3333-3333-333333333333', 'chatgpt-web',    true, 'daily', NULL),
  ('55555555-5555-5555-5555-555555555502', '33333333-3333-3333-3333-333333333333', 'claude',         true, 'daily', 'claude-sonnet-4-6'),
  ('55555555-5555-5555-5555-555555555503', '33333333-3333-3333-3333-333333333333', 'copilot-web',    true, 'daily', NULL),
  ('55555555-5555-5555-5555-555555555504', '33333333-3333-3333-3333-333333333333', 'gemini-web',     true, 'daily', NULL),
  ('55555555-5555-5555-5555-555555555505', '33333333-3333-3333-3333-333333333333', 'google-aimode',  true, 'daily', NULL),
  ('55555555-5555-5555-5555-555555555506', '33333333-3333-3333-3333-333333333333', 'google-aio',     true, 'daily', NULL),
  ('55555555-5555-5555-5555-555555555507', '33333333-3333-3333-3333-333333333333', 'grok-web',       true, 'daily', NULL),
  ('55555555-5555-5555-5555-555555555508', '33333333-3333-3333-3333-333333333333', 'perplexity-web', true, 'daily', NULL)
ON CONFLICT (id) DO NOTHING;

-- ─── Prompt set + topics + prompts ───────────────────────────────────────────

INSERT INTO public.prompt_sets (id, brand_id, name) VALUES
  ('66666666-6666-6666-6666-666666666601', '33333333-3333-3333-3333-333333333333', 'Default')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.topics (id, brand_id, name, is_active) VALUES
  ('77777777-7777-7777-7777-777777777701', '33333333-3333-3333-3333-333333333333', 'Coffee subscription services', true),
  ('77777777-7777-7777-7777-777777777702', '33333333-3333-3333-3333-333333333333', 'Espresso machines under $500', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.prompts (
  id, prompt_set_id, topic_id, text, platforms, regions, models, is_active
) VALUES
  ('88888888-8888-8888-8888-888888888801', '66666666-6666-6666-6666-666666666601', '77777777-7777-7777-7777-777777777701',
   'What are the best coffee subscription services in 2026?',
   ARRAY['chatgpt-web','claude','copilot-web','gemini-web','google-aimode','google-aio','grok-web','perplexity-web'],
   ARRAY['US','GB','DE','TR'],
   ARRAY['claude-sonnet-4-6'], true),
  ('88888888-8888-8888-8888-888888888802', '66666666-6666-6666-6666-666666666601', '77777777-7777-7777-7777-777777777701',
   'Which specialty coffee subscriptions ship internationally?',
   ARRAY['chatgpt-web','claude','perplexity-web','gemini-web'],
   ARRAY['US','GB','DE'],
   ARRAY['claude-sonnet-4-6'], true),
  ('88888888-8888-8888-8888-888888888803', '66666666-6666-6666-6666-666666666601', '77777777-7777-7777-7777-777777777701',
   'Best monthly coffee bean subscription for offices',
   ARRAY['chatgpt-web','claude','copilot-web'],
   ARRAY['US','TR'],
   ARRAY['claude-sonnet-4-6'], true),
  ('88888888-8888-8888-8888-888888888804', '66666666-6666-6666-6666-666666666601', '77777777-7777-7777-7777-777777777702',
   'Best espresso machines under $500?',
   ARRAY['chatgpt-web','claude','copilot-web','gemini-web','google-aimode','grok-web','perplexity-web'],
   ARRAY['US','GB','DE','FR','TR'],
   ARRAY['claude-sonnet-4-6'], true),
  ('88888888-8888-8888-8888-888888888805', '66666666-6666-6666-6666-666666666601', '77777777-7777-7777-7777-777777777702',
   'Compare home espresso machines for beginners',
   ARRAY['chatgpt-web','claude','perplexity-web','google-aio'],
   ARRAY['US','GB'],
   ARRAY['claude-sonnet-4-6'], true),
  ('88888888-8888-8888-8888-888888888806', '66666666-6666-6666-6666-666666666601', '77777777-7777-7777-7777-777777777702',
   'Manual vs automatic espresso machine for home use',
   ARRAY['chatgpt-web','claude','copilot-web','gemini-web','grok-web'],
   ARRAY['US','TR','DE'],
   ARRAY['claude-sonnet-4-6'], true)
ON CONFLICT (id) DO NOTHING;

-- ─── Prompt volumes ──────────────────────────────────────────────────────────
-- Keyword search-volume estimates per prompt. Normally produced by the backend's
-- volume analysis (DataForSEO + AI), which needs paid API keys a contributor
-- won't have — so we seed them here. Without these rows the Prompts page volume
-- view stays empty even with the backend running. Served read-only by
-- GET /api/volumes/brand/:id (no provider keys required to read).

INSERT INTO public.prompt_volumes (
  prompt_id, intent, keywords, google_volumes,
  total_google_volume, ai_volume_multiplier, est_ai_volume,
  location_code, language_code, fetched_at
) VALUES
  ('88888888-8888-8888-8888-888888888801', 'best-top',
   '["best coffee subscription","coffee subscription","coffee subscription services","best coffee subscription 2026"]'::jsonb,
   '{"best coffee subscription":8100,"coffee subscription":22200,"coffee subscription services":5400,"best coffee subscription 2026":1300}'::jsonb,
   37000, 0.150, 5550, 2840, 'en', now() - interval '2 days'),
  ('88888888-8888-8888-8888-888888888802', 'recommendation',
   '["international coffee subscription","specialty coffee subscription","coffee subscription worldwide shipping"]'::jsonb,
   '{"international coffee subscription":2400,"specialty coffee subscription":4400,"coffee subscription worldwide shipping":880}'::jsonb,
   7680, 0.150, 1152, 2840, 'en', now() - interval '2 days'),
  ('88888888-8888-8888-8888-888888888803', 'best-top',
   '["office coffee subscription","monthly coffee bean subscription","coffee subscription for business"]'::jsonb,
   '{"office coffee subscription":3600,"monthly coffee bean subscription":1900,"coffee subscription for business":1600}'::jsonb,
   7100, 0.150, 1065, 2840, 'en', now() - interval '2 days'),
  ('88888888-8888-8888-8888-888888888804', 'best-top',
   '["best espresso machine","home espresso machine","best espresso machine under 500","espresso machine under $500"]'::jsonb,
   '{"best espresso machine":18100,"home espresso machine":9900,"best espresso machine under 500":6600,"espresso machine under $500":4400}'::jsonb,
   39000, 0.150, 5850, 2840, 'en', now() - interval '2 days'),
  ('88888888-8888-8888-8888-888888888805', 'comparison',
   '["best espresso machine for beginners","beginner espresso machine","home espresso machine comparison"]'::jsonb,
   '{"best espresso machine for beginners":5400,"beginner espresso machine":2400,"home espresso machine comparison":720}'::jsonb,
   8520, 0.150, 1278, 2840, 'en', now() - interval '2 days'),
  ('88888888-8888-8888-8888-888888888806', 'vs-review',
   '["manual vs automatic espresso machine","manual espresso machine","automatic espresso machine"]'::jsonb,
   '{"manual vs automatic espresso machine":1900,"manual espresso machine":3600,"automatic espresso machine":4400}'::jsonb,
   9900, 0.150, 1485, 2840, 'en', now() - interval '2 days')
ON CONFLICT (prompt_id) DO NOTHING;

-- ─── Competitors ─────────────────────────────────────────────────────────────

INSERT INTO public.competitors (id, brand_id, name, domain) VALUES
  ('99999999-9999-9999-9999-999999999901', '33333333-3333-3333-3333-333333333333', 'Demo Coffee Co',     'demo-coffee.example.com'),
  ('99999999-9999-9999-9999-999999999902', '33333333-3333-3333-3333-333333333333', 'Fixture Roasters',   'fixture-roasters.example.com'),
  ('99999999-9999-9999-9999-999999999903', '33333333-3333-3333-3333-333333333333', 'Sample Beans',       'sample-beans.example.com'),
  ('99999999-9999-9999-9999-999999999904', '33333333-3333-3333-3333-333333333333', 'Mock Coffee Club',   'mock-coffee.example.com')
ON CONFLICT (id) DO NOTHING;

-- ─── Prompt results ──────────────────────────────────────────────────────────
-- Cross-join prompts × platform/model pairs × regions, filtered against each
-- prompt's `platforms` and `regions` arrays so we only emit rows that match
-- how the tracker would actually have run them. UUIDs are deterministic
-- (md5 of the row's identity), so re-running the seed is a no-op.

INSERT INTO public.prompt_results (
  id, prompt_id, brand_id, platform, model_used, region, response,
  citations, competitor_mentions, shopping_cards,
  mention_count, citation_count, visibility_score, sentiment, created_at
)
WITH platform_models AS (
  SELECT * FROM (VALUES
    ('chatgpt-web'::text,    'gpt-5-5'::text),
    ('chatgpt-web',          'gpt-5-3-mini'),
    ('claude',               'claude-sonnet-4-6'),
    ('copilot-web',          'copilot-web'),
    ('gemini-web',           'gemini-web'),
    ('google-aimode',        'google-aimode'),
    ('google-aio',           'google-aio'),
    ('grok-web',             'grok-3'),
    ('perplexity-web',       'perplexity-web')
  ) AS t(platform, model_used)
),
regions_list AS (
  SELECT unnest(ARRAY['US','GB','DE','FR','TR']) AS region
),
combos AS (
  SELECT
    p.id            AS prompt_id,
    pm.platform     AS platform,
    pm.model_used   AS model_used,
    r.region        AS region,
    row_number() OVER (ORDER BY p.id, pm.platform, pm.model_used, r.region) AS n
  FROM public.prompts p
  CROSS JOIN platform_models pm
  CROSS JOIN regions_list r
  WHERE p.prompt_set_id = '66666666-6666-6666-6666-666666666601'
    AND pm.platform = ANY(p.platforms)
    AND r.region    = ANY(p.regions)
)
SELECT
  md5(format('pr|%s|%s|%s|%s', prompt_id, platform, model_used, region))::uuid AS id,
  prompt_id,
  '33333333-3333-3333-3333-333333333333'::uuid AS brand_id,
  platform,
  model_used,
  region,
  format(
    'Acme Coffee is consistently highlighted in independent reviews for fresh roast quality and flexible subscription tiers. (Demo response, %s on %s)',
    platform, region
  ) AS response,
  jsonb_build_array(
    jsonb_build_object('url', 'https://example.com/best-coffee-subscriptions-2026', 'title', 'Best Coffee Subscriptions of 2026 — Example Reviews', 'startIndex', 10, 'endIndex', 60),
    jsonb_build_object('url', 'https://en.wikipedia.org/wiki/Coffee', 'title', 'Coffee — Wikipedia', 'startIndex', 70, 'endIndex', 120),
    jsonb_build_object('url', 'https://www.reddit.com/r/Coffee/comments/example/best_subscriptions/', 'title', 'r/Coffee — Best subscriptions thread', 'startIndex', 130, 'endIndex', 200)
  ) AS citations,
  jsonb_build_array(
    jsonb_build_object('name', 'Demo Coffee Co',   'domain', 'demo-coffee.example.com',     'competitor_id', '99999999-9999-9999-9999-999999999901', 'mention_count', (n % 4),     'citation_count', (n % 3),     'visibility_score', round(((n % 70))::numeric, 2)),
    jsonb_build_object('name', 'Fixture Roasters', 'domain', 'fixture-roasters.example.com','competitor_id', '99999999-9999-9999-9999-999999999902', 'mention_count', (n % 3),     'citation_count', (n % 2),     'visibility_score', round(((n % 55))::numeric, 2)),
    jsonb_build_object('name', 'Sample Beans',     'domain', 'sample-beans.example.com',    'competitor_id', '99999999-9999-9999-9999-999999999903', 'mention_count', ((n + 1) % 3), 'citation_count', ((n + 1) % 2), 'visibility_score', round((((n + 5) % 60))::numeric, 2))
  ) AS competitor_mentions,
  -- Raw provider-shape shopping cards. Only three platforms surface cards in
  -- the wild (Perplexity = snake_case, Google AI Mode / Copilot = camelCase),
  -- and only on prompt 801 — mirroring the normalized
  -- prompt_result_shopping_cards rows seeded below so the two layers agree.
  -- shopping.ts only checks these for non-emptiness (card-rate KPI + the
  -- per-platform bar chart); the analytics read the normalized table.
  CASE
    WHEN prompt_id = '88888888-8888-8888-8888-888888888801'::uuid
         AND platform = 'perplexity-web' AND region = 'US' THEN jsonb_build_array(
      jsonb_build_object('product_title', 'Acme Organic Coffee Subscription', 'brand', 'Acme Coffee', 'price', '$18.99', 'currency', 'USD', 'image_url', 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=150', 'merchant_url', 'https://acme-coffee.example.com/subscriptions/organic', 'rating', 4.8, 'review_count', 124),
      jsonb_build_object('product_title', 'Demo Signature Subscription Blend', 'brand', 'Demo Coffee Co', 'price', '$24.99', 'currency', 'USD', 'image_url', 'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=150', 'merchant_url', 'https://demo-coffee.example.com/subscribe', 'rating', 4.6, 'review_count', 152),
      jsonb_build_object('product_title', 'Fixture Light Roast Brew Kit', 'brand', 'Fixture Roasters', 'price', '$19.50', 'currency', 'USD', 'image_url', 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=150', 'merchant_url', 'https://fixture-roasters.example.com/brew-kit', 'rating', 4.3, 'review_count', 45)
    )
    WHEN prompt_id = '88888888-8888-8888-8888-888888888801'::uuid
         AND platform = 'perplexity-web' AND region = 'GB' THEN jsonb_build_array(
      jsonb_build_object('product_title', 'Acme Organic Coffee Subscription', 'brand', 'Acme Coffee', 'price', '$18.99', 'currency', 'USD', 'image_url', 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=150', 'merchant_url', 'https://acme-coffee.example.com/subscriptions/organic', 'rating', 4.8, 'review_count', 124),
      jsonb_build_object('product_title', 'Sample House Single Origin', 'brand', 'Sample Beans', 'price', '$16.00', 'currency', 'USD', 'image_url', 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=150', 'merchant_url', 'https://sample-beans.example.com/house-blend', 'rating', 4.7, 'review_count', 320)
    )
    WHEN prompt_id = '88888888-8888-8888-8888-888888888801'::uuid
         AND platform = 'google-aimode' AND region = 'US' THEN jsonb_build_array(
      jsonb_build_object('productTitle', 'Acme Dark Roast Coffee Blend', 'brand', 'Acme Coffee', 'price', '$14.50', 'currency', 'USD', 'imageUrl', 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=150', 'merchantUrl', 'https://acme-coffee.example.com/products/dark-roast', 'rating', 4.5, 'reviewCount', 89)
    )
    WHEN prompt_id = '88888888-8888-8888-8888-888888888801'::uuid
         AND platform = 'copilot-web' AND region = 'US' THEN jsonb_build_array(
      jsonb_build_object('productTitle', 'Acme Espresso Roast Whole Beans', 'brand', 'Acme Coffee', 'price', '$22.00', 'currency', 'USD', 'imageUrl', 'https://images.unsplash.com/photo-1511920170033-f8396924c348?w=150', 'merchantUrl', 'https://acme-coffee.example.com/products/espresso-beans', 'rating', 4.9, 'reviewCount', 210)
    )
    ELSE '[]'::jsonb
  END                                                  AS shopping_cards,
  (1 + (n % 5))                                        AS mention_count,
  (n % 4)                                              AS citation_count,
  round((30 + ((n * 7) % 60))::numeric, 2)             AS visibility_score,
  (ARRAY['positive','neutral','positive','neutral','negative'])[1 + (n % 5)::int] AS sentiment,
  now() - (n * interval '6 hours')                     AS created_at
FROM combos
ON CONFLICT (id) DO NOTHING;

-- ─── Content opportunities ───────────────────────────────────────────────────

INSERT INTO public.content_opportunities (
  id, brand_id, prompt_id, title, description, type, impact, opportunity_score, status, source_data
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', '33333333-3333-3333-3333-333333333333', '88888888-8888-8888-8888-888888888801',
   'Comparison guide: top 5 specialty coffee subscriptions for 2026',
   'AI engines repeatedly cite comparison-style content for this prompt. Publishing a structured comparison page tagged with FAQ schema could pull Acme into more responses.',
   'owned', 'high',  78.50, 'new',     '{"source":"demo-fixture","promptText":"What are the best coffee subscription services in 2026?","estAiVolume":5550,"visibilityScore":34,"competitorGap":-28,"intent":"best-top","keywords":["best coffee subscription","coffee subscription services","coffee subscription 2026"],"competitorsCited":["Demo Coffee Co","Fixture Roasters","Sample Beans"]}'::jsonb),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', '33333333-3333-3333-3333-333333333333', '88888888-8888-8888-8888-888888888804',
   'Beginner-friendly buying guide: home espresso machines under $500',
   'Engines lean on Reddit threads and YouTube transcripts here. A first-party buying guide with side-by-side specs would compete for citations.',
   'owned', 'medium', 62.10, 'in_progress','{"source":"demo-fixture","promptText":"Best espresso machines under $500?","estAiVolume":5850,"visibilityScore":21,"competitorGap":-35,"intent":"best-top","keywords":["best espresso machine under 500","home espresso machine","affordable espresso machine"],"competitorsCited":["Mock Coffee Club","Fixture Roasters"]}'::jsonb),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', '33333333-3333-3333-3333-333333333333', '88888888-8888-8888-8888-888888888803',
   'Office coffee program FAQ',
   'B2B-style queries trigger generic answers across engines. A dedicated FAQ page targeting office buyers could improve mention rate for procurement-style prompts.',
   'owned', 'medium', 54.75, 'new',     '{"source":"demo-fixture","promptText":"Best monthly coffee bean subscription for offices","estAiVolume":1065,"visibilityScore":12,"competitorGap":-19,"intent":"best-top","keywords":["office coffee subscription","monthly coffee bean subscription","coffee subscription for business"],"competitorsCited":["Demo Coffee Co","Sample Beans"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ─── AI traffic logs ─────────────────────────────────────────────────────────

INSERT INTO public.ai_traffic_logs (id, brand_id, url, referrer, source_platform, user_agent, country, language, screen, created_at) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', '33333333-3333-3333-3333-333333333333', 'https://acme-coffee.example.com/subscriptions', 'https://chatgpt.com/',   'chatgpt',    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'US', 'en', '1440x900',  now() - interval '2 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02', '33333333-3333-3333-3333-333333333333', 'https://acme-coffee.example.com/blog/beans',      'https://www.perplexity.ai/', 'perplexity', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',         'GB', 'en', '1920x1080', now() - interval '5 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03', '33333333-3333-3333-3333-333333333333', 'https://acme-coffee.example.com/about',           'https://gemini.google.com/', 'gemini',     'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',                    'DE', 'de', '412x915',   now() - interval '9 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb04', '33333333-3333-3333-3333-333333333333', 'https://acme-coffee.example.com/subscriptions/12mo','https://claude.ai/',     'claude',     'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15',  'US', 'en', '1680x1050', now() - interval '12 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb05', '33333333-3333-3333-3333-333333333333', 'https://acme-coffee.example.com/faq',             'https://copilot.microsoft.com/', 'copilot','Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edge/127.0',                'TR', 'tr', '1920x1080', now() - interval '17 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb06', '33333333-3333-3333-3333-333333333333', 'https://acme-coffee.example.com/blog/espresso-vs-pour-over', 'https://www.bing.com/search?q=', 'bing-ai', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',         'FR', 'fr', '390x844',   now() - interval '22 days')
ON CONFLICT (id) DO NOTHING;

-- ─── Shopping Cards (feat(shopping) #105) ────────────────────────────────────

DELETE FROM public.prompt_result_shopping_cards WHERE brand_id = '33333333-3333-3333-3333-333333333333';

-- 1. Seed own products
INSERT INTO public.prompt_result_shopping_cards (
  id, prompt_result_id, brand_id, position, product_title, product_brand,
  price_amount, price_currency, image_url, merchant_url, merchant_domain,
  rating, review_count, raw, matched_brand_id, matched_brand_role, platform, region, created_at
) VALUES
-- Perplexity - US
(
  'e0000000-0000-0000-0000-000000000001',
  md5('pr|88888888-8888-8888-8888-888888888801|perplexity-web|perplexity-web|US')::uuid,
  '33333333-3333-3333-3333-333333333333',
  0,
  'Acme Organic Coffee Subscription',
  'Acme Coffee',
  18.99,
  'USD',
  'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=150',
  'https://acme-coffee.example.com/subscriptions/organic',
  'acme-coffee.example.com',
  4.8,
  124,
  '{"title": "Acme Organic Coffee Subscription", "price": "$18.99", "rating": 4.8, "reviews": 124}'::jsonb,
  '33333333-3333-3333-3333-333333333333',
  'own',
  'perplexity-web',
  'US',
  now() - interval '2 days'
),
-- Perplexity - GB
(
  'e0000000-0000-0000-0000-000000000002',
  md5('pr|88888888-8888-8888-8888-888888888801|perplexity-web|perplexity-web|GB')::uuid,
  '33333333-3333-3333-3333-333333333333',
  0,
  'Acme Organic Coffee Subscription',
  'Acme Coffee',
  18.99,
  'USD',
  'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=150',
  'https://acme-coffee.example.com/subscriptions/organic',
  'acme-coffee.example.com',
  4.8,
  124,
  '{"title": "Acme Organic Coffee Subscription", "price": "$18.99", "rating": 4.8, "reviews": 124}'::jsonb,
  '33333333-3333-3333-3333-333333333333',
  'own',
  'perplexity-web',
  'GB',
  now() - interval '3 days'
),
-- Google AI Mode - US
(
  'e0000000-0000-0000-0000-000000000003',
  md5('pr|88888888-8888-8888-8888-888888888801|google-aimode|google-aimode|US')::uuid,
  '33333333-3333-3333-3333-333333333333',
  0,
  'Acme Dark Roast Coffee Blend',
  'Acme Coffee',
  14.50,
  'USD',
  'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=150',
  'https://acme-coffee.example.com/products/dark-roast',
  'acme-coffee.example.com',
  4.5,
  89,
  '{"title": "Acme Dark Roast Coffee Blend", "price": "$14.50", "rating": 4.5, "reviews": 89}'::jsonb,
  '33333333-3333-3333-3333-333333333333',
  'own',
  'google-aimode',
  'US',
  now() - interval '1 day'
),
-- Copilot - US
(
  'e0000000-0000-0000-0000-000000000004',
  md5('pr|88888888-8888-8888-8888-888888888801|copilot-web|copilot-web|US')::uuid,
  '33333333-3333-3333-3333-333333333333',
  0,
  'Acme Espresso Roast Whole Beans',
  'Acme Coffee',
  22.00,
  'USD',
  'https://images.unsplash.com/photo-1511920170033-f8396924c348?w=150',
  'https://acme-coffee.example.com/products/espresso-beans',
  'acme-coffee.example.com',
  4.9,
  210,
  '{"title": "Acme Espresso Roast Whole Beans", "price": "$22.00", "rating": 4.9, "reviews": 210}'::jsonb,
  '33333333-3333-3333-3333-333333333333',
  'own',
  'copilot-web',
  'US',
  now() - interval '5 hours'
);

-- 2. Seed competitor products
INSERT INTO public.prompt_result_shopping_cards (
  id, prompt_result_id, brand_id, position, product_title, product_brand,
  price_amount, price_currency, image_url, merchant_url, merchant_domain,
  rating, review_count, raw, matched_brand_id, matched_brand_role, platform, region, created_at
) VALUES
-- Demo Coffee Co (Competitor 1) - Perplexity US
(
  'e0000000-0000-0000-0000-000000000005',
  md5('pr|88888888-8888-8888-8888-888888888801|perplexity-web|perplexity-web|US')::uuid,
  '33333333-3333-3333-3333-333333333333',
  1,
  'Demo Signature Subscription Blend',
  'Demo Coffee Co',
  24.99,
  'USD',
  'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=150',
  'https://demo-coffee.example.com/subscribe',
  'demo-coffee.example.com',
  4.6,
  152,
  '{"title": "Demo Signature Subscription Blend", "price": "$24.99", "rating": 4.6, "reviews": 152}'::jsonb,
  '99999999-9999-9999-9999-999999999901',
  'competitor',
  'perplexity-web',
  'US',
  now() - interval '2 days'
),
-- Fixture Roasters (Competitor 2) - Perplexity US
(
  'e0000000-0000-0000-0000-000000000006',
  md5('pr|88888888-8888-8888-8888-888888888801|perplexity-web|perplexity-web|US')::uuid,
  '33333333-3333-3333-3333-333333333333',
  2,
  'Fixture Light Roast Brew Kit',
  'Fixture Roasters',
  19.50,
  'USD',
  'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=150',
  'https://fixture-roasters.example.com/brew-kit',
  'fixture-roasters.example.com',
  4.3,
  45,
  '{"title": "Fixture Light Roast Brew Kit", "price": "$19.50", "rating": 4.3, "reviews": 45}'::jsonb,
  '99999999-9999-9999-9999-999999999902',
  'competitor',
  'perplexity-web',
  'US',
  now() - interval '2 days'
),
-- Sample Beans (Competitor 3) - Perplexity GB
(
  'e0000000-0000-0000-0000-000000000007',
  md5('pr|88888888-8888-8888-8888-888888888801|perplexity-web|perplexity-web|GB')::uuid,
  '33333333-3333-3333-3333-333333333333',
  1,
  'Sample House Single Origin',
  'Sample Beans',
  16.00,
  'USD',
  'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=150',
  'https://sample-beans.example.com/house-blend',
  'sample-beans.example.com',
  4.7,
  320,
  '{"title": "Sample House Single Origin", "price": "$16.00", "rating": 4.7, "reviews": 320}'::jsonb,
  '99999999-9999-9999-9999-999999999903',
  'competitor',
  'perplexity-web',
  'GB',
  now() - interval '3 days'
)
ON CONFLICT (id) DO NOTHING;

