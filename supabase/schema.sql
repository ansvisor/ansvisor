-- ============================================================================
-- ansvisor — consolidated database schema
--
-- GENERATED FILE — do not edit by hand. This is every migration in
-- supabase/migrations/ concatenated in order, so a fresh install can be
-- created by pasting this one file into the Supabase SQL Editor.
--
-- It is NOT the migration history: existing installs upgrade by applying new
-- numbered migrations (or `supabase db push`).
--
-- Regenerate after adding a migration:  bash supabase/build-schema.sh
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00001_initial_schema.sql
-- ─────────────────────────────────────────────────────────────────────────



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';


CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";


CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";


CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";


CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


CREATE TYPE "public"."user_role" AS ENUM (
    'admin',
    'manager',
    'analyst',
    'agency_partner'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."prompt_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "response" "text" DEFAULT ''::"text" NOT NULL,
    "citations" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "mention_count" integer DEFAULT 0 NOT NULL,
    "citation_count" integer DEFAULT 0 NOT NULL,
    "sentiment" "text" DEFAULT 'neutral'::"text" NOT NULL,
    "visibility_score" numeric DEFAULT 0 NOT NULL,
    "model_used" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "region" "text",
    "competitor_mentions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


ALTER TABLE "public"."prompt_results" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."prompt_results"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT DISTINCT ON (pr.prompt_id, pr.platform) pr.*
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND (p_platform IS NULL OR pr.platform = p_platform)
  ORDER BY pr.prompt_id, pr.platform, pr.created_at DESC;
$$;


ALTER FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text" DEFAULT NULL::"text", "p_model" "text" DEFAULT NULL::"text", "p_region" "text" DEFAULT NULL::"text", "p_date_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_date_to" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS SETOF "public"."prompt_results"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT DISTINCT ON (pr.prompt_id, pr.platform, pr.model_used, pr.region) pr.*
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND (p_platform IS NULL OR pr.platform = p_platform)
    AND (p_model IS NULL OR pr.model_used = p_model)
    AND (p_region IS NULL OR pr.region = p_region)
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
    AND (p_date_to IS NULL OR pr.created_at <= p_date_to)
  ORDER BY pr.prompt_id, pr.platform, pr.model_used, pr.region, pr.created_at DESC;
$$;


ALTER FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text", "p_model" "text", "p_region" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_traffic_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "referrer" "text",
    "source_platform" "text",
    "user_agent" "text",
    "ip_address" "text",
    "country" "text",
    "language" "text",
    "screen" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_traffic_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brand_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "domain" "text" NOT NULL,
    "country" "text",
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brand_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brand_platforms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "check_frequency" "text" DEFAULT 'daily'::"text" NOT NULL,
    "last_checked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "api_model" "text"
);


ALTER TABLE "public"."brand_platforms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "logo_url" "text",
    "industry" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tracking_code" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(16), 'hex'::"text") NOT NULL,
    "region" "text" DEFAULT 'US'::"text",
    "language" "text" DEFAULT 'en'::"text"
);


ALTER TABLE "public"."brands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competitors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "domain" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."competitors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_opportunities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "prompt_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "type" "text" DEFAULT 'owned'::"text" NOT NULL,
    "impact" "text" DEFAULT 'medium'::"text" NOT NULL,
    "opportunity_score" numeric(5,2) DEFAULT 0,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "source_data" "jsonb" DEFAULT '{}'::"jsonb",
    "webhook_sent_at" timestamp with time zone,
    "webhook_response" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "brief" "jsonb"
);


ALTER TABLE "public"."content_opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "progress" "jsonb",
    "result" "jsonb",
    "failed_reason" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "jobs_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'active'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "jobs_type_check" CHECK (("type" = ANY (ARRAY['tracking'::"text", 'content'::"text"])))
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "subscription_status" "text" DEFAULT 'incomplete'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "subscription_ends_at" timestamp with time zone,
    "stripe_subscription_id" "text",
    "plan_overrides" "jsonb"
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "role" "public"."user_role" DEFAULT 'admin'::"public"."user_role" NOT NULL,
    "organization_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "onboarding_completed" boolean DEFAULT false
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompt_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."prompt_sets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompt_volumes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_id" "uuid" NOT NULL,
    "intent" "text" NOT NULL,
    "keywords" "jsonb" NOT NULL,
    "google_volumes" "jsonb" NOT NULL,
    "total_google_volume" integer NOT NULL,
    "ai_volume_multiplier" numeric(4,3) NOT NULL,
    "est_ai_volume" integer NOT NULL,
    "location_code" integer,
    "language_code" "text",
    "fetched_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."prompt_volumes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_set_id" "uuid" NOT NULL,
    "text" "text" NOT NULL,
    "category" "text",
    "platforms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "regions" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "models" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "topic_id" "uuid"
);


ALTER TABLE "public"."prompts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."topics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."volume_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "action" "text" NOT NULL,
    "prompt_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."volume_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" DEFAULT 'Default'::"text" NOT NULL,
    "webhook_url" "text" NOT NULL,
    "webhook_secret" "text",
    "events" "text"[] DEFAULT '{opportunity.sent}'::"text"[],
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."webhook_configs" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_traffic_logs"
    ADD CONSTRAINT "ai_traffic_logs_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."brand_domains"
    ADD CONSTRAINT "brand_domains_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."brand_platforms"
    ADD CONSTRAINT "brand_platforms_brand_id_platform_key" UNIQUE ("brand_id", "platform");


ALTER TABLE ONLY "public"."brand_platforms"
    ADD CONSTRAINT "brand_platforms_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_organization_id_slug_key" UNIQUE ("organization_id", "slug");


ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_tracking_code_key" UNIQUE ("tracking_code");


ALTER TABLE ONLY "public"."competitors"
    ADD CONSTRAINT "competitors_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."content_opportunities"
    ADD CONSTRAINT "content_opportunities_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");


ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."prompt_results"
    ADD CONSTRAINT "prompt_results_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."prompt_sets"
    ADD CONSTRAINT "prompt_sets_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."prompt_volumes"
    ADD CONSTRAINT "prompt_volumes_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."prompts"
    ADD CONSTRAINT "prompts_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."topics"
    ADD CONSTRAINT "topics_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."prompt_volumes"
    ADD CONSTRAINT "uq_prompt_volumes_prompt_id" UNIQUE ("prompt_id");


ALTER TABLE ONLY "public"."volume_usage"
    ADD CONSTRAINT "volume_usage_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."webhook_configs"
    ADD CONSTRAINT "webhook_configs_brand_id_name_key" UNIQUE ("brand_id", "name");


ALTER TABLE ONLY "public"."webhook_configs"
    ADD CONSTRAINT "webhook_configs_pkey" PRIMARY KEY ("id");


CREATE INDEX "idx_ai_traffic_logs_brand_created" ON "public"."ai_traffic_logs" USING "btree" ("brand_id", "created_at" DESC);


CREATE INDEX "idx_ai_traffic_logs_brand_id" ON "public"."ai_traffic_logs" USING "btree" ("brand_id");


CREATE INDEX "idx_ai_traffic_logs_created_at" ON "public"."ai_traffic_logs" USING "btree" ("created_at" DESC);


CREATE INDEX "idx_ai_traffic_logs_source_platform" ON "public"."ai_traffic_logs" USING "btree" ("source_platform");


CREATE INDEX "idx_brand_domains_brand_id" ON "public"."brand_domains" USING "btree" ("brand_id");


CREATE INDEX "idx_brand_platforms_brand_id" ON "public"."brand_platforms" USING "btree" ("brand_id");


CREATE INDEX "idx_brands_organization_id" ON "public"."brands" USING "btree" ("organization_id");


CREATE INDEX "idx_brands_tracking_code" ON "public"."brands" USING "btree" ("tracking_code");


CREATE INDEX "idx_co_brand_id" ON "public"."content_opportunities" USING "btree" ("brand_id");


CREATE INDEX "idx_co_score" ON "public"."content_opportunities" USING "btree" ("opportunity_score" DESC);


CREATE INDEX "idx_co_status" ON "public"."content_opportunities" USING "btree" ("status");


CREATE INDEX "idx_competitors_brand_id" ON "public"."competitors" USING "btree" ("brand_id");


CREATE INDEX "idx_jobs_brand_id" ON "public"."jobs" USING "btree" ("brand_id");


CREATE INDEX "idx_jobs_status" ON "public"."jobs" USING "btree" ("status");


CREATE INDEX "idx_jobs_type_status" ON "public"."jobs" USING "btree" ("type", "status");


CREATE INDEX "idx_profiles_organization_id" ON "public"."profiles" USING "btree" ("organization_id");


CREATE INDEX "idx_prompt_results_brand_id" ON "public"."prompt_results" USING "btree" ("brand_id");


CREATE INDEX "idx_prompt_results_created_at" ON "public"."prompt_results" USING "btree" ("created_at" DESC);


CREATE INDEX "idx_prompt_results_prompt_id" ON "public"."prompt_results" USING "btree" ("prompt_id");


CREATE INDEX "idx_prompt_volumes_est_ai_volume" ON "public"."prompt_volumes" USING "btree" ("est_ai_volume" DESC);


CREATE INDEX "idx_prompt_volumes_prompt_id" ON "public"."prompt_volumes" USING "btree" ("prompt_id");


CREATE INDEX "idx_prompts_topic" ON "public"."prompts" USING "btree" ("topic_id");


CREATE INDEX "idx_topics_brand" ON "public"."topics" USING "btree" ("brand_id");


