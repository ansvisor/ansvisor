-- GSC-fed prompt suggestions (#648).
--
-- 1. prompt_suggestions.source_data — provenance for 'gsc'-sourced rows
--    (original query, impressions, clicks, rationale badge, competition).
-- 2. gsc_candidate_queries() — server-side aggregation of the candidate
--    mining window so the app never ships tens of thousands of daily rows
--    over the wire just to group them.
-- 3. dataforseo_competition_cache — 30-day cache for competition lookups so
--    repeat suggestion refreshes cost zero new DataForSEO calls. Service
--    role only (RLS enabled, no policies).

ALTER TABLE public.prompt_suggestions ADD COLUMN source_data jsonb;

-- The live table's source check predates 'gsc' — extend it.
ALTER TABLE public.prompt_suggestions DROP CONSTRAINT prompt_suggestions_source_check;
ALTER TABLE public.prompt_suggestions ADD CONSTRAINT prompt_suggestions_source_check
    CHECK (source = ANY (ARRAY['llm'::text, 'heuristic'::text, 'gsc'::text]));

CREATE FUNCTION public.gsc_candidate_queries(
    p_brand_id uuid,
    p_since date,
    p_min_impressions integer
)
RETURNS TABLE(query text, impressions bigint, clicks bigint, avg_position double precision)
LANGUAGE sql
STABLE
AS $$
    SELECT s.query,
           sum(s.impressions) AS impressions,
           sum(s.clicks) AS clicks,
           avg(s.position) AS avg_position
    FROM public.gsc_query_stats s
    WHERE s.brand_id = p_brand_id
      AND s.date >= p_since
    GROUP BY s.query
    HAVING sum(s.impressions) >= p_min_impressions
    ORDER BY sum(s.impressions) DESC
    LIMIT 200;
$$;

CREATE TABLE public.dataforseo_competition_cache (
    keyword text NOT NULL,
    location_code integer NOT NULL DEFAULT 0,
    language_code text NOT NULL DEFAULT '',
    competition_index integer,
    competition text,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (keyword, location_code, language_code)
);

ALTER TABLE public.dataforseo_competition_cache ENABLE ROW LEVEL SECURITY;
