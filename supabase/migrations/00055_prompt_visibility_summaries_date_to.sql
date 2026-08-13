-- prompt_visibility_summaries gains an upper bound (#713).
--
-- The Prompts page previously offered only whole-window presets (7/30/90
-- days), so a start date was the entire filter. Matching the date range
-- control the other surfaces use means supporting a custom from/to range,
-- which needs an end bound the function never had.
--
-- Dropped and recreated rather than overloaded: an added parameter with a
-- default makes the two-argument call ambiguous, and Postgres rejects it as
-- "function is not unique". Migrations 00034 and 00040 replaced this same
-- function the same way.
--
-- Both bounds stay optional and NULL keeps meaning "unbounded on that side",
-- so every existing caller behaves exactly as before.
--
-- Both signatures are dropped conditionally rather than the two-argument one
-- unconditionally: the hosted database already carries a three-argument
-- version that no migration in this repo produced, so a plain DROP of the
-- two-argument form fails there while succeeding on a fresh install. This
-- also makes the file the single definition of the function again — the
-- drift is what it exists to close.

DROP FUNCTION IF EXISTS public.prompt_visibility_summaries(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.prompt_visibility_summaries(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to   timestamptz DEFAULT NULL
)
RETURNS TABLE (
  prompt_id              uuid,
  avg_visibility         double precision,
  avg_visibility_visible double precision,
  total_mentions         bigint,
  total_citations        bigint,
  runs                   bigint,
  visible_runs           bigint,
  mention_answers        bigint,
  citation_answers       bigint,
  position_factor        double precision,
  last_run_at            timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT pr.prompt_id,
         AVG(COALESCE(pr.visibility_score, 0))::double precision AS avg_visibility,
         AVG(COALESCE(pr.visibility_score, 0))
           FILTER (WHERE pr.mention_count > 0 OR pr.citation_count > 0)
           ::double precision                                    AS avg_visibility_visible,
         COALESCE(SUM(pr.mention_count), 0)::bigint              AS total_mentions,
         COALESCE(SUM(pr.citation_count), 0)::bigint             AS total_citations,
         COUNT(*)::bigint                                        AS runs,
         COUNT(*) FILTER (WHERE pr.mention_count > 0 OR pr.citation_count > 0)::bigint
                                                                 AS visible_runs,
         COUNT(*) FILTER (WHERE pr.mention_count > 0)::bigint    AS mention_answers,
         COUNT(*) FILTER (WHERE pr.citation_count > 0)::bigint   AS citation_answers,
         AVG(1.0 / pr.mention_position)
           FILTER (WHERE pr.mention_position IS NOT NULL)
           ::double precision                                    AS position_factor,
         MAX(pr.created_at)                                      AS last_run_at
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND pr.prompt_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 - isolate from analytics
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
    AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
  GROUP BY pr.prompt_id
$$;

GRANT EXECUTE ON FUNCTION public.prompt_visibility_summaries(uuid, timestamptz, timestamptz)
  TO authenticated;