CREATE INDEX "idx_volume_usage_org_month" ON "public"."volume_usage" USING "btree" ("organization_id", "used_at");


CREATE INDEX "idx_wc_brand_id" ON "public"."webhook_configs" USING "btree" ("brand_id");


CREATE OR REPLACE TRIGGER "handle_prompt_sets_updated_at" BEFORE UPDATE ON "public"."prompt_sets" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();


CREATE OR REPLACE TRIGGER "trg_brands_updated_at" BEFORE UPDATE ON "public"."brands" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();


CREATE OR REPLACE TRIGGER "trg_organizations_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();


CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();


ALTER TABLE ONLY "public"."ai_traffic_logs"
    ADD CONSTRAINT "ai_traffic_logs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."brand_domains"
    ADD CONSTRAINT "brand_domains_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."brand_platforms"
    ADD CONSTRAINT "brand_platforms_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."competitors"
    ADD CONSTRAINT "competitors_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."content_opportunities"
    ADD CONSTRAINT "content_opportunities_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."content_opportunities"
    ADD CONSTRAINT "content_opportunities_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."prompt_results"
    ADD CONSTRAINT "prompt_results_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."prompt_results"
    ADD CONSTRAINT "prompt_results_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."prompt_sets"
    ADD CONSTRAINT "prompt_sets_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."prompt_volumes"
    ADD CONSTRAINT "prompt_volumes_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."prompts"
    ADD CONSTRAINT "prompts_prompt_set_id_fkey" FOREIGN KEY ("prompt_set_id") REFERENCES "public"."prompt_sets"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."prompts"
    ADD CONSTRAINT "prompts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."topics"
    ADD CONSTRAINT "topics_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."volume_usage"
    ADD CONSTRAINT "volume_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."webhook_configs"
    ADD CONSTRAINT "webhook_configs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


CREATE POLICY "Service role can delete prompt results" ON "public"."prompt_results" FOR DELETE USING (true);


CREATE POLICY "Service role can insert prompt results" ON "public"."prompt_results" FOR INSERT WITH CHECK (true);


CREATE POLICY "Service role can insert traffic logs" ON "public"."ai_traffic_logs" FOR INSERT WITH CHECK (true);


CREATE POLICY "Users can delete brand platforms through org" ON "public"."brand_platforms" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("b"."id" = "brand_platforms"."brand_id") AND ("p"."id" = "auth"."uid"())))));


CREATE POLICY "Users can insert brand platforms through org" ON "public"."brand_platforms" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("b"."id" = "brand_platforms"."brand_id") AND ("p"."id" = "auth"."uid"())))));


CREATE POLICY "Users can read own org prompt results" ON "public"."prompt_results" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


CREATE POLICY "Users can update brand platforms through org" ON "public"."brand_platforms" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("b"."id" = "brand_platforms"."brand_id") AND ("p"."id" = "auth"."uid"())))));


CREATE POLICY "Users can view brand platforms through org" ON "public"."brand_platforms" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("b"."id" = "brand_platforms"."brand_id") AND ("p"."id" = "auth"."uid"())))));


CREATE POLICY "Users can view own org traffic logs" ON "public"."ai_traffic_logs" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


CREATE POLICY "Users cannot update plan fields directly" ON "public"."organizations" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."organization_id" = "organizations"."id") AND ("profiles"."id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."organization_id" = "organizations"."id") AND ("profiles"."id" = "auth"."uid"())))));


ALTER TABLE "public"."ai_traffic_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brand_domains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brand_domains: admin/manager delete" ON "public"."brand_domains" FOR DELETE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "brand_domains: admin/manager insert" ON "public"."brand_domains" FOR INSERT WITH CHECK (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "brand_domains: admin/manager update" ON "public"."brand_domains" FOR UPDATE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "brand_domains: member select" ON "public"."brand_domains" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


ALTER TABLE "public"."brand_platforms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brands" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brands: admin delete" ON "public"."brands" FOR DELETE USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"public"."user_role")))));


CREATE POLICY "brands: admin/manager insert" ON "public"."brands" FOR INSERT WITH CHECK (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "brands: admin/manager update" ON "public"."brands" FOR UPDATE USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "brands: member select" ON "public"."brands" FOR SELECT USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));


ALTER TABLE "public"."content_opportunities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_opportunities: admin/manager delete" ON "public"."content_opportunities" FOR DELETE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "content_opportunities: admin/manager insert" ON "public"."content_opportunities" FOR INSERT WITH CHECK (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "content_opportunities: admin/manager update" ON "public"."content_opportunities" FOR UPDATE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "content_opportunities: member select" ON "public"."content_opportunities" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations: admin update" ON "public"."organizations" FOR UPDATE USING (("id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"public"."user_role")))));


CREATE POLICY "organizations: authenticated insert" ON "public"."organizations" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));


CREATE POLICY "organizations: member or creator select" ON "public"."organizations" FOR SELECT USING ((("id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE ("profiles"."organization_id" = "organizations"."id"))))));


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles: own row select" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));


CREATE POLICY "profiles: own row update" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));


ALTER TABLE "public"."prompt_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prompt_sets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prompt_sets: admin/manager delete" ON "public"."prompt_sets" FOR DELETE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompt_sets: admin/manager insert" ON "public"."prompt_sets" FOR INSERT WITH CHECK (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompt_sets: admin/manager update" ON "public"."prompt_sets" FOR UPDATE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompt_sets: member select" ON "public"."prompt_sets" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


ALTER TABLE "public"."prompts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prompts: admin/manager delete" ON "public"."prompts" FOR DELETE USING (("prompt_set_id" IN ( SELECT "ps"."id"
   FROM (("public"."prompt_sets" "ps"
     JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompts: admin/manager insert" ON "public"."prompts" FOR INSERT WITH CHECK (("prompt_set_id" IN ( SELECT "ps"."id"
   FROM (("public"."prompt_sets" "ps"
     JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompts: admin/manager update" ON "public"."prompts" FOR UPDATE USING (("prompt_set_id" IN ( SELECT "ps"."id"
   FROM (("public"."prompt_sets" "ps"
     JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompts: member select" ON "public"."prompts" FOR SELECT USING (("prompt_set_id" IN ( SELECT "ps"."id"
   FROM (("public"."prompt_sets" "ps"
     JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


ALTER TABLE "public"."volume_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_configs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "webhook_configs: admin/manager delete" ON "public"."webhook_configs" FOR DELETE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "webhook_configs: admin/manager insert" ON "public"."webhook_configs" FOR INSERT WITH CHECK (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "webhook_configs: admin/manager update" ON "public"."webhook_configs" FOR UPDATE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "webhook_configs: member select" ON "public"."webhook_configs" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


GRANT ALL ON TABLE "public"."prompt_results" TO "anon";
GRANT ALL ON TABLE "public"."prompt_results" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_results" TO "service_role";


GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text") TO "service_role";


GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text", "p_model" "text", "p_region" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text", "p_model" "text", "p_region" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text", "p_model" "text", "p_region" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "service_role";


GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";


GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";


GRANT ALL ON TABLE "public"."ai_traffic_logs" TO "anon";
GRANT ALL ON TABLE "public"."ai_traffic_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_traffic_logs" TO "service_role";


GRANT ALL ON TABLE "public"."brand_domains" TO "anon";
GRANT ALL ON TABLE "public"."brand_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_domains" TO "service_role";


GRANT ALL ON TABLE "public"."brand_platforms" TO "anon";
GRANT ALL ON TABLE "public"."brand_platforms" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_platforms" TO "service_role";


GRANT ALL ON TABLE "public"."brands" TO "anon";
GRANT ALL ON TABLE "public"."brands" TO "authenticated";
GRANT ALL ON TABLE "public"."brands" TO "service_role";


GRANT ALL ON TABLE "public"."competitors" TO "anon";
GRANT ALL ON TABLE "public"."competitors" TO "authenticated";
GRANT ALL ON TABLE "public"."competitors" TO "service_role";


GRANT ALL ON TABLE "public"."content_opportunities" TO "anon";
GRANT ALL ON TABLE "public"."content_opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."content_opportunities" TO "service_role";


GRANT ALL ON TABLE "public"."jobs" TO "anon";
GRANT ALL ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";


GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";


GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";


GRANT ALL ON TABLE "public"."prompt_sets" TO "anon";
GRANT ALL ON TABLE "public"."prompt_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_sets" TO "service_role";


GRANT ALL ON TABLE "public"."prompt_volumes" TO "anon";
GRANT ALL ON TABLE "public"."prompt_volumes" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_volumes" TO "service_role";


GRANT ALL ON TABLE "public"."prompts" TO "anon";
GRANT ALL ON TABLE "public"."prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."prompts" TO "service_role";


GRANT ALL ON TABLE "public"."topics" TO "anon";
GRANT ALL ON TABLE "public"."topics" TO "authenticated";
GRANT ALL ON TABLE "public"."topics" TO "service_role";


GRANT ALL ON TABLE "public"."volume_usage" TO "anon";
GRANT ALL ON TABLE "public"."volume_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."volume_usage" TO "service_role";


GRANT ALL ON TABLE "public"."webhook_configs" TO "anon";
GRANT ALL ON TABLE "public"."webhook_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_configs" TO "service_role";


ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();



-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00002_team_invitations.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Team invitations
-- Adds invitation flow so organization admins can invite teammates via email.

CREATE TYPE "public"."invitation_status" AS ENUM (
    'pending',
    'accepted',
    'expired',
    'revoked'
);

ALTER TYPE "public"."invitation_status" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "organization_id" uuid NOT NULL,
    "email" text NOT NULL,
    "role" public.user_role NOT NULL DEFAULT 'analyst',
    "token" text NOT NULL,
    "invited_by" uuid NOT NULL,
    "status" public.invitation_status NOT NULL DEFAULT 'pending',
    "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    "accepted_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."invitations" OWNER TO "postgres";

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_token_key" UNIQUE ("token");

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_by_fkey"
    FOREIGN KEY ("invited_by")
    REFERENCES "auth"."users"("id") ON DELETE CASCADE;

-- Prevent duplicate pending invitations for the same org+email combo.
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_org_email_pending_idx"
    ON "public"."invitations" ("organization_id", lower("email"))
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS "idx_invitations_organization_id"
    ON "public"."invitations" USING btree ("organization_id");

CREATE INDEX IF NOT EXISTS "idx_invitations_email"
    ON "public"."invitations" USING btree (lower("email"));

CREATE INDEX IF NOT EXISTS "idx_invitations_token"
    ON "public"."invitations" USING btree ("token");

-- RLS
ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;

-- Members of an org can read invitations for that org.
CREATE POLICY "Members can view org invitations"
    ON "public"."invitations" FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

-- Admins of an org can manage (insert/update/delete) invitations.
CREATE POLICY "Admins can insert invitations"
    ON "public"."invitations" FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can update invitations"
    ON "public"."invitations" FOR UPDATE
    USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can delete invitations"
    ON "public"."invitations" FOR DELETE
    USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00003_api_keys.sql
-- ─────────────────────────────────────────────────────────────────────────
-- API keys
-- Long-lived bearer tokens that let external clients (MCP server, scripts,
-- third-party integrations) authenticate against the Ansvisor API on behalf
-- of a user without holding a Supabase session.
--
-- The plaintext token is shown to the user exactly once at creation time.
-- The server stores only `key_hash` (sha256 of the full token) and `prefix`
-- (first 12 chars, used for identification in the UI / logs).

CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "name" text NOT NULL,
    "prefix" text NOT NULL,
    "key_hash" text NOT NULL,
    "last_used_at" timestamptz,
    "revoked_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."api_keys" OWNER TO "postgres";

ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_key_hash_key" UNIQUE ("key_hash");

CREATE INDEX IF NOT EXISTS "idx_api_keys_user_id"
    ON "public"."api_keys" USING btree ("user_id");

CREATE INDEX IF NOT EXISTS "idx_api_keys_key_hash"
    ON "public"."api_keys" USING btree ("key_hash");

-- RLS
ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own api keys"
    ON "public"."api_keys" FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own api keys"
    ON "public"."api_keys" FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can revoke their own api keys"
    ON "public"."api_keys" FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own api keys"
    ON "public"."api_keys" FOR DELETE
    USING (user_id = auth.uid());

GRANT ALL ON TABLE "public"."api_keys" TO "anon";
GRANT ALL ON TABLE "public"."api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."api_keys" TO "service_role";

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00004_prompt_competition.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Capture DataForSEO competition data alongside search volume so the prompts
-- table can show a difficulty meter without an extra API call. This is Google
-- Ads paid-bid competition (a proxy for topic difficulty), pulled from the same
-- search_volume response we already fetch. No RLS changes: prompt_volumes
-- inherits the existing brand-scoped policies.

ALTER TABLE "public"."prompt_volumes"
  ADD COLUMN IF NOT EXISTS "competition_index" integer,
  ADD COLUMN IF NOT EXISTS "competition" text
    CHECK ("competition" IS NULL OR "competition" IN ('LOW', 'MEDIUM', 'HIGH'));

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00005_prompt_results_shopping_cards.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Capture Perplexity shopping cards alongside text + citations so the
-- commerce-intent signal isn't lost. Other AI providers leave this empty;
-- only Perplexity populates it today. Mirrors the citations /
-- competitor_mentions columns on the same table (jsonb NOT NULL DEFAULT '[]').

ALTER TABLE "public"."prompt_results"
  ADD COLUMN IF NOT EXISTS "shopping_cards" jsonb
    NOT NULL DEFAULT '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00006_insights_aggregates.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase-1 perf fix for /dashboard/insights (#93)
--
-- Today the insights server actions in web/src/lib/actions/tracking.ts pull
-- `SELECT *` from prompt_results and aggregate in JS. Each row carries the
-- full AI response text (kilobytes) + JSONB citations/competitor_mentions,
-- and for a brand with thousands of results the page transfers hundreds of
-- MB on every load + does big reducers in Node memory.
--
-- This migration:
--   1. Adds a composite (brand_id, created_at DESC) index — the exact shape
--      every insights filter needs but the only existing indexes are
--      single-column.
--   2. Adds three RPC functions that perform the aggregation server-side and
--      return only the totals + small grouped slices. Callers can compute
--      the same final numbers from these outputs with bit-for-bit parity
--      against the existing JS reducers (parity test in
--      scripts/parity-check-insights.ts).
--
-- Functions intentionally return RAW SUMS + COUNTS (not pre-divided averages)
-- so the final round happens in JS exactly as it does today — guarantees the
-- displayed dashboard numbers don't drift by even ±1 from a `Math.round`
-- half-rule mismatch between JS and Postgres.
--
-- Security model matches the existing get_latest_prompt_results functions:
-- SECURITY DEFINER — server actions verify brand-belongs-to-org access at
-- the route layer before calling. Adding a defensive org check inside the
-- function is a separate hygiene task tracked elsewhere.

-- ── Index ─────────────────────────────────────────────────────────────────
-- Composite covers WHERE brand_id = ? AND created_at BETWEEN ? AND ?
-- ORDER BY created_at DESC — single seek + sequential index walk instead of
-- index scan + heap filter + sort. ~11k rows in prod today; CREATE INDEX
-- without CONCURRENTLY locks writes for milliseconds. CONCURRENTLY would
-- avoid the lock but cannot run inside a transaction, and Supabase wraps
-- migrations in one. Plain CREATE is the right call at this row count.
CREATE INDEX IF NOT EXISTS idx_prompt_results_brand_created
  ON public.prompt_results USING btree (brand_id, created_at DESC);


-- ── insights_summary ──────────────────────────────────────────────────────
-- Replaces getInsightsSummary's `select('*') + JS reduce` over the filtered
-- row set. Returns one JSONB object with raw sums + counts + the per-model
-- breakdown shape the page needs.
CREATE OR REPLACE FUNCTION public.insights_aggregates(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_prompt_id  uuid         DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.visibility_score, pr.mention_count, pr.citation_count,
           pr.sentiment, pr.model_used, pr.created_at
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_prompt_id IS NULL OR pr.prompt_id   = p_prompt_id)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  totals AS (
    SELECT
      COUNT(*)                                                AS total_results,
      COALESCE(SUM(visibility_score), 0)                      AS sum_visibility,
      COALESCE(SUM(mention_count), 0)                         AS total_mentions,
      COALESCE(SUM(citation_count), 0)                        AS total_citations,
      COUNT(*) FILTER (WHERE sentiment = 'positive')          AS positive_count,
      MAX(created_at)                                         AS last_checked_at
    FROM filtered
  ),
  by_model AS (
    SELECT
      COALESCE(model_used, 'unknown') AS model_used,
      SUM(visibility_score)           AS sum_visibility,
      COUNT(*)                        AS result_count
    FROM filtered
    GROUP BY COALESCE(model_used, 'unknown')
  )
  SELECT jsonb_build_object(
    'total_results',     t.total_results,
    'sum_visibility',    t.sum_visibility,
    'total_mentions',    t.total_mentions,
    'total_citations',   t.total_citations,
    'positive_count',    t.positive_count,
    'last_checked_at',   t.last_checked_at,
    -- ORDER BY inside jsonb_agg keeps the response stable across calls so the
    -- platform list / chart doesn't jitter. jsonb_agg is otherwise free to
    -- return rows in any order. Same rationale for the other jsonb_aggs
    -- below.
    'by_model', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',     bm.model_used,
                'sum_visibility', bm.sum_visibility,
                'result_count',   bm.result_count)
              ORDER BY bm.result_count DESC, bm.model_used)
       FROM by_model bm),
      '[]'::jsonb)
  )
  FROM totals t;
$$;


-- ── competitor_aggregates ─────────────────────────────────────────────────
-- Replaces getCompetitorComparison's `select('*') + JS reduce`. Unwraps the
-- competitor_mentions JSONB once via LATERAL, then groups four ways:
--   * brand totals    — overall vis/mentions/citations
--   * by_competitor   — per-competitor flat row
--   * by_brand_provider     — brand vis grouped by (model_used, platform)
--   * by_competitor_provider — competitor vis grouped by (model_used, platform, competitor)
-- The provider mapping (resolveProvider) stays in JS so we don't ship a
-- duplicate lookup table in SQL that has to be kept in sync.
CREATE OR REPLACE FUNCTION public.competitor_aggregates(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_prompt_id  uuid         DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.visibility_score, pr.mention_count, pr.citation_count,
           pr.model_used, pr.platform, pr.competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_prompt_id IS NULL OR pr.prompt_id   = p_prompt_id)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  brand_totals AS (
    SELECT
      COUNT(*)                                          AS row_count,
      COALESCE(SUM(visibility_score), 0)                AS sum_visibility,
      COALESCE(SUM(mention_count), 0)::bigint           AS total_mentions,
      COALESCE(SUM(citation_count), 0)::bigint          AS total_citations
    FROM filtered
  ),
  by_brand_provider AS (
    SELECT
      model_used,
      platform,
      SUM(visibility_score)  AS sum_visibility,
      COUNT(*)               AS row_count
    FROM filtered
    GROUP BY model_used, platform
  ),
  mentions_flat AS (
    SELECT
      f.model_used,
      f.platform,
      cm.value->>'competitor_id'                       AS competitor_id,
      cm.value->>'name'                                AS competitor_name,
      (cm.value->>'visibility_score')::numeric         AS cm_visibility,
      COALESCE((cm.value->>'mention_count')::int, 0)   AS cm_mention_count,
      COALESCE((cm.value->>'citation_count')::int, 0)  AS cm_citation_count
    FROM filtered f,
         LATERAL jsonb_array_elements(
           COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
    WHERE cm.value ? 'competitor_id'
  ),
  by_competitor AS (
    SELECT
      competitor_id,
      MAX(competitor_name)                  AS name,
      SUM(cm_visibility)                    AS sum_visibility,
      COUNT(*)                              AS row_count,
      SUM(cm_mention_count)::bigint         AS total_mentions,
      SUM(cm_citation_count)::bigint        AS total_citations
    FROM mentions_flat
    GROUP BY competitor_id
  ),
  by_competitor_provider AS (
    SELECT
      model_used,
      platform,
      competitor_id,
      MAX(competitor_name)   AS competitor_name,
      SUM(cm_visibility)     AS sum_visibility,
      COUNT(*)               AS row_count
    FROM mentions_flat
    GROUP BY model_used, platform, competitor_id
  )
  SELECT jsonb_build_object(
    'brand_row_count',       b.row_count,
    'brand_sum_visibility',  b.sum_visibility,
    'brand_total_mentions',  b.total_mentions,
    'brand_total_citations', b.total_citations,
    'by_competitor', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'competitor_id',    bc.competitor_id,
                'name',             bc.name,
                'sum_visibility',   bc.sum_visibility,
                'row_count',        bc.row_count,
                'total_mentions',   bc.total_mentions,
                'total_citations',  bc.total_citations)
              ORDER BY bc.row_count DESC, bc.competitor_id)
       FROM by_competitor bc),
      '[]'::jsonb),
    'by_brand_provider', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',      bbp.model_used,
                'platform',        bbp.platform,
                'sum_visibility',  bbp.sum_visibility,
                'row_count',       bbp.row_count)
              ORDER BY bbp.platform NULLS LAST, bbp.model_used NULLS LAST)
       FROM by_brand_provider bbp),
      '[]'::jsonb),
    'by_competitor_provider', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',       bcp.model_used,
                'platform',         bcp.platform,
                'competitor_id',    bcp.competitor_id,
                'competitor_name',  bcp.competitor_name,
                'sum_visibility',   bcp.sum_visibility,
                'row_count',        bcp.row_count)
              ORDER BY bcp.platform NULLS LAST, bcp.model_used NULLS LAST, bcp.competitor_id)
       FROM by_competitor_provider bcp),
      '[]'::jsonb)
  )
  FROM brand_totals b;
$$;


-- ── share_of_voice_aggregates ─────────────────────────────────────────────
-- Replaces getShareOfVoiceData's `select('*') + JS reduce`. Returns totals
-- plus per (model_used, platform) and per-day slices. The provider mapping
-- (resolveProvider) stays in JS so we don't have to keep a SQL copy of that
-- lookup in sync as new engines land.
CREATE OR REPLACE FUNCTION public.share_of_voice_aggregates(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_prompt_id  uuid         DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      pr.mention_count,
      pr.model_used,
      pr.platform,
      pr.created_at,
      pr.competitor_mentions,
      -- Pre-sum the competitor mention counts for each row so we don't
      -- re-unwrap the JSONB array three times below.
      COALESCE((
        SELECT SUM((cm.value->>'mention_count')::int)
        FROM jsonb_array_elements(
               COALESCE(pr.competitor_mentions, '[]'::jsonb)) cm
      ), 0)::int AS row_competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_prompt_id IS NULL OR pr.prompt_id   = p_prompt_id)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  totals AS (
    SELECT
      COALESCE(SUM(mention_count), 0)::bigint            AS total_brand_mentions,
      COALESCE(SUM(row_competitor_mentions), 0)::bigint  AS total_competitor_mentions
    FROM filtered
  ),
  by_platform AS (
    SELECT
      model_used,
      platform,
      COALESCE(SUM(mention_count), 0)::bigint            AS brand_mentions,
      COALESCE(SUM(row_competitor_mentions), 0)::bigint  AS competitor_mentions
    FROM filtered
    GROUP BY model_used, platform
  ),
  by_day AS (
    SELECT
      -- JS does `created_at.slice(0,10)` on the ISO string, which yields the
      -- UTC date. Mirror that exactly so trend buckets line up.
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')  AS day,
      COALESCE(SUM(mention_count), 0)::bigint               AS brand_mentions,
      COALESCE(SUM(row_competitor_mentions), 0)::bigint     AS competitor_mentions
    FROM filtered
    GROUP BY to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  )
  SELECT jsonb_build_object(
    'total_brand_mentions',      t.total_brand_mentions,
    'total_competitor_mentions', t.total_competitor_mentions,
    'by_platform', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',          bp.model_used,
                'platform',            bp.platform,
                'brand_mentions',      bp.brand_mentions,
                'competitor_mentions', bp.competitor_mentions)
              ORDER BY bp.platform NULLS LAST, bp.model_used NULLS LAST)
       FROM by_platform bp),
      '[]'::jsonb),
    'by_day', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'day',                 bd.day,
                'brand_mentions',      bd.brand_mentions,
                'competitor_mentions', bd.competitor_mentions)
              ORDER BY bd.day)
       FROM by_day bd),
      '[]'::jsonb)
  )
  FROM totals t;
$$;


-- ── Grants ────────────────────────────────────────────────────────────────
-- Match the existing get_latest_prompt_results pattern: authenticated +
-- service_role can execute. Anon stays out (no anon access to insights).
GRANT EXECUTE ON FUNCTION public.insights_aggregates(uuid, text, text[], text, timestamptz, timestamptz, uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.competitor_aggregates(uuid, text, text[], text, timestamptz, timestamptz, uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.share_of_voice_aggregates(uuid, text, text[], text, timestamptz, timestamptz, uuid, uuid)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00008_visibility_trend_aggregates.sql
-- ─────────────────────────────────────────────────────────────────────────
-- DB-side aggregation for the visibility-over-time trend (#96).
--
-- The existing getVisibilityTrend in actions/tracking.ts fetches every
-- prompt_results row in the window and folds by day in JS. That works for
-- one user loading the insights page; it scales badly for an MCP client
-- (e.g. the planned in-product assistant in #94) firing repeated trend
-- queries — each call ships back tens of MB of jsonb rows just to be
-- reduced to a handful of date buckets. This RPC mirrors the structural
-- decisions of 00006 (the insights / competitor / SoV aggregates): one
-- jsonb-shaped return, raw sums + counts, ORDER BY inside jsonb_agg for
-- a stable response, and SECURITY DEFINER for symmetry with the other
-- aggregate RPCs (org-membership enforcement is tracked in #115).
--
-- Granularity is constrained to 'day' or 'week' so the response shape
-- stays predictable for chart-rendering consumers. date_trunc would
-- happily accept 'month' / 'year' too, but exposing those introduces
-- empty-bucket ambiguity at the assistant layer; if a caller wants
-- monthly aggregation today they can group the daily buckets client
-- side.
CREATE OR REPLACE FUNCTION public.visibility_trend_aggregates(
  p_brand_id     uuid,
  p_models       text[]       DEFAULT NULL,
  p_region       text         DEFAULT NULL,
  p_date_from    timestamptz  DEFAULT NULL,
  p_date_to      timestamptz  DEFAULT NULL,
  p_topic_id     uuid         DEFAULT NULL,
  p_granularity  text         DEFAULT 'day'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.visibility_score, pr.mention_count, pr.citation_count,
           pr.created_at, pr.competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  buckets AS (
    SELECT
      -- Bucket key always stored as YYYY-MM-DD in UTC so callers can sort
      -- lexicographically and so the JS reducer doesn't have to think about
      -- the server's timezone. For weeks, this is the Monday-start ISO week
      -- per Postgres's date_trunc semantics.
      to_char(
        date_trunc(p_granularity, created_at AT TIME ZONE 'UTC'),
        'YYYY-MM-DD'
      ) AS bucket_date,
      COUNT(*)                                                                AS row_count,
      COALESCE(SUM(visibility_score), 0)                                      AS sum_visibility,
      COALESCE(SUM(mention_count), 0)::bigint                                 AS sum_mentions,
      COALESCE(SUM(citation_count), 0)::bigint                                AS sum_citations,
      -- Competitor mentions are unnested per-row, then summed. We sum inside
      -- a correlated subquery so a row with five competitor entries
      -- contributes once per entry rather than five times to the brand
      -- numbers above.
      COALESCE(SUM((
        SELECT COALESCE(SUM((cm.value->>'visibility_score')::numeric), 0)
        FROM jsonb_array_elements(COALESCE(competitor_mentions, '[]'::jsonb)) cm
      )), 0)                                                                  AS comp_sum_visibility,
      COALESCE(SUM((
        SELECT COUNT(*)
        FROM jsonb_array_elements(COALESCE(competitor_mentions, '[]'::jsonb)) cm
      )), 0)::bigint                                                          AS comp_count
    FROM filtered
    GROUP BY to_char(
      date_trunc(p_granularity, created_at AT TIME ZONE 'UTC'),
      'YYYY-MM-DD'
    )
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object(
                'bucket_date',         b.bucket_date,
                'row_count',           b.row_count,
                'sum_visibility',      b.sum_visibility,
                'sum_mentions',        b.sum_mentions,
                'sum_citations',       b.sum_citations,
                'comp_sum_visibility', b.comp_sum_visibility,
                'comp_count',          b.comp_count
              )
              ORDER BY b.bucket_date)
     FROM buckets b),
    '[]'::jsonb);
$$;

GRANT EXECUTE ON FUNCTION
  public.visibility_trend_aggregates(uuid, text[], text, timestamptz, timestamptz, uuid, text)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00009_agent_chat_schema.sql
-- ─────────────────────────────────────────────────────────────────────────
-- In-product AI agent: schema for conversations, messages, and per-user
-- monthly token usage (#94 Phase 2).
--
-- Three tables, each scoped to a user inside an organization:
--
--   agent_conversations   one chat thread; "+ new chat" creates a row
--   agent_messages        ordered messages within a thread; tool calls
--                         stored alongside text content as jsonb
--   agent_token_usage     monthly bucket per user so the cost-guard can
--                         enforce plan-level quotas without scanning the
--                         messages table on every request
--
-- RLS scopes everything to auth.uid() — users can only see their own
-- conversations / messages / usage. The chat API runs server-side with
-- supabaseAdmin so it can write tool results that the user didn't author;
-- service_role bypasses RLS naturally.

-- ── agent_conversations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Optional default brand context: a new chat opened from a brand-specific
  -- page can pin the conversation to that brand so subsequent tool calls
  -- don't need to re-resolve the brand id every turn. Null = no pin.
  brand_id        uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  title           text NOT NULL DEFAULT 'New conversation',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Recency-sorted lookup per user is the hot path (sidebar list).
CREATE INDEX IF NOT EXISTS idx_agent_conversations_user_updated
  ON public.agent_conversations (user_id, updated_at DESC);


-- ── agent_messages ──────────────────────────────────────────────────────
-- Roles match the Vercel AI SDK / OpenAI shape so we can hydrate the chat
-- panel and feed the SDK's tool-calling loop without re-mapping:
--
--   user        regular user message; `content` holds the text
--   assistant   model output; `content` may be empty if the model only
--               emitted tool calls; `tool_calls` holds the array
--   tool        result of a tool call; `tool_call_id` joins back to the
--               assistant message's tool_calls entry; `tool_result` holds
--               the JSON payload returned by the tool
CREATE TABLE IF NOT EXISTS public.agent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         text NOT NULL DEFAULT '',
  tool_calls      jsonb,
  tool_call_id    text,
  tool_name       text,
  tool_result     jsonb,
  -- Token usage attributed to this message for analytics + the monthly
  -- bucket below. Null on user/tool rows; filled on the assistant
  -- response once the SDK stream finishes.
  prompt_tokens     int,
  completion_tokens int,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_conv_created
  ON public.agent_messages (conversation_id, created_at);


-- ── agent_token_usage ───────────────────────────────────────────────────
-- One row per (user, organization, year_month). The chat API upserts on
-- this row at the end of every streamed response, so quota enforcement is
-- one SELECT instead of an aggregate scan over agent_messages.
CREATE TABLE IF NOT EXISTS public.agent_token_usage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- 'YYYY-MM' (UTC). Stored as text so it's portable + lex-sortable.
  year_month         text NOT NULL,
  prompt_tokens      bigint NOT NULL DEFAULT 0,
  completion_tokens  bigint NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_agent_token_usage_user_month
  ON public.agent_token_usage (user_id, year_month);


-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_token_usage   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own conversations" ON public.agent_conversations
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users write own conversations" ON public.agent_conversations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users read own messages" ON public.agent_messages
  FOR SELECT USING (conversation_id IN (
    SELECT id FROM public.agent_conversations WHERE user_id = auth.uid()
  ));
CREATE POLICY "Users write own messages" ON public.agent_messages
  FOR ALL USING (conversation_id IN (
    SELECT id FROM public.agent_conversations WHERE user_id = auth.uid()
  )) WITH CHECK (conversation_id IN (
    SELECT id FROM public.agent_conversations WHERE user_id = auth.uid()
  ));

-- Read-only via RLS so the dashboard can display the user's own usage.
-- The chat API writes via supabaseAdmin (service_role bypasses RLS).
CREATE POLICY "Users read own usage" ON public.agent_token_usage
  FOR SELECT USING (user_id = auth.uid());


-- ── updated_at trigger ──────────────────────────────────────────────────
-- Conversations: touch updated_at when title or brand_id changes (sidebar
-- sort key) and when a new message is inserted (handled at the API layer).
CREATE OR REPLACE FUNCTION public.touch_agent_conversation_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agent_conversations_touch_updated_at
  BEFORE UPDATE ON public.agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.touch_agent_conversation_updated_at();

CREATE OR REPLACE FUNCTION public.touch_agent_token_usage_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agent_token_usage_touch_updated_at
  BEFORE UPDATE ON public.agent_token_usage
  FOR EACH ROW EXECUTE FUNCTION public.touch_agent_token_usage_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00010_org_anthropic_keys.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Bring-your-own-key for the in-product AI agent on cloud.
--
-- Cloud customers paste their own Anthropic API key in Settings → Agent;
-- the agent's chat endpoint reads it back at request time, decrypts it,
-- and uses it to drive `streamText`. Without a key the feature stays
-- locked regardless of plan.
--
-- The key itself lives in `anthropic_api_key_encrypted` as the JSON
-- envelope returned by the app-level AES-256-GCM helper
-- (web/src/lib/agent/key-encryption.ts). The app's master key
-- (ANSVISOR_ENCRYPTION_KEY) is the only thing that can decrypt it —
-- Postgres + Supabase admins see ciphertext only.
--
-- `last4` is mirrored in plaintext so the Settings UI can show
-- "sk-…abcd" without round-tripping decrypt. `set_at` / `set_by` give us
-- an audit trail for support cases ("when did the key change?").

alter table public.organizations
  add column if not exists anthropic_api_key_encrypted text,
  add column if not exists anthropic_api_key_last4 text,
  add column if not exists anthropic_api_key_set_at timestamptz,
  add column if not exists anthropic_api_key_set_by uuid references public.profiles(id) on delete set null;

comment on column public.organizations.anthropic_api_key_encrypted is
  'AES-256-GCM ciphertext (JSON envelope) of the org-level Anthropic API key. Null = no key configured.';
comment on column public.organizations.anthropic_api_key_last4 is
  'Last 4 chars of the plaintext key. Display-only; safe to expose to org members.';
comment on column public.organizations.anthropic_api_key_set_at is
  'When the current key was last saved.';
comment on column public.organizations.anthropic_api_key_set_by is
  'Profile of the org member who saved the current key. Set null on profile delete to preserve audit trail.';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00011_prompt_result_shopping_cards.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Normalized shopping cards.
--
-- `prompt_results.shopping_cards` stores the raw provider JSON (snake_case
-- for Perplexity, camelCase for Google AI Mode and Microsoft Copilot).
-- That's fine for archival but useless for analytics — "show me cards
-- where a competitor's product appears alongside mine" today means
-- scanning every prompt_result and JSON-parsing in app code.
--
-- This table is one row per card per prompt_result with the fields we
-- query on hoisted to real columns + the original card preserved in
-- `raw` for forward-compat. Populated by the worker after the
-- prompt_results insert (see server/src/lib/cloro-result-handler.js)
-- and backfilled by server/src/scripts/backfill-shopping-cards.js.

create table if not exists public.prompt_result_shopping_cards (
  id uuid primary key default gen_random_uuid(),
  prompt_result_id uuid not null references public.prompt_results(id) on delete cascade,
  -- denormalized from prompt_results.brand_id so org-scoped queries don't
  -- have to join the parent row.
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Position within the provider's `shopping_cards` array (0-indexed).
  -- Combined with prompt_result_id, this is the natural identity of a card
  -- and the key the backfill script uses to stay idempotent.
  position integer not null,

  -- Hoisted analytical columns.
  product_title text,
  product_brand text,
  price_amount numeric,
  price_currency text,
  image_url text,
  merchant_url text,
  merchant_domain text,
  rating numeric,
  review_count integer,

  -- Original card JSON. Lets us re-parse if the schema evolves without
  -- needing another backfill from the provider.
  raw jsonb not null,

  -- Brand matching, computed at insert time.
  --
  --   role = 'own'        → matched_brand_id points to brands.id (the tracked brand)
  --   role = 'competitor' → matched_brand_id points to competitors.id
  --   role = 'other'      → matched_brand_id is null
  --
  -- Intentionally polymorphic (no FK) so a single column can express both
  -- relations. ON DELETE of the underlying row doesn't cascade — analytics
  -- on historical mentions stay intact even if the brand or competitor
  -- record is later removed.
  matched_brand_id uuid,
  matched_brand_role text not null default 'other'
    check (matched_brand_role in ('own', 'competitor', 'other')),

  -- Denormalized for fast "show me Copilot shopping cards in TR last week".
  platform text not null,
  region text,
  created_at timestamptz not null default now(),

  unique (prompt_result_id, position)
);

-- Indexes targeted at the Shopping dashboard's three top-level queries:
--   "show me competitor products"          → (brand_id, matched_brand_role)
--   "rank product brands by mention count" → (product_brand)
--   "merchant domain leaderboard"          → (merchant_domain)
create index if not exists prompt_result_shopping_cards_brand_role_idx
  on public.prompt_result_shopping_cards (brand_id, matched_brand_role);
create index if not exists prompt_result_shopping_cards_product_brand_idx
  on public.prompt_result_shopping_cards (product_brand);
create index if not exists prompt_result_shopping_cards_merchant_domain_idx
  on public.prompt_result_shopping_cards (merchant_domain);

alter table public.prompt_result_shopping_cards enable row level security;

-- RLS mirrors `prompt_results`: org members can read their org's cards,
-- service role inserts + deletes everything. The worker writes through
-- supabaseAdmin which bypasses RLS, but the explicit policy keeps the
-- table reachable from a future authenticated-write surface.
create policy "shopping_cards: org member select"
  on public.prompt_result_shopping_cards
  for select
  using (
    brand_id in (
      select b.id
      from public.brands b
      where b.organization_id in (
        select organization_id
        from public.profiles
        where id = auth.uid()
      )
    )
  );

create policy "Service role can insert shopping cards"
  on public.prompt_result_shopping_cards
  for insert
  with check (true);

create policy "Service role can delete shopping cards"
  on public.prompt_result_shopping_cards
  for delete
  using (true);

comment on table public.prompt_result_shopping_cards is
  'One row per shopping card extracted from a prompt_result, normalized across providers. Source of truth for the Shopping dashboard and the MCP shopping tools.';
comment on column public.prompt_result_shopping_cards.matched_brand_id is
  'Polymorphic uuid: brands.id when role=own, competitors.id when role=competitor, null when role=other. Intentionally no FK so deletes don''t orphan historical analytics.';
comment on column public.prompt_result_shopping_cards.raw is
  'Original card JSON as the provider returned it. Kept for re-parsing if columns evolve.';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00012_shopping_mode.sql
-- ─────────────────────────────────────────────────────────────────────────
-- #155 — Brand-level "Shopping mode" toggle + ChatGPT Shopping isolation
--
-- Two small additions on top of the existing schema, plus a refresh of the
-- insights/visibility-trend RPCs so they exclude `platform = 'chatgpt-shopping'`
-- from brand-level aggregations.
--
-- 1. `brands.shopping_mode_enabled` — bool, default false.
--    Per-brand opt-in. Drives the Shopping sidebar entry's visibility (if
--    any brand in the org has it on) and seeds new prompts under that brand
--    with the chatgpt-shopping platform.
--
-- 2. `prompt_results.inline_products` — jsonb, default '[]'.
--    Mirrors the existing `shopping_cards` column. ChatGPT Shopping's Cloro
--    response returns both `shoppingCards` and `inlineProducts`; the cards go
--    to the shared column, the inline products land here for the Shopping
--    page to consume.
--
-- 3. RPC refresh — the three `*_aggregates` functions in
--    `00006_insights_aggregates.sql` and `visibility_trend_aggregates` in
--    `00008_visibility_trend_aggregates.sql` now exclude
--    `platform = 'chatgpt-shopping'` rows. Reason: ChatGPT Shopping answers
--    come from a different model (`gpt-5-3-mini`) — its visibility_score is
--    not comparable to a normal ChatGPT text response, so mixing those rows
--    into Insights would skew brand visibility/mentions/citations. Other
--    providers' shopping cards are a side-payload of the same model's
--    answer, so their rows stay in Insights.
--
--    The Shopping dashboard is the only surface that consumes
--    `platform = 'chatgpt-shopping'` rows — it reads from the normalized
--    `prompt_result_shopping_cards` table and is not affected.

-- ── 1. brands.shopping_mode_enabled ───────────────────────────────────────
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS shopping_mode_enabled boolean NOT NULL DEFAULT false;


-- ── 2. prompt_results.inline_products ─────────────────────────────────────
ALTER TABLE public.prompt_results
  ADD COLUMN IF NOT EXISTS inline_products jsonb NOT NULL DEFAULT '[]'::jsonb;


-- ── 3. RPC refresh — exclude chatgpt-shopping from Insights aggregates ────
--
-- All four functions are `CREATE OR REPLACE` so this re-runs cleanly.
-- The only change in each is the new `AND pr.platform <> 'chatgpt-shopping'`
-- predicate inside the `filtered` CTE.

CREATE OR REPLACE FUNCTION public.insights_aggregates(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_prompt_id  uuid         DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.visibility_score, pr.mention_count, pr.citation_count,
           pr.sentiment, pr.model_used, pr.created_at
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_prompt_id IS NULL OR pr.prompt_id   = p_prompt_id)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  totals AS (
    SELECT
      COUNT(*)                                                AS total_results,
      COALESCE(SUM(visibility_score), 0)                      AS sum_visibility,
      COALESCE(SUM(mention_count), 0)                         AS total_mentions,
      COALESCE(SUM(citation_count), 0)                        AS total_citations,
      COUNT(*) FILTER (WHERE sentiment = 'positive')          AS positive_count,
      MAX(created_at)                                         AS last_checked_at
    FROM filtered
  ),
  by_model AS (
    SELECT
      COALESCE(model_used, 'unknown') AS model_used,
      SUM(visibility_score)           AS sum_visibility,
      COUNT(*)                        AS result_count
    FROM filtered
    GROUP BY COALESCE(model_used, 'unknown')
  )
  SELECT jsonb_build_object(
    'total_results',     t.total_results,
    'sum_visibility',    t.sum_visibility,
    'total_mentions',    t.total_mentions,
    'total_citations',   t.total_citations,
    'positive_count',    t.positive_count,
    'last_checked_at',   t.last_checked_at,
    'by_model', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',     bm.model_used,
                'sum_visibility', bm.sum_visibility,
                'result_count',   bm.result_count)
              ORDER BY bm.result_count DESC, bm.model_used)
       FROM by_model bm),
      '[]'::jsonb)
  )
  FROM totals t;
$$;


CREATE OR REPLACE FUNCTION public.competitor_aggregates(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_prompt_id  uuid         DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.visibility_score, pr.mention_count, pr.citation_count,
           pr.model_used, pr.platform, pr.competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_prompt_id IS NULL OR pr.prompt_id   = p_prompt_id)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  brand_totals AS (
    SELECT
      COUNT(*)                                          AS row_count,
      COALESCE(SUM(visibility_score), 0)                AS sum_visibility,
      COALESCE(SUM(mention_count), 0)::bigint           AS total_mentions,
      COALESCE(SUM(citation_count), 0)::bigint          AS total_citations
    FROM filtered
  ),
  by_brand_provider AS (
    SELECT
      model_used,
      platform,
      SUM(visibility_score)  AS sum_visibility,
      COUNT(*)               AS row_count
    FROM filtered
    GROUP BY model_used, platform
  ),
  mentions_flat AS (
    SELECT
      f.model_used,
      f.platform,
      cm.value->>'competitor_id'                       AS competitor_id,
      cm.value->>'name'                                AS competitor_name,
      (cm.value->>'visibility_score')::numeric         AS cm_visibility,
      COALESCE((cm.value->>'mention_count')::int, 0)   AS cm_mention_count,
      COALESCE((cm.value->>'citation_count')::int, 0)  AS cm_citation_count
    FROM filtered f,
         LATERAL jsonb_array_elements(
           COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
    WHERE cm.value ? 'competitor_id'
  ),
  by_competitor AS (
    SELECT
      competitor_id,
      MAX(competitor_name)                  AS name,
      SUM(cm_visibility)                    AS sum_visibility,
      COUNT(*)                              AS row_count,
      SUM(cm_mention_count)::bigint         AS total_mentions,
      SUM(cm_citation_count)::bigint        AS total_citations
    FROM mentions_flat
    GROUP BY competitor_id
  ),
  by_competitor_provider AS (
    SELECT
      model_used,
      platform,
      competitor_id,
      MAX(competitor_name)   AS competitor_name,
      SUM(cm_visibility)     AS sum_visibility,
      COUNT(*)               AS row_count
    FROM mentions_flat
    GROUP BY model_used, platform, competitor_id
  )
  SELECT jsonb_build_object(
    'brand_row_count',       b.row_count,
    'brand_sum_visibility',  b.sum_visibility,
    'brand_total_mentions',  b.total_mentions,
    'brand_total_citations', b.total_citations,
    'by_competitor', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'competitor_id',    bc.competitor_id,
                'name',             bc.name,
                'sum_visibility',   bc.sum_visibility,
                'row_count',        bc.row_count,
                'total_mentions',   bc.total_mentions,
                'total_citations',  bc.total_citations)
              ORDER BY bc.row_count DESC, bc.competitor_id)
       FROM by_competitor bc),
      '[]'::jsonb),
    'by_brand_provider', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',      bbp.model_used,
                'platform',        bbp.platform,
                'sum_visibility',  bbp.sum_visibility,
                'row_count',       bbp.row_count)
              ORDER BY bbp.platform NULLS LAST, bbp.model_used NULLS LAST)
       FROM by_brand_provider bbp),
      '[]'::jsonb),
    'by_competitor_provider', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',       bcp.model_used,
                'platform',         bcp.platform,
                'competitor_id',    bcp.competitor_id,
                'competitor_name',  bcp.competitor_name,
                'sum_visibility',   bcp.sum_visibility,
                'row_count',        bcp.row_count)
              ORDER BY bcp.platform NULLS LAST, bcp.model_used NULLS LAST, bcp.competitor_id)
       FROM by_competitor_provider bcp),
      '[]'::jsonb)
  )
  FROM brand_totals b;
$$;


CREATE OR REPLACE FUNCTION public.visibility_trend_aggregates(
  p_brand_id     uuid,
  p_models       text[]       DEFAULT NULL,
  p_region       text         DEFAULT NULL,
  p_date_from    timestamptz  DEFAULT NULL,
  p_date_to      timestamptz  DEFAULT NULL,
  p_topic_id     uuid         DEFAULT NULL,
  p_granularity  text         DEFAULT 'day'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.visibility_score, pr.mention_count, pr.citation_count,
           pr.created_at, pr.competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  buckets AS (
    SELECT
      to_char(
        date_trunc(p_granularity, created_at AT TIME ZONE 'UTC'),
        'YYYY-MM-DD'
      ) AS bucket_date,
      COUNT(*)                                                                AS row_count,
      COALESCE(SUM(visibility_score), 0)                                      AS sum_visibility,
      COALESCE(SUM(mention_count), 0)::bigint                                 AS sum_mentions,
      COALESCE(SUM(citation_count), 0)::bigint                                AS sum_citations,
      COALESCE(SUM((
        SELECT COALESCE(SUM((cm.value->>'visibility_score')::numeric), 0)
        FROM jsonb_array_elements(COALESCE(competitor_mentions, '[]'::jsonb)) cm
      )), 0)                                                                  AS comp_sum_visibility,
      COALESCE(SUM((
        SELECT COUNT(*)
        FROM jsonb_array_elements(COALESCE(competitor_mentions, '[]'::jsonb)) cm
      )), 0)::bigint                                                          AS comp_count
    FROM filtered
    GROUP BY to_char(
      date_trunc(p_granularity, created_at AT TIME ZONE 'UTC'),
      'YYYY-MM-DD'
    )
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object(
                'bucket_date',         b.bucket_date,
                'row_count',           b.row_count,
                'sum_visibility',      b.sum_visibility,
                'sum_mentions',        b.sum_mentions,
                'sum_citations',       b.sum_citations,
                'comp_sum_visibility', b.comp_sum_visibility,
                'comp_count',          b.comp_count
              )
              ORDER BY b.bucket_date)
     FROM buckets b),
    '[]'::jsonb);
$$;


CREATE OR REPLACE FUNCTION public.share_of_voice_aggregates(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_prompt_id  uuid         DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      pr.mention_count,
      pr.model_used,
      pr.platform,
      pr.created_at,
      pr.competitor_mentions,
      COALESCE((
        SELECT SUM((cm.value->>'mention_count')::int)
        FROM jsonb_array_elements(
               COALESCE(pr.competitor_mentions, '[]'::jsonb)) cm
      ), 0)::int AS row_competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_prompt_id IS NULL OR pr.prompt_id   = p_prompt_id)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  totals AS (
    SELECT
      COALESCE(SUM(mention_count), 0)::bigint            AS total_brand_mentions,
      COALESCE(SUM(row_competitor_mentions), 0)::bigint  AS total_competitor_mentions
    FROM filtered
  ),
  by_platform AS (
    SELECT
      model_used,
      platform,
      COALESCE(SUM(mention_count), 0)::bigint            AS brand_mentions,
      COALESCE(SUM(row_competitor_mentions), 0)::bigint  AS competitor_mentions
    FROM filtered
    GROUP BY model_used, platform
  ),
  by_day AS (
    SELECT
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')  AS day,
      COALESCE(SUM(mention_count), 0)::bigint               AS brand_mentions,
      COALESCE(SUM(row_competitor_mentions), 0)::bigint     AS competitor_mentions
    FROM filtered
    GROUP BY to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  )
  SELECT jsonb_build_object(
    'total_brand_mentions',      t.total_brand_mentions,
    'total_competitor_mentions', t.total_competitor_mentions,
    'by_platform', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',          bp.model_used,
                'platform',            bp.platform,
                'brand_mentions',      bp.brand_mentions,
                'competitor_mentions', bp.competitor_mentions)
              ORDER BY bp.platform NULLS LAST, bp.model_used NULLS LAST)
       FROM by_platform bp),
      '[]'::jsonb),
    'by_day', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'day',                 bd.day,
                'brand_mentions',      bd.brand_mentions,
                'competitor_mentions', bd.competitor_mentions)
              ORDER BY bd.day)
       FROM by_day bd),
      '[]'::jsonb)
  )
  FROM totals t;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00013_prompt_performance_aggregates.sql
-- ─────────────────────────────────────────────────────────────────────────
-- DB-side aggregation for prompt-level performance (#139).
--
-- Excludes `platform = 'chatgpt-shopping'` to ensure ChatGPT Shopping rows
-- (which use different models and scoring dynamics) do not skew the organic
-- visibility and mentions of the brand's prompts.
-- SECURITY DEFINER allows the RPC to run with elevated privileges while Node
-- data functions enforce tenant membership.

CREATE OR REPLACE FUNCTION public.prompt_performance_aggregates(
  p_brand_id   uuid,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.prompt_id, pr.visibility_score, pr.mention_count, pr.citation_count, pr.competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  aggregated AS (
    SELECT
      f.prompt_id,
      COUNT(*)                                                                AS result_count,
      COALESCE(SUM(f.visibility_score), 0)                                    AS sum_visibility,
      COALESCE(SUM(f.mention_count), 0)::bigint                               AS total_mentions,
      COALESCE(SUM(f.citation_count), 0)::bigint                              AS total_citations,
      COALESCE(SUM((
        SELECT COALESCE(SUM((cm.value->>'visibility_score')::numeric), 0)
        FROM jsonb_array_elements(COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
      )), 0)                                                                  AS comp_sum_visibility,
      COALESCE(SUM((
        SELECT COUNT(*)
        FROM jsonb_array_elements(COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
      )), 0)::bigint                                                          AS comp_count
    FROM filtered f
    GROUP BY f.prompt_id
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object(
                'prompt_id',            a.prompt_id,
                'prompt_text',          p.text,
                'topic_name',           t.name,
                'result_count',         a.result_count,
                'sum_visibility',       a.sum_visibility,
                'total_mentions',       a.total_mentions,
                'total_citations',      a.total_citations,
                'comp_sum_visibility',  a.comp_sum_visibility,
                'comp_count',           a.comp_count
              )
            )
     FROM aggregated a
     JOIN public.prompts p ON p.id = a.prompt_id
     LEFT JOIN public.topics t ON t.id = p.topic_id),
    '[]'::jsonb);
$$;

GRANT EXECUTE ON FUNCTION public.prompt_performance_aggregates(uuid, text[], text, timestamptz, timestamptz, uuid)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00014_security_invoker_rpcs.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 00014_security_invoker_rpcs.sql
--
-- Security hardening (defense-in-depth): flip every aggregate / row-fetch RPC
-- from SECURITY DEFINER to SECURITY INVOKER so the database itself enforces
-- org isolation via Row Level Security, instead of relying solely on the route
-- layer to verify brand-belongs-to-org before calling.
--
-- Why this is safe (verified against the current schema):
--   * Every table these RPCs read is already covered by an org-scoped SELECT
--     policy for the `authenticated` role:
--       - prompt_results : "Users can read own org prompt results" (00001)
--       - prompts        : "prompts: member select"               (00001)
--       - topics         : no RLS, GRANT ALL to authenticated      (00001)
--   * Dashboard callers (web/src/lib/actions/tracking.ts) use the cookie-based
--     authenticated client, so auth.uid() is always populated and RLS resolves
--     to the caller's own organization — legitimate numbers are unchanged.
--   * MCP / worker callers (web/src/lib/mcp/data.ts) use the service_role
--     client, which bypasses RLS regardless of INVOKER/DEFINER — unaffected.
--
-- Effect for a wrong-org call: RLS filters out every row, so aggregates return
-- zeroed/empty results and row fetches return no rows. No cross-org data leaks.
--
-- We use ALTER FUNCTION (not CREATE OR REPLACE) on purpose: it flips only the
-- security attribute and leaves each function's body, search_path, volatility
-- and grants byte-for-byte identical — zero risk of body drift.

-- get_latest_prompt_results — two overloads (00001). Currently unused by app
-- code, but exposed to PostgREST, so harden anyway.
ALTER FUNCTION public.get_latest_prompt_results(
  p_brand_id uuid,
  p_platform text
) SECURITY INVOKER;

ALTER FUNCTION public.get_latest_prompt_results(
  p_brand_id uuid,
  p_platform text,
  p_model text,
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz
) SECURITY INVOKER;

-- insights_aggregates (current definition: 00012)
ALTER FUNCTION public.insights_aggregates(
  p_brand_id uuid,
  p_platform text,
  p_models text[],
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_prompt_id uuid,
  p_topic_id uuid
) SECURITY INVOKER;

-- competitor_aggregates (current definition: 00012)
ALTER FUNCTION public.competitor_aggregates(
  p_brand_id uuid,
  p_platform text,
  p_models text[],
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_prompt_id uuid,
  p_topic_id uuid
) SECURITY INVOKER;

-- share_of_voice_aggregates (current definition: 00012)
ALTER FUNCTION public.share_of_voice_aggregates(
  p_brand_id uuid,
  p_platform text,
  p_models text[],
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_prompt_id uuid,
  p_topic_id uuid
) SECURITY INVOKER;

-- visibility_trend_aggregates (current definition: 00012)
ALTER FUNCTION public.visibility_trend_aggregates(
  p_brand_id uuid,
  p_models text[],
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_topic_id uuid,
  p_granularity text
) SECURITY INVOKER;

-- prompt_performance_aggregates (00013)
ALTER FUNCTION public.prompt_performance_aggregates(
  p_brand_id uuid,
  p_models text[],
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_topic_id uuid
) SECURITY INVOKER;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00015_brief_usage.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Content brief generation quota tracking.
-- Mirrors the volume_usage pattern: one row per generated brief, counted
-- per organization per calendar month against plan.limits.maxBriefGenerations
-- (Starter 10, Growth 50, Enterprise via organizations.plan_overrides).
-- Self-hosted instances bypass quota entirely (IS_CLOUD !== "true").

CREATE TABLE IF NOT EXISTS "public"."brief_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "opportunity_id" "uuid",
    "used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."brief_usage" OWNER TO "postgres";

ALTER TABLE ONLY "public"."brief_usage"
    ADD CONSTRAINT "brief_usage_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."brief_usage"
    ADD CONSTRAINT "brief_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."brief_usage"
    ADD CONSTRAINT "brief_usage_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."content_opportunities"("id") ON DELETE SET NULL;

CREATE INDEX "idx_brief_usage_org_month" ON "public"."brief_usage" USING "btree" ("organization_id", "used_at");

-- RLS enabled with no policies: only the service role (aeo-server) writes
-- and reads usage rows — same posture as volume_usage.
ALTER TABLE "public"."brief_usage" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."brief_usage" TO "anon";
GRANT ALL ON TABLE "public"."brief_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."brief_usage" TO "service_role";

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00016_enable_rls_exposed_tables.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 00016_enable_rls_exposed_tables.sql
--
-- Close a direct-REST data exposure: four tables have shipped since 00001 with
-- Row Level Security DISABLED and GRANT ALL to the `authenticated` role and no
-- policies. With RLS off, anyone holding the public anon key can read or write
-- EVERY organization's rows in these tables straight through PostgREST,
-- bypassing the application entirely:
--
--   public.competitors, public.topics, public.prompt_volumes, public.jobs
--
-- Why enabling RLS here is safe (verified against the current code + schema):
--
--   * All server-side / worker access goes through the service_role key
--     (server/src/config/supabase.js, web/src/lib/supabase/admin.ts), which
--     bypasses RLS regardless of policies — unaffected.
--
--   * No SQL function references any of these four tables, so no SECURITY
--     INVOKER RPC can be starved by enabling RLS (confirmed: zero matches in
--     pg_get_functiondef across all public functions).
--
--   * jobs and prompt_volumes are NEVER read through the cookie-based
--     authenticated client — only via service_role (Express job manager, and
--     web/src/lib/mcp/data.ts which uses supabaseAdmin). So enabling RLS with
--     NO policy denies the authenticated/anon REST surface outright while the
--     service_role path keeps working.
--
--   * competitors and topics ARE read and written by Server Actions through the
--     authenticated client (web/src/lib/actions/competitor.ts, topic.ts,
--     citations.ts, prompt.ts, tracking.ts). They get org-membership-scoped
--     policies that mirror the existing "content_opportunities: member select"
--     pattern (brand_id -> brands -> profiles -> auth.uid()).
--
-- Policy scope: member-level (any member of the owning org) for all of
-- SELECT/INSERT/UPDATE/DELETE. This preserves today's in-org behavior — with
-- RLS off, any authenticated org member could already CRUD these rows — while
-- blocking the cross-org access that was previously possible. Tightening writes
-- to admin/manager (as brands/content_opportunities do) is a separate decision.

-- ---------------------------------------------------------------------------
-- Server-only tables: enable RLS, no policy (service_role bypasses).
-- ---------------------------------------------------------------------------
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_volumes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- competitors: org-membership-scoped policies (brand_id -> brands -> profiles).
-- ---------------------------------------------------------------------------
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competitors: member select" ON public.competitors
  FOR SELECT USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "competitors: member insert" ON public.competitors
  FOR INSERT WITH CHECK (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "competitors: member update" ON public.competitors
  FOR UPDATE USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  )
  WITH CHECK (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "competitors: member delete" ON public.competitors
  FOR DELETE USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- topics: org-membership-scoped policies (brand_id -> brands -> profiles).
-- ---------------------------------------------------------------------------
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "topics: member select" ON public.topics
  FOR SELECT USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "topics: member insert" ON public.topics
  FOR INSERT WITH CHECK (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "topics: member update" ON public.topics
  FOR UPDATE USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  )
  WITH CHECK (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "topics: member delete" ON public.topics
  FOR DELETE USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00017_site_audit.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Site Audit (VectorCite AEO/GEO rubric, MIT open standard).
-- One row per audit run + one row per evaluated signal.
-- Writes happen server-side via the service_role key; member policies below
-- keep direct authenticated-client reads org-scoped, mirroring competitors/topics.

CREATE TABLE IF NOT EXISTS site_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  url text NOT NULL,
  final_url text,
  status text NOT NULL DEFAULT 'running', -- running | completed | failed
  total_score numeric,
  category_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  signals_evaluated integer,
  signals_total integer,
  rubric_version text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS site_audits_brand_id_idx ON site_audits (brand_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_signal_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES site_audits(id) ON DELETE CASCADE,
  signal_key text NOT NULL,
  category text,
  status text NOT NULL, -- pass | warn | fail | na
  score numeric,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, signal_key)
);

CREATE INDEX IF NOT EXISTS audit_signal_results_audit_id_idx ON audit_signal_results (audit_id);

-- RLS: org-membership scoped, mirroring content_opportunities / competitors.
ALTER TABLE site_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_signal_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY site_audits_member_select ON site_audits FOR SELECT
  USING (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY site_audits_member_insert ON site_audits FOR INSERT
  WITH CHECK (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY site_audits_member_update ON site_audits FOR UPDATE
  USING (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY site_audits_member_delete ON site_audits FOR DELETE
  USING (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

-- audit_signal_results inherit access through their parent audit's brand.
CREATE POLICY audit_signal_results_member_select ON audit_signal_results FOR SELECT
  USING (
    audit_id IN (
      SELECT sa.id FROM site_audits sa
      JOIN brands b ON b.id = sa.brand_id
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY audit_signal_results_member_insert ON audit_signal_results FOR INSERT
  WITH CHECK (
    audit_id IN (
      SELECT sa.id FROM site_audits sa
      JOIN brands b ON b.id = sa.brand_id
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY audit_signal_results_member_delete ON audit_signal_results FOR DELETE
  USING (
    audit_id IN (
      SELECT sa.id FROM site_audits sa
      JOIN brands b ON b.id = sa.brand_id
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00018_site_audit_recommendations.sql
-- ─────────────────────────────────────────────────────────────────────────
-- AI fix recommendations for a Site Audit: a prioritized list of page-specific
-- suggestions (with ready-to-paste drafts) generated by the audit's LLM pass.
-- Stored on the audit so they persist when the report is re-opened.

ALTER TABLE site_audits
  ADD COLUMN IF NOT EXISTS recommendations jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00019_site_audit_usage.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Site Audit quota tracking. One row per completed audit, counted per
-- organization per calendar month against plan.limits.maxSiteAudits
-- (Starter 100, Growth 500, Enterprise/Self-hosted unlimited). Mirrors the
-- brief_usage pattern. Self-hosted instances bypass quota (IS_CLOUD !== "true").

CREATE TABLE IF NOT EXISTS "public"."site_audit_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "audit_id" "uuid",
    "used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."site_audit_usage"
    ADD CONSTRAINT "site_audit_usage_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."site_audit_usage"
    ADD CONSTRAINT "site_audit_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."site_audit_usage"
    ADD CONSTRAINT "site_audit_usage_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audits"("id") ON DELETE SET NULL;

CREATE INDEX "idx_site_audit_usage_org_month" ON "public"."site_audit_usage" USING "btree" ("organization_id", "used_at");

-- RLS enabled with no policies: only the service role (aeo-server) reads/writes
-- usage rows — same posture as brief_usage / volume_usage.
ALTER TABLE "public"."site_audit_usage" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."site_audit_usage" TO "anon";
GRANT ALL ON TABLE "public"."site_audit_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."site_audit_usage" TO "service_role";

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00020_brand_is_active.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 00020_brand_is_active.sql
-- Add a pause/resume switch to brands.
--
-- A brand can now be temporarily paused: pausing suspends daily tracking
-- (and all on-demand tracking spend) while keeping every bit of historical
-- data viewable. Resuming re-enables tracking on the next cron run.
--
-- Existing brands default to active so behavior is unchanged on rollout.

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN brands.is_active IS
  'When false, the brand is paused: the daily tracking cron and on-demand tracking skip it. Historical data stays viewable. Defaults to true.';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00021_prompt_results_search_queries.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 00021_prompt_results_search_queries.sql
-- Capture the observed query fan-out on each tracked answer.
--
-- Answer engines (Copilot, Perplexity, and — in principle — ChatGPT) run their
-- own sub-queries to build an answer. Cloro already returns these in the poll /
-- webhook response; we simply had nowhere to store them. This column holds that
-- OBSERVED fan-out (straight from the engine, not an LLM prediction) as a rich,
-- normalized array so the UI can keep the per-item engine label:
--
--   [{ "query": "best running shoes 2026", "engine": "web", "source_platform": "perplexity-web" }]
--
-- (`engine` is present only where the provider labels it — Perplexity today.)
--
-- Existing rows default to an empty array, so nothing changes for historical
-- data; new Copilot/Perplexity results populate it as they land.

ALTER TABLE prompt_results
  ADD COLUMN IF NOT EXISTS search_queries jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN prompt_results.search_queries IS
  'Observed query fan-out from the answer engine: [{ query, engine?, source_platform }]. Copilot is the primary source; Perplexity secondary (web queries, carries engine); ChatGPT usually empty. Defaults to [].';

