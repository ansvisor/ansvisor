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

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00022_fanout_query_intents.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 00022_fanout_query_intents.sql
-- On-demand, brand-independent cache of the search intent of a fan-out sub-query.
--
-- The Query Fan-out tab (#333) labels each observed sub-query with the same
-- 7-value intent taxonomy the Insights "intent" column uses. Intent is derived
-- from an LLM call, so we cache it per distinct (normalized, lower-cased) query
-- string — the intent of "best running shoes 2026" is the same for every brand,
-- so one classification is reused everywhere. Populated on-demand at read time,
-- never during tracking ingest.
--
-- Written only by the server (service role) via /api/prompts/fanout-intents;
-- RLS is enabled with no policies so it isn't readable/writable by anon or
-- authenticated clients directly.

CREATE TABLE IF NOT EXISTS fanout_query_intents (
  query text PRIMARY KEY,
  intent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE fanout_query_intents IS
  'Cache of a fan-out sub-query''s search intent (#333). Key is the normalized (trimmed, whitespace-collapsed, lower-cased) query; intent is one of comparison/how-to/what-is/best-top/vs-review/recommendation/problem-solving/other. Brand-independent, populated on-demand.';

ALTER TABLE fanout_query_intents ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00023_reports.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Reports (Simple Reports MVP).
-- One row per generated report. The report is IMMUTABLE: `payload` stores the
-- metric snapshot taken at generation time (insights summary, share of voice,
-- competitor comparison, citations overview) plus the AI executive summary
-- text, so the detail page renders from the saved payload with no live
-- queries. Writes happen through the authenticated client via Server Actions;
-- member policies below mirror site_audits/competitors (brand_id -> brands ->
-- profiles -> auth.uid()).

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title text NOT NULL,
  template text NOT NULL DEFAULT 'executive_summary',
  date_from timestamptz NOT NULL,
  date_to timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_brand_id_idx ON reports (brand_id, created_at DESC);

-- RLS: org-membership scoped, mirroring site_audits / competitors.
-- No UPDATE policy on purpose — reports are immutable snapshots.
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY reports_member_select ON reports FOR SELECT
  USING (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY reports_member_insert ON reports FOR INSERT
  WITH CHECK (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY reports_member_delete ON reports FOR DELETE
  USING (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00024_tracked_prompt_count.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ── Tracked Prompts KPI (#457) ────────────────────────────────────────────────
--
-- Distinct prompts that produced tracked results in a filtered window — the
-- period-aware main value of the Insights "Tracked Prompts" KPI card. A plain
-- "total tracked prompts" number was rejected because every card in that row
-- recomputes with the date preset; this count follows the same filters as
-- `insights_aggregates` (00012), including the #155 chatgpt-shopping
-- exclusion, so the KPI row stays internally consistent.
--
-- SECURITY INVOKER (00014 convention): RLS on prompt_results/prompts scopes
-- the caller to their own org's data.

CREATE OR REPLACE FUNCTION public.tracked_prompt_count(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT pr.prompt_id)::integer
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND pr.prompt_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    AND (p_platform  IS NULL OR pr.platform    = p_platform)
    AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
    AND (p_region    IS NULL OR pr.region      = p_region)
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
    AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
    AND (p_topic_id  IS NULL OR EXISTS (
           SELECT 1 FROM public.prompts p
           WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
$$;

GRANT EXECUTE ON FUNCTION public.tracked_prompt_count(
  uuid, text, text[], text, timestamptz, timestamptz, uuid
) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00025_prompt_visibility_summaries.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ── Per-prompt visibility summaries (#472 / prompts first-load fix) ──────────
--
-- The All Prompts tab's health columns were computed by fetching the brand's
-- raw prompt_results window into JS: un-paginated, so PostgREST silently
-- capped it at 1000 rows (wrong numbers on busy brands — same family as
-- #430/#464/#450) and the transfer cost slowed the page's first load. One
-- GROUP BY returns at most one row per prompt instead.
--
-- SECURITY INVOKER (00014 convention); excludes chatgpt-shopping (#155) to
-- match every other analytical surface.

CREATE OR REPLACE FUNCTION public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz DEFAULT NULL
)
RETURNS TABLE (
  prompt_id      uuid,
  avg_visibility double precision,
  total_mentions bigint,
  runs           bigint,
  last_run_at    timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT pr.prompt_id,
         AVG(COALESCE(pr.visibility_score, 0))::double precision AS avg_visibility,
         COALESCE(SUM(pr.mention_count), 0)::bigint              AS total_mentions,
         COUNT(*)::bigint                                        AS runs,
         MAX(pr.created_at)                                      AS last_run_at
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND pr.prompt_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from analytics
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
  GROUP BY pr.prompt_id
$$;

GRANT EXECUTE ON FUNCTION public.prompt_visibility_summaries(uuid, timestamptz)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00026_insights_filter_options.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ── Insights filter options (#458) ───────────────────────────────────────────
--
-- The Insights page's region / AI-model filter dropdowns used to derive their
-- options from the "Prompt Results by Topic" tree's 1500-row fetch. With that
-- tree removed, this returns the same option sets from one DISTINCT scan
-- instead of shipping full result rows to the client.
--
-- SECURITY INVOKER (00014 convention); excludes chatgpt-shopping (#155) to
-- match every other analytical surface. NULL/empty values are dropped exactly
-- like the old client-side filter(Boolean) did.

CREATE OR REPLACE FUNCTION public.insights_filter_options(p_brand_id uuid)
RETURNS TABLE (
  regions text[],
  models  text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT array_agg(DISTINCT pr.region ORDER BY pr.region)
      FROM public.prompt_results pr
      WHERE pr.brand_id = p_brand_id
        AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from analytics
        AND pr.region IS NOT NULL AND pr.region <> ''
    ), '{}') AS regions,
    COALESCE((
      SELECT array_agg(DISTINCT pr.model_used ORDER BY pr.model_used)
      FROM public.prompt_results pr
      WHERE pr.brand_id = p_brand_id
        AND pr.platform <> 'chatgpt-shopping'
        AND pr.model_used IS NOT NULL AND pr.model_used <> ''
    ), '{}') AS models
$$;

GRANT EXECUTE ON FUNCTION public.insights_filter_options(uuid)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00027_visible_prompt_stats.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ── Visibility Rate KPI ───────────────────────────────────────────────────────
--
-- Headline metric change on Insights: the raw average visibility score over
-- ALL results reads near zero for most brands (every answer the brand does
-- not appear in contributes a 0), which buries the two numbers users act on:
-- how OFTEN the brand shows up, and how GOOD it looks when it does. This RPC
-- returns the "appeared" side of that split for the filtered window:
--
--   visible_prompts        distinct prompts with >= 1 answer mentioning or
--                          citing the brand (numerator of Visibility Rate;
--                          the denominator is tracked_prompt_count, 00024)
--   visible_results        result rows where the brand appeared
--   sum_visibility_visible sum of visibility_score over those rows, so the
--                          caller derives "avg score when visible"
--
-- Filters mirror tracked_prompt_count / insights_aggregates exactly — same
-- window, same #155 chatgpt-shopping exclusion — so the KPI row stays
-- internally consistent.
--
-- SECURITY INVOKER (00014 convention): RLS on prompt_results/prompts scopes
-- the caller to their own org's data.

CREATE OR REPLACE FUNCTION public.visible_prompt_stats(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'visible_prompts',
      COUNT(DISTINCT pr.prompt_id)
        FILTER (WHERE pr.mention_count > 0 OR pr.citation_count > 0),
    'visible_results',
      COUNT(*) FILTER (WHERE pr.mention_count > 0 OR pr.citation_count > 0),
    'sum_visibility_visible',
      COALESCE(SUM(pr.visibility_score)
        FILTER (WHERE pr.mention_count > 0 OR pr.citation_count > 0), 0)
  )
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND pr.prompt_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    AND (p_platform  IS NULL OR pr.platform    = p_platform)
    AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
    AND (p_region    IS NULL OR pr.region      = p_region)
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
    AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
    AND (p_topic_id  IS NULL OR EXISTS (
           SELECT 1 FROM public.prompts p
           WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
$$;

GRANT EXECUTE ON FUNCTION public.visible_prompt_stats(
  uuid, text, text[], text, timestamptz, timestamptz, uuid
) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00028_competitor_visible_prompts.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ── Prompt-level visibility counts in competitor_aggregates ──────────────────
--
-- The Brand vs Competitors leaderboard moves from the all-rows score average
-- (which reads "1%" for a brand that appears in a third of its prompts —
-- every absent answer contributes a 0) to the same prompt-level Visibility
-- Rate the Insights headline now uses: distinct prompts an entity appeared
-- in ÷ distinct prompts that produced results, identical denominator for the
-- brand and every competitor.
--
-- Adds to the existing payload (shape is additive, old readers unaffected):
--   brand_prompt_count      distinct prompts in the filtered window
--   brand_visible_prompts   distinct prompts with >= 1 answer mentioning or
--                           citing the brand
--   by_competitor[].visible_prompts
--                           distinct prompts with >= 1 answer where that
--                           competitor scored (mention, citation or score)
--
-- SECURITY INVOKER kept from 00014.

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
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.prompt_id, pr.visibility_score, pr.mention_count, pr.citation_count,
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
      COALESCE(SUM(citation_count), 0)::bigint          AS total_citations,
      COUNT(DISTINCT prompt_id)                         AS prompt_count,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE mention_count > 0 OR citation_count > 0)
                                                        AS visible_prompts
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
      f.prompt_id,
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
      SUM(cm_citation_count)::bigint        AS total_citations,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE cm_mention_count > 0
                   OR cm_citation_count > 0
                   OR COALESCE(cm_visibility, 0) > 0)
                                            AS visible_prompts
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
    'brand_prompt_count',    b.prompt_count,
    'brand_visible_prompts', b.visible_prompts,
    'by_competitor', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'competitor_id',    bc.competitor_id,
                'name',             bc.name,
                'sum_visibility',   bc.sum_visibility,
                'row_count',        bc.row_count,
                'total_mentions',   bc.total_mentions,
                'total_citations',  bc.total_citations,
                'visible_prompts',  bc.visible_prompts)
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

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00029_provider_visible_prompts.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ── Per-provider prompt counts in competitor_aggregates ──────────────────────
--
-- Second half of the visibility-rate leaderboard switch (00028): the
-- "AI Visibility — Brand vs Competitors" provider chart still plotted the
-- all-rows score average per provider, so its bars contradicted the rate
-- numbers in the leaderboard next to it. The provider groups now also carry
-- distinct-prompt counts so the chart can plot the same prompt-level rate:
--
--   by_brand_provider[].prompt_count       distinct prompts in the group
--   by_brand_provider[].visible_prompts    …with >= 1 brand mention/citation
--   by_competitor_provider[].visible_prompts
--                                          …where that competitor scored
--
-- Groups stay keyed by (model_used, platform) — the provider mapping lives
-- in JS on purpose. Summing DISTINCT counts across two engines of the same
-- provider counts a shared prompt once per engine, in the numerator and the
-- denominator alike, so the folded rate stays unbiased.
--
-- SECURITY INVOKER kept from 00014.

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
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.prompt_id, pr.visibility_score, pr.mention_count, pr.citation_count,
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
      COALESCE(SUM(citation_count), 0)::bigint          AS total_citations,
      COUNT(DISTINCT prompt_id)                         AS prompt_count,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE mention_count > 0 OR citation_count > 0)
                                                        AS visible_prompts
    FROM filtered
  ),
  by_brand_provider AS (
    SELECT
      model_used,
      platform,
      SUM(visibility_score)  AS sum_visibility,
      COUNT(*)               AS row_count,
      COUNT(DISTINCT prompt_id) AS prompt_count,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE mention_count > 0 OR citation_count > 0)
                             AS visible_prompts
    FROM filtered
    GROUP BY model_used, platform
  ),
  mentions_flat AS (
    SELECT
      f.prompt_id,
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
      SUM(cm_citation_count)::bigint        AS total_citations,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE cm_mention_count > 0
                   OR cm_citation_count > 0
                   OR COALESCE(cm_visibility, 0) > 0)
                                            AS visible_prompts
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
      COUNT(*)               AS row_count,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE cm_mention_count > 0
                   OR cm_citation_count > 0
                   OR COALESCE(cm_visibility, 0) > 0)
                             AS visible_prompts
    FROM mentions_flat
    GROUP BY model_used, platform, competitor_id
  )
  SELECT jsonb_build_object(
    'brand_row_count',       b.row_count,
    'brand_sum_visibility',  b.sum_visibility,
    'brand_total_mentions',  b.total_mentions,
    'brand_total_citations', b.total_citations,
    'brand_prompt_count',    b.prompt_count,
    'brand_visible_prompts', b.visible_prompts,
    'by_competitor', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'competitor_id',    bc.competitor_id,
                'name',             bc.name,
                'sum_visibility',   bc.sum_visibility,
                'row_count',        bc.row_count,
                'total_mentions',   bc.total_mentions,
                'total_citations',  bc.total_citations,
                'visible_prompts',  bc.visible_prompts)
              ORDER BY bc.row_count DESC, bc.competitor_id)
       FROM by_competitor bc),
      '[]'::jsonb),
    'by_brand_provider', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',       bbp.model_used,
                'platform',         bbp.platform,
                'sum_visibility',   bbp.sum_visibility,
                'row_count',        bbp.row_count,
                'prompt_count',     bbp.prompt_count,
                'visible_prompts',  bbp.visible_prompts)
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
                'row_count',        bcp.row_count,
                'visible_prompts',  bcp.visible_prompts)
              ORDER BY bcp.platform NULLS LAST, bcp.model_used NULLS LAST, bcp.competitor_id)
       FROM by_competitor_provider bcp),
      '[]'::jsonb)
  )
  FROM brand_totals b;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00030_topic_suggestions.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 00030_topic_suggestions.sql
-- Persisted AI topic suggestions for the Topics page (#463).
--
-- Mirrors prompt_suggestions: rows are generated only on explicit user
-- action (never on page load), survive reloads, and dismissed suggestions
-- never reappear. All writes go through the Express server's service-role
-- client; RLS below covers the web app's direct reads.

CREATE TABLE IF NOT EXISTS "public"."topic_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "reason" "text",
    "source" "text" DEFAULT 'llm'::"text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "added_topic_id" "uuid",
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "topic_suggestions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "topic_suggestions_status_check" CHECK (
        "status" = ANY (ARRAY['new'::"text", 'added'::"text", 'dismissed'::"text"])
    ),
    CONSTRAINT "topic_suggestions_brand_id_fkey" FOREIGN KEY ("brand_id")
        REFERENCES "public"."brands"("id") ON DELETE CASCADE,
    CONSTRAINT "topic_suggestions_added_topic_id_fkey" FOREIGN KEY ("added_topic_id")
        REFERENCES "public"."topics"("id") ON DELETE SET NULL
);

ALTER TABLE "public"."topic_suggestions" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_topic_suggestions_brand_status"
    ON "public"."topic_suggestions" ("brand_id", "status");

ALTER TABLE "public"."topic_suggestions" ENABLE ROW LEVEL SECURITY;

-- Same policy shape as prompt_suggestions: every org member can read,
-- admin/manager/analyst can update (dismiss/accept acks happen server-side,
-- but the web app reads rows directly when accepting).
CREATE POLICY "topic_suggestions: member select" ON "public"."topic_suggestions"
    FOR SELECT USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
        )
    );

CREATE POLICY "topic_suggestions: admin/manager/analyst update" ON "public"."topic_suggestions"
    FOR UPDATE USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
              AND "p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'analyst'::"public"."user_role"])
        )
    );

GRANT ALL ON TABLE "public"."topic_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."topic_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."topic_suggestions" TO "service_role";

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00031_prompt_workflow.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 00031_prompt_workflow.sql
-- Prompt workflow: per-prompt work status, a notes thread, and multiple
-- target URLs. Turns the prompts list into a workspace — "which prompts have
-- we acted on, which still need work, and which URLs are we pushing to get
-- cited?" Target URLs are structured (not free text inside notes) so a later
-- iteration can auto-check them against the prompt's citations.

ALTER TABLE "public"."prompts"
  ADD COLUMN IF NOT EXISTS "work_status" "text",
  ADD CONSTRAINT "prompts_work_status_check" CHECK (
    "work_status" IS NULL OR "work_status" = ANY (ARRAY['todo'::"text", 'in_progress'::"text", 'done'::"text"])
  );

CREATE TABLE IF NOT EXISTS "public"."prompt_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_id" "uuid" NOT NULL,
    "author_id" "uuid",
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prompt_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prompt_notes_prompt_id_fkey" FOREIGN KEY ("prompt_id")
        REFERENCES "public"."prompts"("id") ON DELETE CASCADE,
    CONSTRAINT "prompt_notes_author_id_fkey" FOREIGN KEY ("author_id")
        REFERENCES "public"."profiles"("id") ON DELETE SET NULL
);

ALTER TABLE "public"."prompt_notes" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_prompt_notes_prompt"
    ON "public"."prompt_notes" ("prompt_id", "created_at");

CREATE TABLE IF NOT EXISTS "public"."prompt_target_urls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "label" "text",
    "added_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prompt_target_urls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prompt_target_urls_prompt_id_fkey" FOREIGN KEY ("prompt_id")
        REFERENCES "public"."prompts"("id") ON DELETE CASCADE,
    CONSTRAINT "prompt_target_urls_added_by_fkey" FOREIGN KEY ("added_by")
        REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    CONSTRAINT "prompt_target_urls_unique" UNIQUE ("prompt_id", "url")
);

ALTER TABLE "public"."prompt_target_urls" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_prompt_target_urls_prompt"
    ON "public"."prompt_target_urls" ("prompt_id", "created_at");

ALTER TABLE "public"."prompt_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."prompt_target_urls" ENABLE ROW LEVEL SECURITY;

-- Same org scoping as prompts: members read, admin/manager write.
CREATE POLICY "prompt_notes: member select" ON "public"."prompt_notes"
    FOR SELECT USING (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE ("p"."id" = "auth"."uid"()))));

CREATE POLICY "prompt_notes: admin/manager insert" ON "public"."prompt_notes"
    FOR INSERT WITH CHECK (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));

CREATE POLICY "prompt_notes: admin/manager delete" ON "public"."prompt_notes"
    FOR DELETE USING (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));

CREATE POLICY "prompt_target_urls: member select" ON "public"."prompt_target_urls"
    FOR SELECT USING (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE ("p"."id" = "auth"."uid"()))));

CREATE POLICY "prompt_target_urls: admin/manager insert" ON "public"."prompt_target_urls"
    FOR INSERT WITH CHECK (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));

CREATE POLICY "prompt_target_urls: admin/manager delete" ON "public"."prompt_target_urls"
    FOR DELETE USING (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));

GRANT ALL ON TABLE "public"."prompt_notes" TO "anon";
GRANT ALL ON TABLE "public"."prompt_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_notes" TO "service_role";
GRANT ALL ON TABLE "public"."prompt_target_urls" TO "anon";
GRANT ALL ON TABLE "public"."prompt_target_urls" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_target_urls" TO "service_role";

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00032_target_url_cited_stats.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 00032_target_url_cited_stats.sql
-- v2 of the prompt workflow (00031): closed-loop citation tracking for
-- target URLs. Stats are denormalized onto the row so list surfaces read
-- them without scanning result citations: the tracking pipeline updates
-- them as new results arrive, and the web action backfills once when a URL
-- is added.

ALTER TABLE "public"."prompt_target_urls"
  ADD COLUMN IF NOT EXISTS "cited_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "first_cited_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_cited_at" timestamp with time zone;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00033_insights_sentiment_denominator.sql
-- ─────────────────────────────────────────────────────────────────────────
-- #508 — Positive Sentiment KPI was dividing by total_results, which includes
-- rows where the brand was never mentioned (sentiment analysis is skipped for
-- those). Add mentioning_results so the app can divide by brand-mentioning
-- answers only.
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
      COUNT(*) FILTER (WHERE mention_count > 0
                          OR citation_count > 0)               AS mentioning_results,
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
    'total_results',       t.total_results,
    'sum_visibility',      t.sum_visibility,
    'total_mentions',      t.total_mentions,
    'total_citations',     t.total_citations,
    'positive_count',      t.positive_count,
    'mentioning_results',  t.mentioning_results,
    'last_checked_at',     t.last_checked_at,
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

ALTER FUNCTION public.insights_aggregates(
  uuid, text, text[], text, timestamptz, timestamptz, uuid, uuid
) SECURITY INVOKER;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00034_prompt_visibility_summary_citations.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Add citation totals to the All Prompts visibility summary (#529).
--
-- The return type changes, so PostgreSQL requires the existing function to
-- be dropped before it can be recreated with the additional column.

DROP FUNCTION public.prompt_visibility_summaries(uuid, timestamptz);

CREATE FUNCTION public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz DEFAULT NULL
)
RETURNS TABLE (
  prompt_id       uuid,
  avg_visibility  double precision,
  total_mentions  bigint,
  total_citations bigint,
  runs            bigint,
  last_run_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT pr.prompt_id,
         AVG(COALESCE(pr.visibility_score, 0))::double precision AS avg_visibility,
         COALESCE(SUM(pr.mention_count), 0)::bigint              AS total_mentions,
         COALESCE(SUM(pr.citation_count), 0)::bigint             AS total_citations,
         COUNT(*)::bigint                                        AS runs,
         MAX(pr.created_at)                                      AS last_run_at
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND pr.prompt_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 - isolate from analytics
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
  GROUP BY pr.prompt_id
$$;

GRANT EXECUTE ON FUNCTION public.prompt_visibility_summaries(uuid, timestamptz)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00035_competitor_aggregates_live_only.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ── Only aggregate mentions of competitors that still exist ──────────────────
--
-- Deleting a competitor stops future tracking runs from scoring it, but the
-- Insights leaderboard, the provider breakdown and the Competitors comparison
-- kept showing it until the selected date window aged past its last scraped
-- result: competitor_aggregates reads the historical competitor_mentions JSON
-- on prompt_results and never checked the live competitors table.
--
-- mentions_flat now keeps only rows whose competitor_id resolves to a live
-- competitor of the same brand, so removed competitors drop out of every
-- competitor-side CTE at once. The brand-side numbers come from the filtered
-- CTE and each remaining competitor's rate uses its own visible_prompts over
-- the shared brand_prompt_count, so neither changes.
--
-- Function body otherwise identical to 00029. Return type is unchanged, so
-- CREATE OR REPLACE suffices (grants from 00006 carry over).
-- SECURITY INVOKER kept from 00014.

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
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.prompt_id, pr.visibility_score, pr.mention_count, pr.citation_count,
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
      COALESCE(SUM(citation_count), 0)::bigint          AS total_citations,
      COUNT(DISTINCT prompt_id)                         AS prompt_count,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE mention_count > 0 OR citation_count > 0)
                                                        AS visible_prompts
    FROM filtered
  ),
  by_brand_provider AS (
    SELECT
      model_used,
      platform,
      SUM(visibility_score)  AS sum_visibility,
      COUNT(*)               AS row_count,
      COUNT(DISTINCT prompt_id) AS prompt_count,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE mention_count > 0 OR citation_count > 0)
                             AS visible_prompts
    FROM filtered
    GROUP BY model_used, platform
  ),
  mentions_flat AS (
    SELECT
      f.prompt_id,
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
      AND EXISTS (
        SELECT 1 FROM public.competitors c
        WHERE c.id::text = cm.value->>'competitor_id'
          AND c.brand_id = p_brand_id
      )
  ),
  by_competitor AS (
    SELECT
      competitor_id,
      MAX(competitor_name)                  AS name,
      SUM(cm_visibility)                    AS sum_visibility,
      COUNT(*)                              AS row_count,
      SUM(cm_mention_count)::bigint         AS total_mentions,
      SUM(cm_citation_count)::bigint        AS total_citations,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE cm_mention_count > 0
                   OR cm_citation_count > 0
                   OR COALESCE(cm_visibility, 0) > 0)
                                            AS visible_prompts
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
      COUNT(*)               AS row_count,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE cm_mention_count > 0
                   OR cm_citation_count > 0
                   OR COALESCE(cm_visibility, 0) > 0)
                             AS visible_prompts
    FROM mentions_flat
    GROUP BY model_used, platform, competitor_id
  )
  SELECT jsonb_build_object(
    'brand_row_count',       b.row_count,
    'brand_sum_visibility',  b.sum_visibility,
    'brand_total_mentions',  b.total_mentions,
    'brand_total_citations', b.total_citations,
    'brand_prompt_count',    b.prompt_count,
    'brand_visible_prompts', b.visible_prompts,
    'by_competitor', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'competitor_id',    bc.competitor_id,
                'name',             bc.name,
                'sum_visibility',   bc.sum_visibility,
                'row_count',        bc.row_count,
                'total_mentions',   bc.total_mentions,
                'total_citations',  bc.total_citations,
                'visible_prompts',  bc.visible_prompts)
              ORDER BY bc.row_count DESC, bc.competitor_id)
       FROM by_competitor bc),
      '[]'::jsonb),
    'by_brand_provider', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',       bbp.model_used,
                'platform',         bbp.platform,
                'sum_visibility',   bbp.sum_visibility,
                'row_count',        bbp.row_count,
                'prompt_count',     bbp.prompt_count,
                'visible_prompts',  bbp.visible_prompts)
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
                'row_count',        bcp.row_count,
                'visible_prompts',  bcp.visible_prompts)
              ORDER BY bcp.platform NULLS LAST, bcp.model_used NULLS LAST, bcp.competitor_id)
       FROM by_competitor_provider bcp),
      '[]'::jsonb)
  )
  FROM brand_totals b;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00036_daily_pulse.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 00036_daily_pulse.sql
-- Daily Pulse (#540): per-brand daily digest sent after the tracking run.
--
-- pulse_settings — per-brand delivery preferences (frequency + recipients).
-- sent_pulses    — send log: dedup ("already sent today"), the content
--                  snapshot that went out, and the warning keys used for the
--                  7-day warning cooldown.
--
-- All writes go through the Express server's service-role client; RLS below
-- covers the web app's direct reads plus settings writes by admin/manager.

CREATE TABLE IF NOT EXISTS "public"."pulse_settings" (
    "brand_id" "uuid" NOT NULL,
    "frequency" "text" DEFAULT 'daily'::"text" NOT NULL,
    "recipients" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pulse_settings_pkey" PRIMARY KEY ("brand_id"),
    CONSTRAINT "pulse_settings_frequency_check" CHECK (
        "frequency" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'notable'::"text", 'off'::"text"])
    ),
    CONSTRAINT "pulse_settings_brand_id_fkey" FOREIGN KEY ("brand_id")
        REFERENCES "public"."brands"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."pulse_settings" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."sent_pulses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "pulse_date" "date" NOT NULL,
    "frequency" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "warning_keys" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "email_sent" boolean DEFAULT false NOT NULL,
    "email_recipient_count" integer DEFAULT 0 NOT NULL,
    "webhook_sent" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sent_pulses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sent_pulses_brand_id_fkey" FOREIGN KEY ("brand_id")
        REFERENCES "public"."brands"("id") ON DELETE CASCADE,
    CONSTRAINT "sent_pulses_brand_date_key" UNIQUE ("brand_id", "pulse_date")
);

ALTER TABLE "public"."sent_pulses" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_sent_pulses_brand_created"
    ON "public"."sent_pulses" ("brand_id", "created_at" DESC);

ALTER TABLE "public"."pulse_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sent_pulses" ENABLE ROW LEVEL SECURITY;

-- Same policy shape as topic_suggestions: every org member can read;
-- admin/manager can change delivery preferences from Settings.
CREATE POLICY "pulse_settings: member select" ON "public"."pulse_settings"
    FOR SELECT USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
        )
    );

CREATE POLICY "pulse_settings: admin/manager insert" ON "public"."pulse_settings"
    FOR INSERT WITH CHECK (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
              AND "p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"])
        )
    );

CREATE POLICY "pulse_settings: admin/manager update" ON "public"."pulse_settings"
    FOR UPDATE USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
              AND "p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"])
        )
    );

CREATE POLICY "sent_pulses: member select" ON "public"."sent_pulses"
    FOR SELECT USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
        )
    );

GRANT ALL ON TABLE "public"."pulse_settings" TO "anon";
GRANT ALL ON TABLE "public"."pulse_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."pulse_settings" TO "service_role";

GRANT ALL ON TABLE "public"."sent_pulses" TO "anon";
GRANT ALL ON TABLE "public"."sent_pulses" TO "authenticated";
GRANT ALL ON TABLE "public"."sent_pulses" TO "service_role";

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00037_prompt_visibility_summary_rate.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Add prompt-level visibility-rate inputs to the All Prompts summary.
--
-- The Visibility column averaged visibility_score across ALL runs, so runs
-- where the brand didn't appear dragged heavily-mentioned prompts down to
-- misleading single digits (same dilution the Insights headline had before
-- the Visibility Rate switch in #490/#493). The table now needs:
--
--   visible_runs           runs with >= 1 brand mention/citation — the
--                          numerator of the prompt-level rate (runs is the
--                          denominator), matching the run-visibility rule
--                          used by insights_aggregates / topic detail
--   avg_visibility_visible average score across visible runs only, for the
--                          "how strong when it shows up" tooltip
--
-- avg_visibility (all-runs average) is kept for compatibility.
--
-- The return type changes, so PostgreSQL requires the existing function to
-- be dropped before it can be recreated with the additional columns.

DROP FUNCTION public.prompt_visibility_summaries(uuid, timestamptz);

CREATE FUNCTION public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz DEFAULT NULL
)
RETURNS TABLE (
  prompt_id              uuid,
  avg_visibility         double precision,
  avg_visibility_visible double precision,
  total_mentions         bigint,
  total_citations        bigint,
  runs                   bigint,
  visible_runs           bigint,
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
         MAX(pr.created_at)                                      AS last_run_at
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND pr.prompt_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 - isolate from analytics
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
  GROUP BY pr.prompt_id
$$;

GRANT EXECUTE ON FUNCTION public.prompt_visibility_summaries(uuid, timestamptz)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00038_mention_position.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Track where the brand lands in each answer's mention order.
--
--   mention_position        1-based rank of the brand's first mention among
--                           the brand + tracked competitors named in the
--                           answer (1 = named first); NULL when the brand
--                           isn't mentioned in the answer.
--   mentioned_entity_count  how many tracked entities the answer names.
--                           0 = computed, nothing found; NULL = not
--                           computed yet (rows from before this migration —
--                           the backfill script keys off this).
--
-- Computed deterministically at parse time (response-parser.js) — no LLM.
-- Not surfaced anywhere yet: the signal accumulates first so any future
-- position-aware scoring can be calibrated against real distributions.

ALTER TABLE "public"."prompt_results"
    ADD COLUMN IF NOT EXISTS "mention_position" integer,
    ADD COLUMN IF NOT EXISTS "mentioned_entity_count" integer;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00039_visibility_rate_trend.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Daily Visibility Rate series for the brand and each live competitor.
--
-- Powers the Insights "AI Visibility — Brand vs Competitors" trend chart:
-- one line per entity, each day's value being the prompt-level rate for
-- that day. Rules match the rest of the rate family:
--   - a prompt is "visible" on a day when any of its runs that day carries
--     a brand mention or citation (00027 semantics)
--   - a competitor is "visible" on a prompt when its mention entry has a
--     mention, citation or score (00028 semantics)
--   - competitor rows only count while the competitor still exists (00035)
--   - the denominator is the BRAND's per-day distinct prompt count, shared
--     by every entity so lines are comparable (getCompetitorComparison rule)
--   - chatgpt-shopping excluded (#155)
--
-- Days are UTC buckets. Rates are computed by the caller (visible/prompts),
-- keeping all rounding in one place (the web action).

CREATE OR REPLACE FUNCTION public.visibility_rate_trend(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.prompt_id, pr.mention_count, pr.citation_count, pr.competitor_mentions,
           (pr.created_at AT TIME ZONE 'UTC')::date AS day
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  brand_daily AS (
    SELECT day,
           COUNT(DISTINCT prompt_id)                         AS prompt_count,
           COUNT(DISTINCT prompt_id)
             FILTER (WHERE mention_count > 0 OR citation_count > 0)
                                                             AS visible_prompts
    FROM filtered
    GROUP BY day
  ),
  comp_daily AS (
    SELECT f.day,
           cm.value->>'competitor_id' AS competitor_id,
           COUNT(DISTINCT f.prompt_id)
             FILTER (WHERE COALESCE((cm.value->>'mention_count')::int, 0) > 0
                        OR COALESCE((cm.value->>'citation_count')::int, 0) > 0
                        OR COALESCE((cm.value->>'visibility_score')::numeric, 0) > 0)
                                      AS visible_prompts
    FROM filtered f,
         LATERAL jsonb_array_elements(
           COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
    WHERE cm.value ? 'competitor_id'
      AND EXISTS (
        SELECT 1 FROM public.competitors c
        WHERE c.id::text = cm.value->>'competitor_id'
          AND c.brand_id = p_brand_id
      )
    GROUP BY f.day, cm.value->>'competitor_id'
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'day',             bd.day,
      'prompt_count',    bd.prompt_count,
      'visible_prompts', bd.visible_prompts,
      'competitors', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
                  'competitor_id',   cd.competitor_id,
                  'visible_prompts', cd.visible_prompts))
         FROM comp_daily cd WHERE cd.day = bd.day),
        '[]'::jsonb)
    ) ORDER BY bd.day),
    '[]'::jsonb)
  FROM brand_daily bd;
$$;

GRANT EXECUTE ON FUNCTION public.visibility_rate_trend(uuid, text, text[], text, timestamptz, timestamptz, uuid)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00040_ai_visibility_aggregates.sql
-- ─────────────────────────────────────────────────────────────────────────
-- AI Visibility Score compute layer.
--
-- The score is a weighted blend of three answer-level components, computed
-- over any answer set (brand-wide, per prompt, per topic, per day):
--
--   mention rate     share of answers naming the entity (word-boundary
--                    detection at parse time, URL-stripped)
--   citation rate    share of answers linking a source on the entity's domain
--   position factor  mean of 1/mention_position over answers that name it
--                    (being named first counts more than being named fifth)
--
-- The blend weights live in ONE place per runtime
-- (web/src/lib/visibility-score.ts, mirrored in
-- server/src/config/visibility-score.js) — these RPCs return raw
-- components only, so recalibrating weights never needs a migration.
--
-- Three changes, one layer:
--   1. NEW ai_visibility_aggregates — brand + per-competitor components in
--      one call (shared denominator, live competitors only per 00035).
--   2. prompt_visibility_summaries gains the three components per prompt
--      (return type changes, so DROP + CREATE as in 00034/00037).
--   3. visibility_rate_trend gains per-day components for the brand and
--      each competitor, keeping its existing keys untouched.
--
-- chatgpt-shopping stays excluded everywhere (#155).

-- ── 1. ai_visibility_aggregates ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ai_visibility_aggregates(
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
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.mention_count, pr.citation_count, pr.mention_position, pr.competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'
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
  brand_agg AS (
    SELECT
      COUNT(*)                                              AS answers,
      COUNT(*) FILTER (WHERE mention_count > 0)             AS mention_answers,
      COUNT(*) FILTER (WHERE citation_count > 0)            AS citation_answers,
      AVG(1.0 / mention_position)
        FILTER (WHERE mention_position IS NOT NULL)         AS position_factor
    FROM filtered
  ),
  comp_agg AS (
    SELECT
      cm.value->>'competitor_id'                            AS competitor_id,
      MAX(cm.value->>'name')                                AS name,
      COUNT(*) FILTER (
        WHERE COALESCE((cm.value->>'mention_count')::int, 0) > 0)
                                                            AS mention_answers,
      COUNT(*) FILTER (
        WHERE COALESCE((cm.value->>'citation_count')::int, 0) > 0)
                                                            AS citation_answers,
      AVG(1.0 / (cm.value->>'mention_position')::numeric)
        FILTER (WHERE (cm.value->>'mention_position') IS NOT NULL)
                                                            AS position_factor
    FROM filtered f,
         LATERAL jsonb_array_elements(
           COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
    WHERE cm.value ? 'competitor_id'
      AND EXISTS (
        SELECT 1 FROM public.competitors c
        WHERE c.id::text = cm.value->>'competitor_id'
          AND c.brand_id = p_brand_id
      )
    GROUP BY cm.value->>'competitor_id'
  )
  SELECT jsonb_build_object(
    'answers',          b.answers,
    'mention_answers',  b.mention_answers,
    'citation_answers', b.citation_answers,
    'position_factor',  b.position_factor,
    'by_competitor', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'competitor_id',    ca.competitor_id,
                'name',             ca.name,
                'mention_answers',  ca.mention_answers,
                'citation_answers', ca.citation_answers,
                'position_factor',  ca.position_factor)
              ORDER BY ca.mention_answers DESC, ca.competitor_id)
       FROM comp_agg ca),
      '[]'::jsonb)
  )
  FROM brand_agg b;
$$;

GRANT EXECUTE ON FUNCTION public.ai_visibility_aggregates(uuid, text, text[], text, timestamptz, timestamptz, uuid, uuid)
  TO authenticated;

-- ── 2. prompt_visibility_summaries + components ──────────────────────────────

DROP FUNCTION public.prompt_visibility_summaries(uuid, timestamptz);

CREATE FUNCTION public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz DEFAULT NULL
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
  GROUP BY pr.prompt_id
$$;

GRANT EXECUTE ON FUNCTION public.prompt_visibility_summaries(uuid, timestamptz)
  TO authenticated;

-- ── 3. visibility_rate_trend + per-day components ────────────────────────────

CREATE OR REPLACE FUNCTION public.visibility_rate_trend(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.prompt_id, pr.mention_count, pr.citation_count, pr.mention_position,
           pr.competitor_mentions,
           (pr.created_at AT TIME ZONE 'UTC')::date AS day
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  brand_daily AS (
    SELECT day,
           COUNT(DISTINCT prompt_id)                         AS prompt_count,
           COUNT(DISTINCT prompt_id)
             FILTER (WHERE mention_count > 0 OR citation_count > 0)
                                                             AS visible_prompts,
           COUNT(*)                                          AS answers,
           COUNT(*) FILTER (WHERE mention_count > 0)         AS mention_answers,
           COUNT(*) FILTER (WHERE citation_count > 0)        AS citation_answers,
           AVG(1.0 / mention_position)
             FILTER (WHERE mention_position IS NOT NULL)     AS position_factor
    FROM filtered
    GROUP BY day
  ),
  comp_daily AS (
    SELECT f.day,
           cm.value->>'competitor_id' AS competitor_id,
           COUNT(DISTINCT f.prompt_id)
             FILTER (WHERE COALESCE((cm.value->>'mention_count')::int, 0) > 0
                        OR COALESCE((cm.value->>'citation_count')::int, 0) > 0
                        OR COALESCE((cm.value->>'visibility_score')::numeric, 0) > 0)
                                      AS visible_prompts,
           COUNT(*) FILTER (
             WHERE COALESCE((cm.value->>'mention_count')::int, 0) > 0)
                                      AS mention_answers,
           COUNT(*) FILTER (
             WHERE COALESCE((cm.value->>'citation_count')::int, 0) > 0)
                                      AS citation_answers,
           AVG(1.0 / (cm.value->>'mention_position')::numeric)
             FILTER (WHERE (cm.value->>'mention_position') IS NOT NULL)
                                      AS position_factor
    FROM filtered f,
         LATERAL jsonb_array_elements(
           COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
    WHERE cm.value ? 'competitor_id'
      AND EXISTS (
        SELECT 1 FROM public.competitors c
        WHERE c.id::text = cm.value->>'competitor_id'
          AND c.brand_id = p_brand_id
      )
    GROUP BY f.day, cm.value->>'competitor_id'
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'day',              bd.day,
      'prompt_count',     bd.prompt_count,
      'visible_prompts',  bd.visible_prompts,
      'answers',          bd.answers,
      'mention_answers',  bd.mention_answers,
      'citation_answers', bd.citation_answers,
      'position_factor',  bd.position_factor,
      'competitors', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
                  'competitor_id',    cd.competitor_id,
                  'visible_prompts',  cd.visible_prompts,
                  'mention_answers',  cd.mention_answers,
                  'citation_answers', cd.citation_answers,
                  'position_factor',  cd.position_factor))
         FROM comp_daily cd WHERE cd.day = bd.day),
        '[]'::jsonb)
    ) ORDER BY bd.day),
    '[]'::jsonb)
  FROM brand_daily bd;
$$;

GRANT EXECUTE ON FUNCTION public.visibility_rate_trend(uuid, text, text[], text, timestamptz, timestamptz, uuid)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00041_prompt_visibility_summary_date_to.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Add an upper bound to prompt_visibility_summaries.
--
-- The Daily Pulse "top prompt movers" highlight needs per-prompt score
-- components over two adjacent windows (last 7 days vs the 7 before), and
-- the function only accepted a lower bound. p_date_to defaults to NULL, so
-- every existing caller keeps its behavior.
--
-- The argument list changes, so the old signature must be dropped first.

DROP FUNCTION public.prompt_visibility_summaries(uuid, timestamptz);

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

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00042_visibility_rate_trend_position_n.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Add position_n (answers carrying a mention_position) to the per-day
-- buckets of visibility_rate_trend, for the brand and each competitor.
--
-- The trend chart is switching from "that day's score" points to a rolling
-- window (each day's point = the score over the trailing selected window),
-- so the line's last point always equals the headline card exactly. Rolling
-- position factors need the weighted average across days:
--   rolling_pf = Σ(position_factor_d × position_n_d) / Σ(position_n_d)
-- which requires the per-day weight. Purely additive JSON keys — existing
-- consumers are unaffected.

CREATE OR REPLACE FUNCTION public.visibility_rate_trend(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.prompt_id, pr.mention_count, pr.citation_count, pr.mention_position,
           pr.competitor_mentions,
           (pr.created_at AT TIME ZONE 'UTC')::date AS day
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  brand_daily AS (
    SELECT day,
           COUNT(DISTINCT prompt_id)                         AS prompt_count,
           COUNT(DISTINCT prompt_id)
             FILTER (WHERE mention_count > 0 OR citation_count > 0)
                                                             AS visible_prompts,
           COUNT(*)                                          AS answers,
           COUNT(*) FILTER (WHERE mention_count > 0)         AS mention_answers,
           COUNT(*) FILTER (WHERE citation_count > 0)        AS citation_answers,
           AVG(1.0 / mention_position)
             FILTER (WHERE mention_position IS NOT NULL)     AS position_factor,
           COUNT(*) FILTER (WHERE mention_position IS NOT NULL)
                                                             AS position_n
    FROM filtered
    GROUP BY day
  ),
  comp_daily AS (
    SELECT f.day,
           cm.value->>'competitor_id' AS competitor_id,
           COUNT(DISTINCT f.prompt_id)
             FILTER (WHERE COALESCE((cm.value->>'mention_count')::int, 0) > 0
                        OR COALESCE((cm.value->>'citation_count')::int, 0) > 0
                        OR COALESCE((cm.value->>'visibility_score')::numeric, 0) > 0)
                                      AS visible_prompts,
           COUNT(*) FILTER (
             WHERE COALESCE((cm.value->>'mention_count')::int, 0) > 0)
                                      AS mention_answers,
           COUNT(*) FILTER (
             WHERE COALESCE((cm.value->>'citation_count')::int, 0) > 0)
                                      AS citation_answers,
           AVG(1.0 / (cm.value->>'mention_position')::numeric)
             FILTER (WHERE (cm.value->>'mention_position') IS NOT NULL)
                                      AS position_factor,
           COUNT(*) FILTER (WHERE (cm.value->>'mention_position') IS NOT NULL)
                                      AS position_n
    FROM filtered f,
         LATERAL jsonb_array_elements(
           COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
    WHERE cm.value ? 'competitor_id'
      AND EXISTS (
        SELECT 1 FROM public.competitors c
        WHERE c.id::text = cm.value->>'competitor_id'
          AND c.brand_id = p_brand_id
      )
    GROUP BY f.day, cm.value->>'competitor_id'
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'day',              bd.day,
      'prompt_count',     bd.prompt_count,
      'visible_prompts',  bd.visible_prompts,
      'answers',          bd.answers,
      'mention_answers',  bd.mention_answers,
      'citation_answers', bd.citation_answers,
      'position_factor',  bd.position_factor,
      'position_n',       bd.position_n,
      'competitors', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
                  'competitor_id',    cd.competitor_id,
                  'visible_prompts',  cd.visible_prompts,
                  'mention_answers',  cd.mention_answers,
                  'citation_answers', cd.citation_answers,
                  'position_factor',  cd.position_factor,
                  'position_n',       cd.position_n))
         FROM comp_daily cd WHERE cd.day = bd.day),
        '[]'::jsonb)
    ) ORDER BY bd.day),
    '[]'::jsonb)
  FROM brand_daily bd;
$$;

GRANT EXECUTE ON FUNCTION public.visibility_rate_trend(uuid, text, text[], text, timestamptz, timestamptz, uuid)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00043_brand_state.sql
-- ─────────────────────────────────────────────────────────────────────────
-- US state-level geo-targeting for AI prompt tracking (#554).
--
-- Optional two-letter USPS state code on the brand. NULL = nationwide, which
-- keeps the current behavior for every existing brand. The tracking worker
-- forwards it to the scraping provider only for US brands on the AI endpoints
-- (Google AIO / AI Mode use a different sub-country mechanism and never see
-- this column).

ALTER TABLE public.brands
  ADD COLUMN state text
  CHECK (state IS NULL OR state ~ '^[A-Z]{2}$');

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00044_tracking_runs.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Tracking run ledger — stable insights 24h window.
--
-- One row per FULL tracking run (cron or manual Run All; single-prompt runs
-- don't stamp). The insights 24h view anchors to the latest COMPLETED run so
-- the daily refresh can't show an empty window or a shrinking prompt count
-- while results stream in: the dashboard keeps the last completed run's
-- window and switches to the new run atomically when the worker finishes
-- draining.
--
-- The worker (service role) writes; org members read — an uncompleted row
-- also powers the "tracking in progress" banner for cron-started runs, which
-- browsers previously couldn't see (the old banner only knew about jobs
-- started from that same browser via localStorage).

CREATE TABLE public.tracking_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    source text NOT NULL DEFAULT 'manual',
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    result_count integer,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tracking_runs_brand_completed_idx
    ON public.tracking_runs (brand_id, completed_at DESC NULLS LAST);
CREATE INDEX tracking_runs_brand_started_idx
    ON public.tracking_runs (brand_id, started_at DESC);

ALTER TABLE public.tracking_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tracking_runs: member select" ON public.tracking_runs
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

GRANT SELECT ON public.tracking_runs TO authenticated;

-- Backfill: a synthetic completed run per brand anchored at its newest
-- result, so the stable-window behavior applies immediately instead of
-- waiting for each brand's next real run. Reads prompt_results only —
-- existing data is untouched.
WITH latest AS (
    SELECT brand_id, max(created_at) AS last_at
    FROM public.prompt_results
    GROUP BY brand_id
)
INSERT INTO public.tracking_runs (brand_id, source, started_at, completed_at, result_count)
SELECT l.brand_id,
       'backfill',
       l.last_at - interval '2 hours',
       l.last_at,
       (SELECT count(*)
          FROM public.prompt_results pr
         WHERE pr.brand_id = l.brand_id
           AND pr.created_at > l.last_at - interval '2 hours')
FROM latest l;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00045_integration_connections.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Integration connections — Settings → Integrations surface (#577).
--
-- One row per (organization, provider). Only google-search-console for now;
-- the table is the generic surface future integrations plug into. OAuth
-- tokens never touch this table — Composio stores them; we keep only the
-- Composio account/entity ids and the connection status.
--
-- The server (service role) writes; org members read so the card state is
-- visible to teammates. Admin/manager write policies exist for completeness
-- even though the normal write path is the service role.

CREATE TABLE public.integration_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider text NOT NULL,
    composio_account_id text,
    composio_entity_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    connected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, provider)
);

ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integration_connections: member select" ON public.integration_connections
    FOR SELECT USING (
        organization_id IN (
            SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid()
        )
    );

CREATE POLICY "integration_connections: admin write" ON public.integration_connections
    FOR ALL USING (
        organization_id IN (
            SELECT p.organization_id FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role = ANY (ARRAY['admin'::public.user_role, 'manager'::public.user_role])
        )
    );

GRANT SELECT ON public.integration_connections TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00046_brand_gsc_property.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Brand → Search Console property mapping (#642).
--
-- The GSC connection is org-level (integration_connections); the property
-- choice is brand-level. Exactly one property per brand, so a column beats a
-- mapping table. Values are GSC siteUrl strings: either a URL-prefix
-- ("https://example.com/") or a domain property ("sc-domain:example.com").
-- Kept on disconnect so reconnecting restores functionality without
-- re-picking.

ALTER TABLE public.brands ADD COLUMN gsc_property text;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00047_gsc_query_stats.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Search Console query stats (#644) — daily per-query rows pulled through
-- the Composio connection for every brand mapped to a GSC property.
--
-- The sync (service role) writes with upserts on (brand_id, query, date);
-- org members read. Retention/pruning comes with the first consumer.

CREATE TABLE public.gsc_query_stats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    query text NOT NULL,
    date date NOT NULL,
    clicks integer NOT NULL DEFAULT 0,
    impressions integer NOT NULL DEFAULT 0,
    ctr double precision NOT NULL DEFAULT 0,
    position double precision NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (brand_id, query, date)
);

CREATE INDEX gsc_query_stats_brand_date_idx
    ON public.gsc_query_stats (brand_id, date DESC);

ALTER TABLE public.gsc_query_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gsc_query_stats: member select" ON public.gsc_query_stats
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

GRANT SELECT ON public.gsc_query_stats TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00048_gsc_suggestion_support.sql
-- ─────────────────────────────────────────────────────────────────────────
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

-- ── Recovered table definition (#709) ────────────────────────────────────────
--
-- prompt_suggestions was created directly against the hosted database and
-- never written back into a migration, so the ALTERs below had nothing to
-- alter on a clean one: `supabase db reset` failed here with 42P01, and
-- schema.sql inherited the same gap. Every documented fresh-install path was
-- broken from the moment this migration shipped.
--
-- The definition belongs *here* rather than in a later numbered file, because
-- the very next statement alters this table — a migration appended at the end
-- would never be reached. Editing a shipped migration is normally off-limits;
-- this one is safe because every clause is idempotent and any database that
-- already ran 00048 will not run it again.
--
-- Deliberately the table as it was BEFORE the ALTERs below: no source_data
-- column, and the two-value source check. Transcribing a live database's
-- current shape instead would leave a fresh install failing one line later on
-- "column source_data already exists".
CREATE TABLE IF NOT EXISTS "public"."prompt_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "suggested_text" "text" NOT NULL,
    "topic_name" "text",
    "topic_id" "uuid",
    "reason" "text",
    "est_volume" integer,
    "source" "text" DEFAULT 'llm'::"text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "added_prompt_id" "uuid",
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '48:00:00'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prompt_suggestions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prompt_suggestions_source_check" CHECK (
        "source" = ANY (ARRAY['llm'::"text", 'heuristic'::"text"])
    ),
    CONSTRAINT "prompt_suggestions_status_check" CHECK (
        "status" = ANY (ARRAY['new'::"text", 'added'::"text", 'dismissed'::"text"])
    ),
    CONSTRAINT "prompt_suggestions_brand_id_fkey" FOREIGN KEY ("brand_id")
        REFERENCES "public"."brands"("id") ON DELETE CASCADE,
    CONSTRAINT "prompt_suggestions_topic_id_fkey" FOREIGN KEY ("topic_id")
        REFERENCES "public"."topics"("id") ON DELETE SET NULL,
    CONSTRAINT "prompt_suggestions_added_prompt_id_fkey" FOREIGN KEY ("added_prompt_id")
        REFERENCES "public"."prompts"("id") ON DELETE SET NULL
);

ALTER TABLE "public"."prompt_suggestions" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_prompt_suggestions_brand_status"
    ON "public"."prompt_suggestions" ("brand_id", "status", "generated_at" DESC);

-- One live suggestion per brand per text, case-insensitively. Partial on
-- 'new' so an accepted or dismissed suggestion never blocks a later one.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_prompt_suggestions_brand_text_active"
    ON "public"."prompt_suggestions" ("brand_id", "lower"("suggested_text"))
    WHERE ("status" = 'new'::"text");

ALTER TABLE "public"."prompt_suggestions" ENABLE ROW LEVEL SECURITY;

-- Writes go through the Express server's service-role client; these cover the
-- web app's direct reads and the accept/dismiss updates it performs.
CREATE POLICY "prompt_suggestions: member select" ON "public"."prompt_suggestions"
    FOR SELECT USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
        )
    );

CREATE POLICY "prompt_suggestions: admin/manager/analyst update" ON "public"."prompt_suggestions"
    FOR UPDATE USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
              AND "p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'analyst'::"public"."user_role"])
        )
    );

GRANT ALL ON TABLE "public"."prompt_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."prompt_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_suggestions" TO "service_role";

-- ─────────────────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00049_cloro_pending_tasks.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Cloro pending-task queue (#652) — backfills DDL that was only ever applied
-- to the hosted database and never committed here, so a fresh install created
-- every other table and then failed on this one:
--
--   PGRST205: Could not find the table 'public.cloro_pending_tasks'
--
-- The table is a transient submit-queue: the tracking worker inserts a row per
-- task handed to the scraper, /cloro/callback deletes it when the result
-- arrives, and cleanupStalePendingTasks sweeps whatever the provider never
-- delivered. It holds no history — a fresh install starting empty is correct.
--
-- Guarded with IF NOT EXISTS throughout so databases that already have the
-- table (every deployment predating this file) apply it as a no-op.

CREATE TABLE IF NOT EXISTS public.cloro_pending_tasks (
    task_id text PRIMARY KEY,
    prompt_id uuid NOT NULL REFERENCES public.prompts(id) ON DELETE CASCADE,
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    scraper_id text NOT NULL,
    region text,
    submitted_at timestamptz NOT NULL DEFAULT now()
);

-- brand_id: the drain loop polls "what is still pending for this brand" on
-- every tick of a run. submitted_at: the stale sweep and the ghost-task exit
-- both filter by age (#687).
CREATE INDEX IF NOT EXISTS idx_cloro_pending_tasks_brand_id
    ON public.cloro_pending_tasks (brand_id);
CREATE INDEX IF NOT EXISTS idx_cloro_pending_tasks_submitted_at
    ON public.cloro_pending_tasks (submitted_at);

-- RLS on with no policies: only the service role touches this table, and it
-- bypasses RLS. Anything reaching it through an anon/authenticated key gets
-- nothing, which is the intent — task ids are provider-side handles.
ALTER TABLE public.cloro_pending_tasks ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00050_content_opportunity_aggregates.sql
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.content_opportunity_aggregates(
  p_brand_id uuid,
  p_status text DEFAULT NULL,
  p_impact text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS TABLE (
  avg_score numeric,
  high_impact_count bigint,
  sent_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(AVG(co.opportunity_score), 0) AS avg_score,
    COUNT(*) FILTER (
      WHERE co.impact = 'high'
    ) AS high_impact_count,
    COUNT(*) FILTER (
      WHERE co.status IN ('sent', 'in_progress', 'done')
    ) AS sent_count
  FROM public.content_opportunities co
  WHERE co.brand_id = p_brand_id
    AND (p_status IS NULL OR co.status = p_status)
    AND (p_impact IS NULL OR co.impact = p_impact)
    AND (p_type IS NULL OR co.type = p_type)
    AND (
      p_q IS NULL
      OR co.title ILIKE '%' || p_q || '%'
      OR co.description ILIKE '%' || p_q || '%'
    );
$$;

GRANT EXECUTE ON FUNCTION public.content_opportunity_aggregates(
  uuid,
  text,
  text,
  text,
  text
) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00051_brand_ga_property.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Brand → Google Analytics property mapping (#694).
--
-- Mirrors gsc_property (00046): the Analytics connection is org-level
-- (integration_connections), the property choice is brand-level, and exactly
-- one property per brand means a column beats a mapping table. Values are the
-- bare GA4 numeric property id ("365372770") rather than the API's
-- "properties/365372770" resource name — the prefix is constant and is added
-- back when calling the Admin/Data APIs. Kept on disconnect so reconnecting
-- restores functionality without re-picking.

ALTER TABLE public.brands ADD COLUMN ga_property_id text;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00052_sent_pulses_window_dedupe.sql
-- ─────────────────────────────────────────────────────────────────────────
-- One Daily Pulse per brand per tracking window (#701).
--
-- sent_pulses already has a unique (brand_id, pulse_date) key, but the daily
-- KPI window is anchored to the tracking-run ledger rather than to the
-- calendar: two pulses filed under different dates repeat each other verbatim
-- whenever the anchor has not moved between them. That is how the catch-up
-- sweep's recovery mail and the brand's own end-of-run mail went out an hour
-- apart with identical numbers, and how a brand whose runs stopped stamping
-- received the same figures again on each following day.
--
-- The engine checks for a matching window before it computes, so this index is
-- the race guard rather than the primary mechanism — same role the date key
-- plays for same-day double-fires.
--
-- Partial on the extracted path so rows written before this migration — which
-- carry no payload->window at all — are excluded instead of colliding on NULL.
-- Weekly digests and brands with no completed run are indexed but can never
-- conflict: their window ends at the wall clock, which differs on every call.
CREATE UNIQUE INDEX IF NOT EXISTS sent_pulses_brand_window_key
    ON public.sent_pulses (brand_id, ((payload -> 'window' ->> 'to')))
    WHERE (payload -> 'window' ->> 'to') IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00053_ga_traffic_stats.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Google Analytics traffic sync (#704) — daily GA4 rows pulled through the
-- Composio connection for every brand mapped to a property (#694).
--
-- Three tables rather than one, because they answer different questions and
-- must never be added together:
--
--   ga_ai_traffic_stats  what AI sources brought, per landing page
--   ga_page_stats        what a landing page is worth in total, all sources
--   ga_item_stats        what actually sold, product-scoped
--
-- The first two overlap by design: the AI table is a slice of the same
-- traffic the page table totals. Summing them double-counts, which is the
-- same trap this integration already avoids with ai_traffic_logs (our own
-- snippet counts these visits a second time). Nothing in the pipeline joins
-- or sums across origins; how the numbers are presented together is a
-- decision for the surface phase.
--
-- Writes are service-role upserts keyed on the natural grain, so re-running a
-- day rewrites it instead of duplicating. Org members read.

-- ── AI-sourced traffic, by landing page ─────────────────────────────────────
--
-- `source` keeps GA4's raw sessionSource string and `platform` the normalised
-- name. The raw value is not redundant: one engine arrives under several
-- source strings, and keeping what was actually observed is what lets the
-- classification list be extended from real data instead of guesswork.
--
-- Two page columns on purpose. `landing_page_query` is the full entry URL,
-- which is what attribution needs — this table is small enough to afford the
-- cardinality (a live property produced 96 rows over 90 days). `landing_page`
-- drops the query string so it joins the page totals below, which cannot
-- afford it: on the same property the query string multiplied distinct pages
-- by 8.8, and a shop with faceted filters is far worse.
CREATE TABLE public.ga_ai_traffic_stats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    date date NOT NULL,
    source text NOT NULL,
    platform text,
    landing_page text NOT NULL DEFAULT '',
    landing_page_query text NOT NULL DEFAULT '',
    sessions integer NOT NULL DEFAULT 0,
    engaged_sessions integer NOT NULL DEFAULT 0,
    key_events integer NOT NULL DEFAULT 0,
    total_users integer NOT NULL DEFAULT 0,
    transactions integer NOT NULL DEFAULT 0,
    purchase_revenue double precision NOT NULL DEFAULT 0,
    engagement_duration_seconds integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (brand_id, date, source, landing_page_query)
);

CREATE INDEX ga_ai_traffic_stats_brand_page_idx
    ON public.ga_ai_traffic_stats (brand_id, landing_page);

CREATE INDEX ga_ai_traffic_stats_brand_date_idx
    ON public.ga_ai_traffic_stats (brand_id, date DESC);

-- ── Landing-page totals, every source ───────────────────────────────────────
--
-- "How much is this page worth to the business" cannot be answered from the
-- AI slice: a page that converts well overall is the interesting one when its
-- AI visibility is weak, and that comparison needs the page's full figures.
--
-- This is the table that grows: one row per page per day, and a large shop
-- can have tens of thousands of pages taking traffic on any given day. Two
-- things bound it — the path without its query string, and a per-day ceiling
-- on how many pages are kept (PAGE_DAILY_LIMIT in ga-sync.js). Pages are
-- ordered so anything converting survives the cut whatever its session count;
-- what gets dropped is the one-session tail, which no ranking of commercial
-- value would have surfaced anyway.
CREATE TABLE public.ga_page_stats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    date date NOT NULL,
    landing_page text NOT NULL DEFAULT '',
    sessions integer NOT NULL DEFAULT 0,
    engaged_sessions integer NOT NULL DEFAULT 0,
    key_events integer NOT NULL DEFAULT 0,
    total_users integer NOT NULL DEFAULT 0,
    transactions integer NOT NULL DEFAULT 0,
    purchase_revenue double precision NOT NULL DEFAULT 0,
    engagement_duration_seconds integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (brand_id, date, landing_page)
);

CREATE INDEX ga_page_stats_brand_date_idx
    ON public.ga_page_stats (brand_id, date DESC);

-- ── Product rows ────────────────────────────────────────────────────────────
--
-- Item-scoped and deliberately not joined to a page: a GA4 purchase fires on
-- the checkout page, so pairing item metrics with a page dimension would
-- attribute every sale to /checkout. Which entry page produced sales lives in
-- the two tables above; what sold lives here.
--
-- Absent ecommerce tracking is normal, not an error — properties without it
-- simply return no rows.
CREATE TABLE public.ga_item_stats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    date date NOT NULL,
    item_id text NOT NULL DEFAULT '',
    item_name text NOT NULL DEFAULT '',
    item_category text NOT NULL DEFAULT '',
    items_viewed integer NOT NULL DEFAULT 0,
    items_added_to_cart integer NOT NULL DEFAULT 0,
    items_purchased integer NOT NULL DEFAULT 0,
    item_revenue double precision NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (brand_id, date, item_id, item_name)
);

CREATE INDEX ga_item_stats_brand_date_idx
    ON public.ga_item_stats (brand_id, date DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.ga_ai_traffic_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_page_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_item_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ga_ai_traffic_stats: member select" ON public.ga_ai_traffic_stats
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

CREATE POLICY "ga_page_stats: member select" ON public.ga_page_stats
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

CREATE POLICY "ga_item_stats: member select" ON public.ga_item_stats
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

GRANT SELECT ON public.ga_ai_traffic_stats TO authenticated;
GRANT SELECT ON public.ga_page_stats TO authenticated;
GRANT SELECT ON public.ga_item_stats TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00054_prompt_suggestions_ga_source.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Google Analytics as a prompt-suggestion source (#705).
--
-- The check constraint predates the Analytics pipeline; without 'ga' the
-- suggestion insert fails outright rather than degrading, so this has to land
-- with the generator that produces those rows.
ALTER TABLE public.prompt_suggestions DROP CONSTRAINT prompt_suggestions_source_check;
ALTER TABLE public.prompt_suggestions ADD CONSTRAINT prompt_suggestions_source_check
    CHECK (source = ANY (ARRAY['llm'::text, 'heuristic'::text, 'gsc'::text, 'ga'::text]));

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00055_prompt_visibility_summaries_date_to.sql
-- ─────────────────────────────────────────────────────────────────────────
-- prompt_visibility_summaries — redundant re-declaration (#713).
--
-- This migration adds nothing. Migration 00041 already gave the function its
-- p_date_to bound, for the Daily Pulse movers highlight, and the body below
-- is byte-identical to the one 00041 installs.
--
-- It was written on the mistaken belief that the hosted database carried a
-- three-argument version no migration produced. It did carry one — from
-- 00041, which a truncated search had hidden. There was no drift, and nothing
-- here repairs anything.
--
-- Kept rather than deleted: it is already applied to the hosted database and
-- recorded in schema_migrations, and removing an applied migration is a worse
-- problem than an inert one. Both signatures are dropped conditionally, so it
-- is a no-op wherever it runs. Do not copy this file as a pattern.

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

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00056_page_opportunities.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Page opportunities: valuable pages AI engines are not sending traffic to
-- (#719, Phase 5 detection).
--
-- Named for its key, not just its subject, because content_opportunities
-- already exists and means something different. That table is prompt-keyed
-- and LLM-written: "what content should I make, given prompts where I am
-- weak". This one is page-keyed and deterministic: "which of my pages earn,
-- and get nothing from AI". A reader can tell them apart by the key in the
-- name, and a surface can show them together later without either having to
-- pretend to be the other.
--
-- Detection is pure SQL and JavaScript arithmetic — no model runs in this
-- path. Enrichment, clustering and the full lifecycle are deliberately not
-- here; they need volume this has not produced yet.
--
-- One row per (brand, page, kind), upserted daily. A finding that stops
-- qualifying is stamped resolved_at rather than deleted, so the list can show
-- that something improved instead of silently shrinking.

CREATE TABLE public.page_opportunities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    landing_page text NOT NULL,
    kind text NOT NULL,

    -- Which signal ranked this page, and where it ranked. Stored rather than
    -- inferred because the answer differs per property: a shop is ranked on
    -- money, a site with no ecommerce and no conversion events on engagement.
    -- Every surface must say which one it used — calling an engagement rank
    -- "your most valuable page" would be a true sentence about the wrong
    -- thing.
    value_signal text NOT NULL,
    value_percentile numeric NOT NULL,
    value_rank integer NOT NULL,

    -- The figures the finding was raised from, so it can be explained and
    -- audited without recomputing the window.
    sessions integer NOT NULL DEFAULT 0,
    engaged_sessions integer NOT NULL DEFAULT 0,
    key_events integer NOT NULL DEFAULT 0,
    transactions integer NOT NULL DEFAULT 0,
    revenue double precision NOT NULL DEFAULT 0,
    engagement_seconds integer NOT NULL DEFAULT 0,
    ai_sessions integer NOT NULL DEFAULT 0,
    ai_platforms text[] NOT NULL DEFAULT '{}',

    window_days integer NOT NULL,
    first_detected_at timestamptz NOT NULL DEFAULT now(),
    last_detected_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,

    CONSTRAINT page_opportunities_kind_check
        CHECK (kind = ANY (ARRAY['no_ai_traffic'::text])),
    CONSTRAINT page_opportunities_signal_check
        CHECK (value_signal = ANY (ARRAY[
            'revenue'::text, 'transactions'::text, 'key_events'::text, 'engagement'::text
        ])),
    UNIQUE (brand_id, landing_page, kind)
);

-- The list surface reads open findings for one brand, worst gap first.
CREATE INDEX page_opportunities_brand_open_idx
    ON public.page_opportunities (brand_id, value_percentile DESC)
    WHERE resolved_at IS NULL;

ALTER TABLE public.page_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "page_opportunities: member select" ON public.page_opportunities
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

GRANT SELECT ON public.page_opportunities TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00057_topics_overview_aggregates.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Topics overview, aggregated in Postgres (#721).
--
-- The page downloaded the brand's entire 30-day result set to compute twenty
-- table rows: 33 sequential requests, 73 MB of JSON, ~19 s on the largest
-- brand. Two thirds of that was one column — competitor_mentions, averaging
-- eleven entries per row — fetched to derive a single top competitor per
-- topic. The rest was pagination: .range() becomes LIMIT/OFFSET, so page k
-- re-walked k×1000 rows, ~563k buffer touches to read 32k rows once.
--
-- Everything below is what the client was doing in JavaScript, moved to where
-- the data already is. The AI Visibility Score itself stays in JS
-- (lib/visibility-score) over ~20 rows, so the Topics page and the Insights
-- headline keep computing it from one implementation.
--
-- Windows are resolved from now() inside the function rather than passed in:
-- the caller's clock and the database's would otherwise disagree about which
-- answers fall in "the last 7 days", and the page has no reason to care.

CREATE FUNCTION public.topics_overview_aggregates(p_brand_id uuid)
RETURNS TABLE (
  topic_id             uuid,
  answers              bigint,
  mention_answers      bigint,
  citation_answers     bigint,
  pos_sum              double precision,
  pos_n                bigint,
  cur_answers          bigint,
  cur_mention_answers  bigint,
  cur_citation_answers bigint,
  cur_pos_sum          double precision,
  cur_pos_n            bigint,
  prev_answers         bigint,
  prev_mention_answers bigint,
  prev_citation_answers bigint,
  prev_pos_sum         double precision,
  prev_pos_n           bigint,
  total_mentions       bigint,
  total_citations      bigint,
  comp_mentions        bigint,
  active_prompts       bigint,
  visible_prompts      bigint,
  last_run_at          timestamptz,
  competitors          jsonb,
  daily                jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH bounds AS (
  SELECT now() - interval '30 days' AS since_30d,
         now() - interval '7 days'  AS cur_from,
         now() - interval '14 days' AS prev_from,
         -- Start of the 14th day back in UTC, so the earliest bucket the page
         -- draws is complete rather than clipped at the current time of day.
         date_trunc('day', (now() AT TIME ZONE 'UTC') - interval '13 days')
           AT TIME ZONE 'UTC' AS spark_from
),
-- Answers in the window, carrying the topic their prompt belongs to. The
-- prompt_sets join is what scopes prompts to this brand; prompt_results is
-- filtered on brand_id as well, matching what the page did client-side.
rows AS (
  SELECT p.topic_id,
         pr.prompt_id,
         pr.created_at,
         COALESCE(pr.mention_count, 0)  AS mentions,
         COALESCE(pr.citation_count, 0) AS citations,
         pr.mention_position,
         (COALESCE(pr.mention_count, 0) > 0 OR COALESCE(pr.citation_count, 0) > 0) AS visible
  FROM public.prompt_results pr
  JOIN public.prompts p        ON p.id = pr.prompt_id
  JOIN public.prompt_sets ps   ON ps.id = p.prompt_set_id
  CROSS JOIN bounds b
  WHERE pr.brand_id = p_brand_id
    AND ps.brand_id = p_brand_id
    AND p.topic_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 - isolate from analytics
    AND pr.created_at >= b.since_30d
),
-- Competitor share per topic. Summed straight from the array: the client
-- folded duplicates within a row before adding them up, which reaches the
-- same total.
--
-- Scans prompt_results again rather than reusing `rows`. `rows` is referenced
-- several times so Postgres materialises it, and carrying competitor_mentions
-- through that materialisation spills 32k detoasted jsonb values to temp
-- files — 4.5 s and 7,500 temp blocks, measured. Reading the column only
-- where it is needed keeps the shared CTE lean.
comps AS (
  SELECT p.topic_id,
         cm.value ->> 'competitor_id' AS competitor_id,
         MIN(cm.value ->> 'name')     AS name,
         SUM(COALESCE((cm.value ->> 'mention_count')::bigint, 0)) AS mentions
  FROM public.prompt_results pr
  JOIN public.prompts p      ON p.id = pr.prompt_id
  JOIN public.prompt_sets ps ON ps.id = p.prompt_set_id
  CROSS JOIN bounds b
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.competitor_mentions, '[]'::jsonb)) cm
  WHERE pr.brand_id = p_brand_id
    AND ps.brand_id = p_brand_id
    AND p.topic_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'
    AND pr.created_at >= b.since_30d
  GROUP BY p.topic_id, cm.value ->> 'competitor_id'
),
comp_totals AS (
  SELECT topic_id,
         SUM(mentions) AS comp_mentions,
         jsonb_object_agg(competitor_id, jsonb_build_object('name', name, 'sov', mentions)) AS competitors
  FROM comps
  GROUP BY topic_id
),
-- Fourteen daily buckets for the sparkline. Only the days the page draws.
--
-- Keyed in UTC, because the client builds the same keys from
-- `Date.toISOString()` — reading them in the database's session timezone
-- would shift every bucket by the offset and silently redraw the trend.
daily AS (
  SELECT d.topic_id,
         jsonb_object_agg(d.day, jsonb_build_object('visible', d.visible, 'count', d.count)) AS daily
  FROM (
    SELECT r2.topic_id,
           to_char(r2.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           COUNT(*) FILTER (WHERE r2.visible) AS visible,
           COUNT(*) AS count
    FROM rows r2
    CROSS JOIN bounds b
    WHERE r2.created_at >= b.spark_from
    GROUP BY r2.topic_id, to_char(r2.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  ) d
  GROUP BY d.topic_id
),
main AS (
  SELECT r.topic_id,
         COUNT(*)::bigint                                          AS answers,
         COUNT(*) FILTER (WHERE r.mentions > 0)::bigint            AS mention_answers,
         COUNT(*) FILTER (WHERE r.citations > 0)::bigint           AS citation_answers,
         COALESCE(SUM(1.0 / r.mention_position)
           FILTER (WHERE r.mention_position > 0), 0)::double precision AS pos_sum,
         COUNT(*) FILTER (WHERE r.mention_position > 0)::bigint    AS pos_n,

         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from)::bigint AS cur_answers,
         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from AND r.mentions > 0)::bigint
                                                                    AS cur_mention_answers,
         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from AND r.citations > 0)::bigint
                                                                    AS cur_citation_answers,
         COALESCE(SUM(1.0 / r.mention_position)
           FILTER (WHERE r.created_at >= b.cur_from AND r.mention_position > 0), 0)::double precision
                                                                    AS cur_pos_sum,
         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from AND r.mention_position > 0)::bigint
                                                                    AS cur_pos_n,

         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from)::bigint
                                                                    AS prev_answers,
         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
           AND r.mentions > 0)::bigint                              AS prev_mention_answers,
         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
           AND r.citations > 0)::bigint                             AS prev_citation_answers,
         COALESCE(SUM(1.0 / r.mention_position)
           FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
             AND r.mention_position > 0), 0)::double precision      AS prev_pos_sum,
         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
           AND r.mention_position > 0)::bigint                      AS prev_pos_n,

         COALESCE(SUM(r.mentions), 0)::bigint                       AS total_mentions,
         COALESCE(SUM(r.citations), 0)::bigint                      AS total_citations,
         COUNT(DISTINCT r.prompt_id)::bigint                        AS active_prompts,
         COUNT(DISTINCT r.prompt_id) FILTER (WHERE r.visible)::bigint AS visible_prompts,
         MAX(r.created_at)                                          AS last_run_at
  FROM rows r
  CROSS JOIN bounds b
  GROUP BY r.topic_id
)
-- The two jsonb rollups join on at the end rather than riding through the
-- GROUP BY: Postgres has no max(jsonb), and carrying them through an
-- aggregate would need a wrapper that buys nothing here.
SELECT m.topic_id,
       m.answers, m.mention_answers, m.citation_answers, m.pos_sum, m.pos_n,
       m.cur_answers, m.cur_mention_answers, m.cur_citation_answers, m.cur_pos_sum, m.cur_pos_n,
       m.prev_answers, m.prev_mention_answers, m.prev_citation_answers, m.prev_pos_sum, m.prev_pos_n,
       m.total_mentions, m.total_citations,
       COALESCE(ct.comp_mentions, 0)::bigint,
       m.active_prompts, m.visible_prompts, m.last_run_at,
       COALESCE(ct.competitors, '{}'::jsonb),
       COALESCE(dl.daily, '{}'::jsonb)
FROM main m
LEFT JOIN comp_totals ct ON ct.topic_id = m.topic_id
LEFT JOIN daily dl       ON dl.topic_id = m.topic_id
$$;

GRANT EXECUTE ON FUNCTION public.topics_overview_aggregates(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00058_prompt_result_citations.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Citations as rows (#732), phase 1: the tables and the write path.
--
-- `prompt_results.citations` holds the provider's citation array as jsonb.
-- Reading it means expanding every answer on every page load: on the largest
-- brand, 51,679 answers become 679,304 citation entries, and pulling the host
-- out of each URL costs 4.4s of the 4.6s an aggregate over that window takes —
-- above the 8s statement timeout once anything else is asked for. The Citations
-- page works around it by paging the raw rows out to the app tier instead: 50
-- sequential requests carrying 65 MB of jsonb, capped at 50,000 rows, which
-- silently truncates that same brand at 51,679.
--
-- Expanding once at write time turns that into an ordinary indexed read.
--
-- Two tables rather than one, because the naive shape does not fit. Across the
-- database there are 2,023,979 citation entries but only 449,559 distinct URLs
-- — the expensive part (url ~92 bytes, title ~63) repeats 4.5 times on
-- average. One row per citation with the text inline measures 513 MB of heap
-- against 262 MB split this way, and the instance has 2 GB of RAM to hold a
-- database that is already 1.1 GB.
--
-- Phase 1 only fills the tables; nothing reads them yet. The Citations page
-- keeps using the jsonb until phase 2 lands the aggregate RPC, so the two can
-- be compared against each other before anything switches over.

-- ─── Dictionary ──────────────────────────────────────────────────────────────

create table if not exists public.citation_urls (
  id bigint generated always as identity primary key,
  -- Truncated to 2048 chars on write. The longest URL observed is 1,333, and
  -- a btree entry cannot exceed ~2,704 bytes — without a bound, one absurd URL
  -- would fail the unique index and take the whole result insert with it.
  url text not null,
  -- Host without `www.`, lowercased. Derived from the URL at write time so a
  -- domain rollup never has to parse 2M strings; the application's
  -- extractHostname() is the single definition of how.
  domain text not null,
  -- Whatever title the provider sent the first time this URL appeared.
  -- Providers word the same page differently between answers, and one stable
  -- label beats re-deciding per citation.
  title text,
  first_seen_at timestamptz not null default now()
);

create unique index if not exists citation_urls_url_key on public.citation_urls (url);
create index if not exists citation_urls_domain_idx on public.citation_urls (domain);

-- ─── Facts ───────────────────────────────────────────────────────────────────

create table if not exists public.prompt_result_citations (
  prompt_result_id uuid not null references public.prompt_results(id) on delete cascade,
  -- Index within the answer's citation array. With prompt_result_id this is
  -- the natural identity of a citation, which is what keeps the write path and
  -- the backfill idempotent when either re-runs over the same answer.
  position integer not null,
  url_id bigint not null references public.citation_urls(id),

  -- Denormalized from the parent answer. brand_id carries the row-level
  -- security rule, which cannot be expressed through a join, and created_at
  -- lets a brand's window be read without touching prompt_results — the table
  -- whose 1 GB of TOAST this change exists to stop reading.
  brand_id uuid not null references public.brands(id) on delete cascade,
  created_at timestamptz not null,

  primary key (prompt_result_id, position)
);

-- The Citations page always asks the same question first: this brand, this
-- window. Everything else narrows what comes back.
create index if not exists prompt_result_citations_brand_created_idx
  on public.prompt_result_citations (brand_id, created_at desc);

-- Reverse lookup: which answers cited this URL.
create index if not exists prompt_result_citations_url_idx
  on public.prompt_result_citations (url_id);

-- ─── Row level security ──────────────────────────────────────────────────────

alter table public.prompt_result_citations enable row level security;

-- Mirrors prompt_results and prompt_result_shopping_cards: org members read
-- their own org's rows, the service role writes. The worker goes through
-- supabaseAdmin and bypasses RLS, but the explicit policy keeps the table
-- reachable from an authenticated surface.
create policy "citations: org member select"
  on public.prompt_result_citations
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

create policy "Service role can insert citations"
  on public.prompt_result_citations
  for insert
  with check (true);

create policy "Service role can delete citations"
  on public.prompt_result_citations
  for delete
  using (true);

-- The dictionary is shared across every organization and has no tenant column,
-- so no row-level rule can express who may read a given URL — the answer lives
-- in the join, not in the row. RLS is therefore enabled with no select policy
-- at all: direct reads are denied to everyone but the service role, and the
-- phase 2 aggregate function will reach it as SECURITY DEFINER after checking
-- the caller owns the brand it was asked about. Adding a permissive policy
-- here would let any authenticated user enumerate every URL ever cited for
-- every customer.
alter table public.citation_urls enable row level security;

create policy "Service role can insert citation urls"
  on public.citation_urls
  for insert
  with check (true);

comment on table public.prompt_result_citations is
  'One row per citation per answer (#732). Written alongside prompt_results by the tracking worker and the Cloro webhook handler, and backfilled by server/src/scripts/backfill-citations.js. Source of truth for the Citations page from phase 2 onward; prompt_results.citations remains the raw archival copy.';
comment on table public.citation_urls is
  'Deduplicated URL dictionary for prompt_result_citations. Cross-tenant by design: the same page is cited for many brands, and storing the text once is what keeps the citation table a quarter of the size it would otherwise be.';
comment on column public.prompt_result_citations.position is
  'Index within prompt_results.citations. With prompt_result_id it is the natural key that makes re-running the write path or the backfill idempotent.';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00059_citation_url_ids.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Resolve citation URLs to dictionary ids through the request body (#732).
--
-- The write path looked URLs up with a PostgREST `.in()` filter, which is
-- spelled out in the query string. That was wrong three times over: first
-- unbounded, then chunked at 100, and it still failed — URLs are
-- percent-encoded on the way into a URI, so a hundred of them at an average
-- 92 characters (and up to 1,333) exceeds the request-line and header limits
-- in front of PostgREST. The symptom was `Bad Request` from the proxy and
-- `TypeError: fetch failed` when the connection was reset, on precisely the
-- answers carrying the most citations: 182 of 174,466 after the second fix.
--
-- Chunking smaller would have been another guess at someone else's limit.
-- This removes the class instead: the URLs travel as a jsonb argument in the
-- POST body, which has no such bound, and one call both inserts what is new
-- and returns ids for everything asked about.

create or replace function public.citation_url_ids(p_urls jsonb)
returns table (id bigint, url text)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  -- p_urls: [{"url": "...", "domain": "...", "title": "..."}, ...]
  --
  -- `distinct on` because one answer can cite the same page twice, and the
  -- unique index would reject the second copy inside the same statement
  -- rather than treating it as a conflict.
  insert into public.citation_urls (url, domain, title)
  select distinct on (e.value ->> 'url')
         e.value ->> 'url',
         e.value ->> 'domain',
         nullif(e.value ->> 'title', '')
  from jsonb_array_elements(p_urls) e
  where e.value ->> 'url' is not null
    and e.value ->> 'domain' is not null
  order by e.value ->> 'url'
  on conflict (url) do nothing;

  -- Returned for every URL asked about, not only the ones just inserted:
  -- the caller needs an id per citation, and the overwhelming majority were
  -- already in the dictionary. A concurrent writer that won the insert race
  -- is picked up here too, which is what makes the call safe to run twice.
  return query
  select cu.id, cu.url
  from public.citation_urls cu
  join (
    select distinct e.value ->> 'url' as u
    from jsonb_array_elements(p_urls) e
  ) asked on asked.u = cu.url;
end;
$$;

-- The dictionary is cross-tenant and has no select policy of its own, so this
-- function is the only way in. It is SECURITY DEFINER to reach past that, and
-- therefore must not be callable by anyone who should not be writing to the
-- table: the tracking worker and the backfill both go through the service
-- role, and nothing else has any reason to call it.
revoke all on function public.citation_url_ids(jsonb) from public;
revoke all on function public.citation_url_ids(jsonb) from anon;
revoke all on function public.citation_url_ids(jsonb) from authenticated;
grant execute on function public.citation_url_ids(jsonb) to service_role;

comment on function public.citation_url_ids(jsonb) is
  'Insert any unseen citation URLs and return the dictionary id for every URL asked about. Takes its argument in the request body so a long list cannot overflow the query string, which is what broke the .in() lookup it replaces (#732).';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00060_citation_url_ids_variable_conflict.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Fix `column reference "url" is ambiguous` in citation_url_ids (#732).
--
-- `returns table (id bigint, url text)` declares those names as PL/pgSQL
-- variables, so `on conflict (url)` inside the body could mean either the
-- variable or the column, and PL/pgSQL refuses to guess. The function was
-- therefore broken for every call — 00059 shipped it having been parsed but
-- never executed, and the unit tests around it mock the database, so neither
-- could see it.
--
-- `#variable_conflict use_column` is the documented resolution: an ambiguous
-- name resolves to the column, which is what every reference in this body
-- means. Renaming the output columns would work too and would change the
-- shape the caller reads, for no benefit here.

create or replace function public.citation_url_ids(p_urls jsonb)
returns table (id bigint, url text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- p_urls: [{"url": "...", "domain": "...", "title": "..."}, ...]
  --
  -- `distinct on` because one answer can cite the same page twice, and the
  -- unique index would reject the second copy inside the same statement
  -- rather than treating it as a conflict.
  insert into public.citation_urls (url, domain, title)
  select distinct on (e.value ->> 'url')
         e.value ->> 'url',
         e.value ->> 'domain',
         nullif(e.value ->> 'title', '')
  from jsonb_array_elements(p_urls) e
  where e.value ->> 'url' is not null
    and e.value ->> 'domain' is not null
  order by e.value ->> 'url'
  on conflict (url) do nothing;

  -- Returned for every URL asked about, not only the ones just inserted:
  -- the caller needs an id per citation, and the overwhelming majority were
  -- already in the dictionary. A concurrent writer that won the insert race
  -- is picked up here too, which is what makes the call safe to run twice.
  return query
  select cu.id, cu.url
  from public.citation_urls cu
  join (
    select distinct e.value ->> 'url' as u
    from jsonb_array_elements(p_urls) e
  ) asked on asked.u = cu.url;
end;
$$;

revoke all on function public.citation_url_ids(jsonb) from public;
revoke all on function public.citation_url_ids(jsonb) from anon;
revoke all on function public.citation_url_ids(jsonb) from authenticated;
grant execute on function public.citation_url_ids(jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00061_citations_aggregate_rpcs.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Read the Citations page from prompt_result_citations (#732), phase 2.
--
-- Phase 1 wrote every citation as a row. Nothing read them: the page still
-- paged the raw answers out to the app tier — 50 sequential requests carrying
-- 65 MB of jsonb for the largest brand, capped at 50,000 rows, which silently
-- truncated that brand at its 51,679. These are what it reads instead.
--
-- Three functions rather than one, because combining them is slower. A single
-- function needs one CTE feeding several aggregations, which Postgres
-- materializes once it is referenced more than once, and the spill of 744,302
-- rows carrying domain text costs more than scanning twice. Two attempts at
-- the combined shape both exceeded the statement timeout; these run in 1.8 to
-- 4.6 seconds against the largest brand's full history.
--
-- Each is `security definer` because citation_urls is a cross-tenant
-- dictionary with no select policy of its own (see 00058), and each filters on
-- p_brand_id, which is what scopes the answer to the caller's own data.
--
-- `work_mem` is raised for the two aggregating functions. The instance default
-- is 3.5 MB, and the grouping needs roughly 60 MB — without this it spills to
-- disk and the same query takes twice as long.

-- ─── Domains ────────────────────────────────────────────────────────────────
-- Every domain, uncapped. The long tail is the point of the page: 20,366
-- domains on the largest brand, and the ones cited once are exactly what a
-- customer is looking for.
--
-- Two-level aggregation on purpose. `count(distinct prompt_result_id)` in one
-- pass makes the planner sort 744,302 rows; grouping to (domain, answer) pairs
-- first lets it hash both levels, which is 1.75s against 2.36s.

create or replace function public.citations_domains(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  domain text,
  total_citations bigint,
  results_citing bigint,
  models text[]
)
language sql
stable
security definer
set search_path = public
set work_mem = '96MB'
as $$
  with pairs as (
    select cu.domain as d, c.prompt_result_id as rid, count(*) as n,
           min(coalesce(pr.model_used, pr.platform)) as m
    from public.prompt_result_citations c
    join public.prompt_results pr on pr.id = c.prompt_result_id
    join public.citation_urls cu on cu.id = c.url_id
    where c.brand_id = p_brand_id
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or (c.created_at >= p_date_from and pr.created_at >= p_date_from))
      and (p_date_to    is null or (c.created_at <= p_date_to   and pr.created_at <= p_date_to))
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
    group by cu.domain, c.prompt_result_id
  )
  select d, sum(n)::bigint, count(*)::bigint, array_agg(distinct m)
  from pairs group by d
  order by 2 desc;
$$;

-- ─── URLs ───────────────────────────────────────────────────────────────────
-- Capped, unlike domains. The largest brand has 117,316 distinct URLs in its
-- window — 25 MB of payload for a table that shows a hundred at a time. Every
-- row carries `total_urls`, the uncapped count, so the surface can say how
-- many it is not showing rather than implying it has them all.

create or replace function public.citations_urls(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null,
  p_limit integer default 2000
)
returns table (
  url text,
  domain text,
  title text,
  total_citations bigint,
  results_citing bigint,
  models text[],
  total_urls bigint
)
language sql
stable
security definer
set search_path = public
set work_mem = '96MB'
as $$
  with pairs as (
    select c.url_id as uid, c.prompt_result_id as rid, count(*) as n,
           min(coalesce(pr.model_used, pr.platform)) as m
    from public.prompt_result_citations c
    join public.prompt_results pr on pr.id = c.prompt_result_id
    where c.brand_id = p_brand_id
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or (c.created_at >= p_date_from and pr.created_at >= p_date_from))
      and (p_date_to    is null or (c.created_at <= p_date_to   and pr.created_at <= p_date_to))
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
    group by c.url_id, c.prompt_result_id
  ),
  agg as (
    select uid, sum(n)::bigint as tc, count(*)::bigint as rc, array_agg(distinct m) as ms
    from pairs group by uid
  )
  -- The dictionary is joined after the limit, so the URL text is fetched for
  -- the rows that survive rather than for all 117,316 of them.
  select cu.url, cu.domain, cu.title, a.tc, a.rc, a.ms,
         (select count(*)::bigint from agg)
  from (select * from agg order by tc desc, uid limit p_limit) a
  join public.citation_urls cu on cu.id = a.uid
  order by a.tc desc;
$$;

-- ─── Window stats ───────────────────────────────────────────────────────────
-- Separate from the aggregates because it counts answers that cite nothing,
-- which is the denominator every usage percentage on the page divides by. The
-- citation tables cannot see those answers at all.

create or replace function public.citations_window_stats(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (results bigint, regions text[])
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint,
         coalesce(array_agg(distinct pr.region) filter (where pr.region is not null), '{}')
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'
    and (p_date_from  is null or pr.created_at >= p_date_from)
    and (p_date_to    is null or pr.created_at <= p_date_to)
    and (p_models     is null or pr.model_used = any(p_models))
    and (p_regions    is null or pr.region = any(p_regions))
    and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
    and (p_topic_ids  is null or pr.prompt_id in (
          select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)));
$$;

revoke all on function public.citations_domains(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) from public;
revoke all on function public.citations_urls(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer) from public;
revoke all on function public.citations_window_stats(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) from public;

grant execute on function public.citations_domains(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) to authenticated, service_role;
grant execute on function public.citations_urls(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer) to authenticated, service_role;
grant execute on function public.citations_window_stats(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) to authenticated, service_role;

comment on function public.citations_domains(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Per-domain citation aggregates for the Citations page (#732). Returns every domain — the long tail is the point.';
comment on function public.citations_urls(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer) is
  'Per-URL citation aggregates for the Citations page (#732), capped at p_limit and ordered by citation count. Every row carries total_urls, the uncapped count.';
comment on function public.citations_window_stats(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Answers scanned and regions observed in a Citations window (#732) — the denominator for every usage percentage, including answers that cite nothing.';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00062_organization_client_write_guard.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Organizations: restrict client-side updates to admins, and keep
-- server-managed columns out of the client's reach entirely.
--
-- Two permissive UPDATE policies were in force. Postgres ORs permissive
-- policies together, so the wider of the two decided the outcome and the
-- admin restriction never applied. The wider policy's name states an intent
-- its WITH CHECK does not carry out: it names no columns, so it allowed a
-- row's every column to be rewritten by any member of the org.
--
-- Column-level intent cannot be expressed in a policy at all. WITH CHECK sees
-- only the new row, so "this column may not change" has nowhere to compare
-- against. A BEFORE UPDATE trigger can see both rows, and that is where the
-- rule belongs.

DROP POLICY IF EXISTS "Users cannot update plan fields directly" ON "public"."organizations";
DROP POLICY IF EXISTS "organizations: admin update" ON "public"."organizations";

-- USING picks the rows an admin may reach; WITH CHECK keeps the updated row
-- inside the same set, so an org cannot be handed to somebody else.
CREATE POLICY "organizations: admin update" ON "public"."organizations"
  FOR UPDATE
  USING (
    "id" IN (
      SELECT "profiles"."organization_id"
      FROM "public"."profiles"
      WHERE "profiles"."id" = "auth"."uid"()
        AND "profiles"."role" = 'admin'::"public"."user_role"
    )
  )
  WITH CHECK (
    "id" IN (
      SELECT "profiles"."organization_id"
      FROM "public"."profiles"
      WHERE "profiles"."id" = "auth"."uid"()
        AND "profiles"."role" = 'admin'::"public"."user_role"
    )
  );

-- Billing state belongs to Stripe and the webhook that mirrors it; the API key
-- columns hold ciphertext produced server-side. Neither is the client's to
-- write, admin or not.
CREATE OR REPLACE FUNCTION "public"."guard_organization_server_columns"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SET "search_path" = ''
AS $$
BEGIN
  -- A role that already bypasses row-level security is server-side by
  -- definition -- the service role key, migrations, psql -- and this guard is
  -- not aimed at it. Everything else is a request carrying an end user's JWT.
  -- Naming the client roles instead would fail open on any role nobody
  -- thought of; asking about the privilege fails closed.
  IF (SELECT "rolbypassrls" FROM "pg_catalog"."pg_roles" WHERE "rolname" = current_user) THEN
    RETURN NEW;
  END IF;

  IF NEW."plan" IS DISTINCT FROM OLD."plan"
     OR NEW."plan_overrides" IS DISTINCT FROM OLD."plan_overrides"
     OR NEW."subscription_status" IS DISTINCT FROM OLD."subscription_status"
     OR NEW."subscription_ends_at" IS DISTINCT FROM OLD."subscription_ends_at"
     OR NEW."stripe_customer_id" IS DISTINCT FROM OLD."stripe_customer_id"
     OR NEW."stripe_subscription_id" IS DISTINCT FROM OLD."stripe_subscription_id"
     OR NEW."anthropic_api_key_encrypted" IS DISTINCT FROM OLD."anthropic_api_key_encrypted"
     OR NEW."anthropic_api_key_last4" IS DISTINCT FROM OLD."anthropic_api_key_last4"
     OR NEW."anthropic_api_key_set_at" IS DISTINCT FROM OLD."anthropic_api_key_set_at"
     OR NEW."anthropic_api_key_set_by" IS DISTINCT FROM OLD."anthropic_api_key_set_by"
  THEN
    RAISE EXCEPTION 'organization column is managed server-side and cannot be set from the client'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "organizations_guard_server_columns" ON "public"."organizations";

CREATE TRIGGER "organizations_guard_server_columns"
  BEFORE UPDATE ON "public"."organizations"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."guard_organization_server_columns"();

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00063_report_aggregate_rpcs.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Report generation: aggregate in Postgres instead of downloading the window.
--
-- Three report sections computed their figures by paging every matching
-- prompt_results row into the Node process and folding them there. On a brand
-- with ~12k results a week that is dozens of sequential round trips per
-- section, all running while the report's other sections issue their own
-- queries. The heavy aggregate RPCs (ai_visibility_aggregates and friends)
-- then exceed the 8s statement_timeout of the `authenticated` role and the
-- whole report fails.
--
-- The scans also had a ceiling: 50,000 rows. A 30-day report spans 60 days of
-- data for the topic section, which is already past that on a busy brand, so
-- the figures were quietly computed from a truncated window.
--
-- These functions return the raw accumulator components rather than finished
-- scores. The blend lives in one place in TypeScript (computeAiVisibilityScore)
-- and is shared with the Prompts and Topics pages; reimplementing it here
-- would be a second copy to keep in step.

-- Per-prompt totals for the report window. Rows returned: one per prompt,
-- not one per answer.
CREATE OR REPLACE FUNCTION "public"."report_prompt_performance"(
  "p_brand_id" uuid,
  "p_date_from" timestamptz,
  "p_date_to" timestamptz
)
RETURNS TABLE(
  "prompt_id" uuid,
  "prompt_text" text,
  "runs" bigint,
  "visible_runs" bigint,
  "mention_answers" bigint,
  "citation_answers" bigint,
  "total_mentions" bigint,
  "sum_visibility" double precision,
  "pos_sum" double precision,
  "pos_n" bigint
)
LANGUAGE "sql"
STABLE
SET "search_path" TO 'public'
AS $$
  SELECT
    pr.prompt_id,
    p.text,
    count(*)::bigint,
    count(*) FILTER (
      WHERE coalesce(pr.mention_count, 0) > 0 OR coalesce(pr.citation_count, 0) > 0
    )::bigint,
    count(*) FILTER (WHERE coalesce(pr.mention_count, 0) > 0)::bigint,
    count(*) FILTER (WHERE coalesce(pr.citation_count, 0) > 0)::bigint,
    coalesce(sum(coalesce(pr.mention_count, 0)), 0)::bigint,
    coalesce(sum(coalesce(pr.visibility_score, 0)), 0)::double precision,
    -- Reciprocal rank, summed only over answers that actually placed the
    -- brand somewhere; pos_n is that count so the caller can take the mean.
    coalesce(sum(1.0 / pr.mention_position) FILTER (WHERE pr.mention_position > 0), 0)::double precision,
    count(*) FILTER (WHERE pr.mention_position > 0)::bigint
  FROM prompt_results pr
  JOIN prompts p ON p.id = pr.prompt_id
  WHERE pr.brand_id = p_brand_id
    AND pr.platform <> 'chatgpt-shopping'
    AND pr.created_at >= p_date_from
    AND pr.created_at <= p_date_to
    AND p.text IS NOT NULL
    AND p.text <> ''
  GROUP BY pr.prompt_id, p.text;
$$;

-- Per-topic totals for the report window AND the window before it, so the
-- section can show a change without a second scan. `p_date_from` is the
-- boundary: at or after it is the current window, before it is the previous.
CREATE OR REPLACE FUNCTION "public"."report_topic_performance"(
  "p_brand_id" uuid,
  "p_date_from" timestamptz,
  "p_date_to" timestamptz,
  "p_prev_from" timestamptz
)
RETURNS TABLE(
  "topic_id" uuid,
  "topic_name" text,
  "runs" bigint,
  "visible_runs" bigint,
  "mention_answers" bigint,
  "citation_answers" bigint,
  "sum_visibility" double precision,
  "pos_sum" double precision,
  "pos_n" bigint,
  "prev_runs" bigint,
  "prev_visible_runs" bigint,
  "prev_mention_answers" bigint,
  "prev_citation_answers" bigint,
  "prev_pos_sum" double precision,
  "prev_pos_n" bigint
)
LANGUAGE "sql"
STABLE
SET "search_path" TO 'public'
AS $$
  SELECT
    t.id,
    t.name,
    count(*) FILTER (WHERE pr.created_at >= p_date_from)::bigint,
    count(*) FILTER (
      WHERE pr.created_at >= p_date_from
        AND (coalesce(pr.mention_count, 0) > 0 OR coalesce(pr.citation_count, 0) > 0)
    )::bigint,
    count(*) FILTER (WHERE pr.created_at >= p_date_from AND coalesce(pr.mention_count, 0) > 0)::bigint,
    count(*) FILTER (WHERE pr.created_at >= p_date_from AND coalesce(pr.citation_count, 0) > 0)::bigint,
    coalesce(sum(coalesce(pr.visibility_score, 0)) FILTER (WHERE pr.created_at >= p_date_from), 0)::double precision,
    coalesce(sum(1.0 / pr.mention_position) FILTER (
      WHERE pr.created_at >= p_date_from AND pr.mention_position > 0
    ), 0)::double precision,
    count(*) FILTER (WHERE pr.created_at >= p_date_from AND pr.mention_position > 0)::bigint,
    count(*) FILTER (WHERE pr.created_at < p_date_from)::bigint,
    count(*) FILTER (
      WHERE pr.created_at < p_date_from
        AND (coalesce(pr.mention_count, 0) > 0 OR coalesce(pr.citation_count, 0) > 0)
    )::bigint,
    count(*) FILTER (WHERE pr.created_at < p_date_from AND coalesce(pr.mention_count, 0) > 0)::bigint,
    count(*) FILTER (WHERE pr.created_at < p_date_from AND coalesce(pr.citation_count, 0) > 0)::bigint,
    coalesce(sum(1.0 / pr.mention_position) FILTER (
      WHERE pr.created_at < p_date_from AND pr.mention_position > 0
    ), 0)::double precision,
    count(*) FILTER (WHERE pr.created_at < p_date_from AND pr.mention_position > 0)::bigint
  FROM prompt_results pr
  JOIN prompts p ON p.id = pr.prompt_id
  JOIN topics t ON t.id = p.topic_id
  WHERE pr.brand_id = p_brand_id
    AND pr.platform <> 'chatgpt-shopping'
    AND pr.created_at >= p_prev_from
    AND pr.created_at <= p_date_to
  GROUP BY t.id, t.name;
$$;

-- Top cited URLs with the prompts whose answers cited them.
--
-- SECURITY DEFINER because citation_urls carries row-level security with no
-- select policy — the same reason citations_urls (00061) is defined that way.
-- Unlike those, this one checks that the caller is in the brand's org rather
-- than trusting the brand id it was handed.
CREATE OR REPLACE FUNCTION "public"."report_citation_evidence"(
  "p_brand_id" uuid,
  "p_date_from" timestamptz,
  "p_date_to" timestamptz,
  "p_limit" integer DEFAULT 10,
  "p_prompts_per_url" integer DEFAULT 3
)
RETURNS TABLE(
  "url" text,
  "domain" text,
  "title" text,
  "total_citations" bigint,
  "sourced_prompts" text[]
)
LANGUAGE "sql"
STABLE
SECURITY DEFINER
SET "search_path" TO 'public'
SET "work_mem" TO '96MB'
AS $$
  WITH allowed AS (
    SELECT 1
    FROM brands b
    JOIN profiles pf ON pf.organization_id = b.organization_id
    WHERE b.id = p_brand_id
      AND pf.id = auth.uid()
  ),
  -- citation_urls keeps the query string, so one page can sit under several
  -- ids (?utm_source=..., ?authuser=...). Evidence is about the page, not the
  -- link that reached it, so strip query and fragment and group on what is
  -- left — the same normalization the section applied before this moved into
  -- SQL. Without it the list shows the same article three times.
  pairs AS (
    SELECT
      regexp_replace(split_part(split_part(cu.url, '#', 1), '?', 1), '/$', '') AS norm_url,
      cu.domain AS domain,
      nullif(cu.title, '') AS title,
      pr.prompt_id AS prompt_id,
      count(*) AS n
    FROM prompt_result_citations c
    JOIN prompt_results pr ON pr.id = c.prompt_result_id
    JOIN citation_urls cu ON cu.id = c.url_id
    WHERE EXISTS (SELECT 1 FROM allowed)
      AND c.brand_id = p_brand_id
      AND pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'
      AND c.created_at >= p_date_from
      AND c.created_at <= p_date_to
      AND pr.created_at >= p_date_from
      AND pr.created_at <= p_date_to
    GROUP BY 1, 2, 3, 4, c.prompt_result_id
  ),
  agg AS (
    SELECT
      norm_url,
      sum(n)::bigint AS tc,
      min(domain) AS domain,
      min(title) AS title
    FROM pairs
    GROUP BY norm_url
  ),
  top AS (
    SELECT norm_url, tc, domain, title FROM agg ORDER BY tc DESC, norm_url LIMIT p_limit
  ),
  -- One row per (url, prompt text), then keep the first few per url. Ordering
  -- by text keeps the choice stable across runs of the same report.
  ranked AS (
    SELECT norm_url, text, row_number() OVER (PARTITION BY norm_url ORDER BY text) AS rn
    FROM (
      SELECT DISTINCT t.norm_url, p.text
      FROM top t
      JOIN pairs pa ON pa.norm_url = t.norm_url
      JOIN prompts p ON p.id = pa.prompt_id
      WHERE p.text IS NOT NULL AND p.text <> ''
    ) d
  )
  SELECT
    t.norm_url,
    coalesce(t.domain, ''),
    coalesce(t.title, ''),
    t.tc,
    coalesce(
      (SELECT array_agg(r.text ORDER BY r.rn)
       FROM ranked r
       WHERE r.norm_url = t.norm_url AND r.rn <= p_prompts_per_url),
      ARRAY[]::text[]
    )
  FROM top t
  ORDER BY t.tc DESC;
$$;

GRANT EXECUTE ON FUNCTION "public"."report_prompt_performance"(uuid, timestamptz, timestamptz) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."report_topic_performance"(uuid, timestamptz, timestamptz, timestamptz) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."report_citation_evidence"(uuid, timestamptz, timestamptz, integer, integer) TO "authenticated";

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00064_report_query_fanout_rpc.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Query fan-out: the fourth report section that read its window through an
-- unpaginated select.
--
-- 00063 moved prompt performance, topic performance and citation evidence into
-- SQL. getFanoutSnapshot was missed, and it was the worst of the four: no
-- .range(), no pagination, and no .order() either. PostgREST caps a select at
-- 1000 rows, so on a brand with ~12k answers in the window the section ranked
-- sub-queries over an arbitrary twelfth of the data. Every row in the affected
-- report came out at timesSearched = 2 and the list fell back to alphabetical
-- order, while the real top query had been searched 24 times.
--
-- Counting matches the fold this replaces: a sub-query counts once per answer
-- however many times that answer repeats it, and an engine is the item's own
-- source_platform when it has one, otherwise the answer's platform.
CREATE OR REPLACE FUNCTION "public"."report_query_fanout"(
  "p_brand_id" uuid,
  "p_date_from" timestamptz,
  "p_date_to" timestamptz,
  "p_limit" integer DEFAULT 10
)
RETURNS TABLE(
  "query" text,
  "engines" text[],
  "times_searched" bigint
)
LANGUAGE "sql"
STABLE
SET "search_path" TO 'public'
AS $$
  WITH items AS (
    SELECT
      pr.id AS result_id,
      btrim(regexp_replace(it->>'query', '\s+', ' ', 'g')) AS display,
      coalesce(nullif(it->>'source_platform', ''), pr.platform) AS engine
    FROM prompt_results pr
    CROSS JOIN LATERAL jsonb_array_elements(pr.search_queries) it
    WHERE pr.brand_id = p_brand_id
      AND pr.created_at >= p_date_from
      AND pr.created_at <= p_date_to
      AND jsonb_typeof(pr.search_queries) = 'array'
      AND it->>'query' IS NOT NULL
  ),
  cleaned AS (
    SELECT result_id, display, lower(display) AS qkey, engine
    FROM items
    WHERE display <> ''
  )
  SELECT
    min(display) AS query,
    array_agg(DISTINCT engine ORDER BY engine) FILTER (WHERE engine IS NOT NULL) AS engines,
    count(DISTINCT result_id) AS times_searched
  FROM cleaned
  GROUP BY qkey
  ORDER BY count(DISTINCT result_id) DESC, min(display)
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION "public"."report_query_fanout"(uuid, timestamptz, timestamptz, integer) TO "authenticated";

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00065_report_query_fanout_engines.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Per-engine fan-out coverage, to sit beside the top-ten table.
--
-- That table ranks sub-queries by how many answers ran the identical string,
-- which quietly measures how much an engine reuses its phrasing rather than
-- how much it fans out. On the brand this came from, ChatGPT issued 3,341
-- distinct sub-queries against Copilot's 782 -- and appeared in the top ten
-- exactly never, because its top string repeated 9 times to Copilot's 18.
--
-- A reader concluded ChatGPT does not fan out. It fans out the most. The
-- ranking is a separate question; this gives the section the two numbers that
-- stop the table from being read as the whole story.
CREATE OR REPLACE FUNCTION "public"."report_query_fanout_engines"(
  "p_brand_id" uuid,
  "p_date_from" timestamptz,
  "p_date_to" timestamptz
)
RETURNS TABLE(
  "engine" text,
  "distinct_queries" bigint,
  "answers_with_fanout" bigint
)
LANGUAGE "sql"
STABLE
SET "search_path" TO 'public'
AS $$
  WITH cleaned AS (
    SELECT
      pr.id AS result_id,
      lower(btrim(regexp_replace(it->>'query', '\s+', ' ', 'g'))) AS qkey,
      coalesce(nullif(it->>'source_platform', ''), pr.platform) AS engine
    FROM prompt_results pr
    CROSS JOIN LATERAL jsonb_array_elements(pr.search_queries) it
    WHERE pr.brand_id = p_brand_id
      AND pr.created_at >= p_date_from
      AND pr.created_at <= p_date_to
      AND jsonb_typeof(pr.search_queries) = 'array'
      AND it->>'query' IS NOT NULL
  )
  SELECT
    engine,
    count(DISTINCT qkey) AS distinct_queries,
    count(DISTINCT result_id) AS answers_with_fanout
  FROM cleaned
  WHERE qkey <> ''
    AND engine IS NOT NULL
  GROUP BY engine
  ORDER BY count(DISTINCT qkey) DESC, engine;
$$;

GRANT EXECUTE ON FUNCTION "public"."report_query_fanout_engines"(uuid, timestamptz, timestamptz) TO "authenticated";

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00066_insights_daily_rollups.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Insights stops recomputing history on every page load.
--
-- The Insights aggregate RPCs scan every prompt_results row a brand has ever
-- produced and explode competitor_mentions jsonb on the fly — 566,908 array
-- elements for the largest brand. Under the authenticated role's 8s
-- statement_timeout, competitor_aggregates takes 9.7s on that brand's
-- all-time window, so 30d/90d/all render as an opaque server error. The cost
-- grows with accumulated history: rewriting the query buys weeks, not a fix.
--
-- These tables invert the work. Each brand-day is aggregated ONCE — when the
-- brand's tracking run completes (the same drain point Daily Pulse waits on),
-- with a daily catch-up sweep as backstop — and the page reads the daily
-- rows. Read cost then scales with days in the window, never with results.
--
-- Grain: (day, model_used, platform, region), because those are exactly the
-- page's filter dimensions. Two extra tables carry the prompt dimension: the
-- leaderboard's rate is COUNT(DISTINCT prompt_id) over the window, which
-- cannot be summed across days. insights_prompt_daily mirrors one row per
-- answered (prompt, engine, day); insights_competitor_prompt_daily keeps only
-- VISIBLE competitor sightings — 9.4% of elements on the largest brand
-- (53,331 of 566,908) — so the distinct-count input stays small.
--
-- Two deliberate semantic carriers, verified against the live definitions:
--   * share_of_voice_aggregates counts competitor mentions WITHOUT a join to
--     competitors (deleted competitors included); competitor_aggregates and
--     ai_visibility_aggregates filter to live competitors. The rollups store
--     every competitor_id seen in the jsonb, and the liveness join is applied
--     by the read functions that had it — parity for both, and a competitor
--     deleted tomorrow disappears from reads without touching stored rows.
--   * Topic- and prompt-filtered calls stay on the raw RPCs: topic is a live
--     prompt attribute (reassignment must move history with it), and both
--     filters cut the scanned set far below the danger line.
--
-- The old RPCs are left untouched — MCP, reports and pulse call them under
-- the service role, which has no statement timeout. Only day-window reads
-- move here.

-- ─── Tables ─────────────────────────────────────────────────────────────────

-- Brand-side additive measures. One row per (day, engine, region).
create table if not exists public.insights_brand_daily (
  brand_id               uuid not null references public.brands(id) on delete cascade,
  day                    date not null,
  model_used             text,
  platform               text,
  region                 text,
  answer_count           integer not null,
  mention_answers        integer not null,
  citation_answers       integer not null,
  -- mention OR citation — not derivable from the two columns above.
  mentioning_answers     integer not null,
  sum_visibility         numeric not null,
  -- SUM(visibility_score) over mentioning answers only (visible_prompt_stats).
  sum_visibility_visible numeric not null,
  total_mentions         bigint not null,
  total_citations        bigint not null,
  positive_count         integer not null,
  -- AVG(1.0/mention_position) folds as sum/count across any window.
  sum_inv_position       numeric,
  position_count         integer not null,
  max_created_at         timestamptz not null
);

create index if not exists idx_insights_brand_daily_brand_day
  on public.insights_brand_daily (brand_id, day);

-- Per-competitor additive measures. Dense: every competitor_id present in an
-- answer's jsonb gets a row, zeros included, because the comparison table
-- shows a row (and an answer count) even for a competitor never mentioned.
create table if not exists public.insights_competitor_daily (
  brand_id         uuid not null references public.brands(id) on delete cascade,
  day              date not null,
  -- Text, not uuid: it mirrors the jsonb payload verbatim, and the read
  -- functions echo it back as the old RPCs did.
  competitor_id    text not null,
  model_used       text,
  platform         text,
  region           text,
  answer_count     integer not null,
  sum_visibility   numeric,
  total_mentions   bigint not null,
  total_citations  bigint not null,
  mention_answers  integer not null,
  citation_answers integer not null,
  sum_inv_position numeric,
  position_count   integer not null
);

create index if not exists idx_insights_competitor_daily_brand_day
  on public.insights_competitor_daily (brand_id, day);

-- One row per answered (prompt, engine, region, day) — the input for every
-- COUNT(DISTINCT prompt_id) the page shows. The widest of the four tables,
-- but each row is a few booleans; the largest brand adds ~1,800/day.
create table if not exists public.insights_prompt_daily (
  brand_id     uuid not null references public.brands(id) on delete cascade,
  day          date not null,
  prompt_id    uuid not null,
  model_used   text,
  platform     text,
  region       text,
  answer_count integer not null,
  has_mention  boolean not null,
  has_citation boolean not null
);

create index if not exists idx_insights_prompt_daily_brand_day
  on public.insights_prompt_daily (brand_id, day);

-- Visible competitor sightings only: (competitor, prompt, engine, day) rows
-- where the competitor was actually mentioned, cited or scored. Existence is
-- the datum — the per-competitor visible-prompt distinct counts read this.
create table if not exists public.insights_competitor_prompt_daily (
  brand_id      uuid not null references public.brands(id) on delete cascade,
  day           date not null,
  competitor_id text not null,
  prompt_id     uuid not null,
  model_used    text,
  platform      text,
  region        text
);

create index if not exists idx_insights_competitor_prompt_daily_brand_day
  on public.insights_competitor_prompt_daily (brand_id, day);

-- ─── RLS — same shape as prompt_results ─────────────────────────────────────

alter table public.insights_brand_daily enable row level security;
alter table public.insights_competitor_daily enable row level security;
alter table public.insights_prompt_daily enable row level security;
alter table public.insights_competitor_prompt_daily enable row level security;

create policy "Users can read own org insights rollups"
  on public.insights_brand_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

create policy "Users can read own org competitor rollups"
  on public.insights_competitor_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

create policy "Users can read own org prompt rollups"
  on public.insights_prompt_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

create policy "Users can read own org competitor prompt rollups"
  on public.insights_competitor_prompt_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

-- ─── Refresh ────────────────────────────────────────────────────────────────

-- Recomputes a brand's rollup rows for a day range from prompt_results.
-- Delete + insert in one transaction: idempotent by construction (no upsert
-- arbiter needed, so NULL dimension values need no synthetic encoding), and
-- readers never see a half-refreshed day. Day-scoped, so the jsonb explode
-- that makes the read path unaffordable stays cheap here: one day of the
-- largest brand is ~1,800 answers.
--
-- Service-role only. The web tier must never trigger writes; execute is
-- revoked from anon/authenticated below.
create or replace function public.refresh_insights_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to date
) returns void
language plpgsql
set search_path to 'public'
as $$
begin
  delete from public.insights_brand_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.insights_brand_daily (
    brand_id, day, model_used, platform, region,
    answer_count, mention_answers, citation_answers, mentioning_answers,
    sum_visibility, sum_visibility_visible, total_mentions, total_citations,
    positive_count, sum_inv_position, position_count, max_created_at)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.model_used, pr.platform, pr.region,
    count(*),
    count(*) filter (where pr.mention_count > 0),
    count(*) filter (where pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0),
    coalesce(sum(pr.visibility_score), 0),
    coalesce(sum(pr.visibility_score)
      filter (where pr.mention_count > 0 or pr.citation_count > 0), 0),
    coalesce(sum(pr.mention_count), 0),
    coalesce(sum(pr.citation_count), 0),
    count(*) filter (where pr.sentiment = 'positive'),
    sum(1.0 / pr.mention_position) filter (where pr.mention_position is not null),
    count(*) filter (where pr.mention_position is not null),
    max(pr.created_at)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.model_used, pr.platform, pr.region;

  insert into public.insights_prompt_daily (
    brand_id, day, prompt_id, model_used, platform, region,
    answer_count, has_mention, has_citation)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    count(*),
    bool_or(pr.mention_count > 0),
    bool_or(pr.citation_count > 0)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.prompt_id, pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_daily (
    brand_id, day, competitor_id, model_used, platform, region,
    answer_count, sum_visibility, total_mentions, total_citations,
    mention_answers, citation_answers, sum_inv_position, position_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.model_used, pr.platform, pr.region,
    count(*),
    sum((cm.value->>'visibility_score')::numeric),
    coalesce(sum(coalesce((cm.value->>'mention_count')::int, 0)), 0),
    coalesce(sum(coalesce((cm.value->>'citation_count')::int, 0)), 0),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position') is not null),
    count(*) filter (where (cm.value->>'mention_position') is not null)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
  group by 2, cm.value->>'competitor_id', pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_prompt_daily (
    brand_id, day, competitor_id, prompt_id, model_used, platform, region)
  select distinct
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.prompt_id, pr.model_used, pr.platform, pr.region
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
    and (coalesce((cm.value->>'mention_count')::int, 0) > 0
      or coalesce((cm.value->>'citation_count')::int, 0) > 0
      or coalesce((cm.value->>'visibility_score')::numeric, 0) > 0);
end;
$$;

revoke execute on function public.refresh_insights_daily(uuid, date, date)
  from public, anon, authenticated;

-- ─── Read functions ─────────────────────────────────────────────────────────
--
-- Each mirrors its raw counterpart's payload byte for byte — same keys, same
-- ordering clauses — so the web mapping code cannot tell which one answered,
-- and the cutover can be shadow-verified by diffing the two outputs. All are
-- SECURITY INVOKER: the caller's RLS on the rollup tables scopes the read,
-- exactly as the raw RPCs lean on prompt_results RLS.
--
-- Windows are whole days (p_day_from .. p_day_to inclusive, UTC), which is
-- what makes the rollup readable at all. The one caller-visible consequence —
-- a preset window covers calendar days instead of sliding with the clock —
-- is deliberate: numbers move once per completed run instead of drifting
-- within the day.

-- insights_aggregates over rollups.
create or replace function public.insights_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with filtered as (
    select * from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  totals as (
    select
      coalesce(sum(answer_count), 0)       as total_results,
      coalesce(sum(sum_visibility), 0)     as sum_visibility,
      coalesce(sum(total_mentions), 0)     as total_mentions,
      coalesce(sum(total_citations), 0)    as total_citations,
      coalesce(sum(positive_count), 0)     as positive_count,
      coalesce(sum(mentioning_answers), 0) as mentioning_results,
      max(max_created_at)                  as last_checked_at
    from filtered
  ),
  by_model as (
    select
      coalesce(model_used, 'unknown') as model_used,
      sum(sum_visibility)             as sum_visibility,
      sum(answer_count)               as result_count
    from filtered
    group by coalesce(model_used, 'unknown')
  )
  select jsonb_build_object(
    'total_results',      t.total_results,
    'sum_visibility',     t.sum_visibility,
    'total_mentions',     t.total_mentions,
    'total_citations',    t.total_citations,
    'positive_count',     t.positive_count,
    'mentioning_results', t.mentioning_results,
    'last_checked_at',    t.last_checked_at,
    'by_model', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',     bm.model_used,
                'sum_visibility', bm.sum_visibility,
                'result_count',   bm.result_count)
              order by bm.result_count desc, bm.model_used)
       from by_model bm),
      '[]'::jsonb)
  )
  from totals t;
$$;

-- visible_prompt_stats over rollups.
create or replace function public.visible_prompt_stats_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'visible_prompts',
      (select count(distinct pd.prompt_id)
       from public.insights_prompt_daily pd
       where pd.brand_id = p_brand_id
         and (pd.has_mention or pd.has_citation)
         and (p_platform is null or pd.platform = p_platform)
         and (p_models is null or pd.model_used = any (p_models))
         and (p_region is null or pd.region = p_region)
         and (p_day_from is null or pd.day >= p_day_from)
         and (p_day_to is null or pd.day <= p_day_to)),
    'visible_results',
      coalesce((select sum(bd.mentioning_answers)
       from public.insights_brand_daily bd
       where bd.brand_id = p_brand_id
         and (p_platform is null or bd.platform = p_platform)
         and (p_models is null or bd.model_used = any (p_models))
         and (p_region is null or bd.region = p_region)
         and (p_day_from is null or bd.day >= p_day_from)
         and (p_day_to is null or bd.day <= p_day_to)), 0),
    'sum_visibility_visible',
      coalesce((select sum(bd.sum_visibility_visible)
       from public.insights_brand_daily bd
       where bd.brand_id = p_brand_id
         and (p_platform is null or bd.platform = p_platform)
         and (p_models is null or bd.model_used = any (p_models))
         and (p_region is null or bd.region = p_region)
         and (p_day_from is null or bd.day >= p_day_from)
         and (p_day_to is null or bd.day <= p_day_to)), 0)
  );
$$;

-- tracked_prompt_count over rollups.
create or replace function public.tracked_prompt_count_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns integer
language sql
stable
set search_path to 'public'
as $$
  select count(distinct pd.prompt_id)::integer
  from public.insights_prompt_daily pd
  where pd.brand_id = p_brand_id
    and (p_platform is null or pd.platform = p_platform)
    and (p_models is null or pd.model_used = any (p_models))
    and (p_region is null or pd.region = p_region)
    and (p_day_from is null or pd.day >= p_day_from)
    and (p_day_to is null or pd.day <= p_day_to)
$$;

-- ai_visibility_aggregates over rollups. Liveness join preserved: only
-- competitors that still exist appear, exactly like the raw RPC's EXISTS.
-- Names come from competitors.name (live) rather than the jsonb snapshot the
-- raw RPC MAX()es over — a renamed competitor shows its current name.
create or replace function public.ai_visibility_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with brand_agg as (
    select
      coalesce(sum(answer_count), 0)    as answers,
      coalesce(sum(mention_answers), 0) as mention_answers,
      coalesce(sum(citation_answers), 0) as citation_answers,
      sum(sum_inv_position) / nullif(sum(position_count), 0) as position_factor
    from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  comp_agg as (
    select
      cd.competitor_id,
      max(c.name)                as name,
      sum(cd.mention_answers)    as mention_answers,
      sum(cd.citation_answers)   as citation_answers,
      sum(cd.sum_inv_position) / nullif(sum(cd.position_count), 0) as position_factor
    from public.insights_competitor_daily cd
    join public.competitors c
      on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
    where cd.brand_id = p_brand_id
      and (p_platform is null or cd.platform = p_platform)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
    group by cd.competitor_id
  )
  select jsonb_build_object(
    'answers',          b.answers,
    'mention_answers',  b.mention_answers,
    'citation_answers', b.citation_answers,
    'position_factor',  b.position_factor,
    'by_competitor', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'competitor_id',    ca.competitor_id,
                'name',             ca.name,
                'mention_answers',  ca.mention_answers,
                'citation_answers', ca.citation_answers,
                'position_factor',  ca.position_factor)
              order by ca.mention_answers desc, ca.competitor_id)
       from comp_agg ca),
      '[]'::jsonb)
  )
  from brand_agg b;
$$;

-- competitor_aggregates over rollups. The distinct-prompt counts read the two
-- prompt-grain tables; everything additive reads the day-grain ones. Engine
-- keys join with IS NOT DISTINCT FROM because model_used can be null.
create or replace function public.competitor_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with brand_days as (
    select * from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  prompt_days as (
    select * from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  comp_days as (
    select cd.* from public.insights_competitor_daily cd
    join public.competitors c
      on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
    where cd.brand_id = p_brand_id
      and (p_platform is null or cd.platform = p_platform)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
  ),
  comp_prompt_days as (
    select cpd.* from public.insights_competitor_prompt_daily cpd
    join public.competitors c
      on c.id::text = cpd.competitor_id and c.brand_id = p_brand_id
    where cpd.brand_id = p_brand_id
      and (p_platform is null or cpd.platform = p_platform)
      and (p_models is null or cpd.model_used = any (p_models))
      and (p_region is null or cpd.region = p_region)
      and (p_day_from is null or cpd.day >= p_day_from)
      and (p_day_to is null or cpd.day <= p_day_to)
  ),
  brand_totals as (
    select
      coalesce((select sum(answer_count) from brand_days), 0)    as row_count,
      coalesce((select sum(sum_visibility) from brand_days), 0)  as sum_visibility,
      coalesce((select sum(total_mentions) from brand_days), 0)  as total_mentions,
      coalesce((select sum(total_citations) from brand_days), 0) as total_citations,
      (select count(distinct prompt_id) from prompt_days)        as prompt_count,
      (select count(distinct prompt_id) from prompt_days
        where has_mention or has_citation)                       as visible_prompts
  ),
  by_brand_provider as (
    select b.model_used, b.platform, b.sum_visibility, b.row_count,
           p.prompt_count, p.visible_prompts
    from (
      select model_used, platform,
             sum(sum_visibility) as sum_visibility,
             sum(answer_count)   as row_count
      from brand_days group by model_used, platform
    ) b
    join (
      select model_used, platform,
             count(distinct prompt_id) as prompt_count,
             count(distinct prompt_id)
               filter (where has_mention or has_citation) as visible_prompts
      from prompt_days group by model_used, platform
    ) p on p.model_used is not distinct from b.model_used
       and p.platform is not distinct from b.platform
  ),
  -- Grouped once each, then joined — a correlated subselect here rescans
  -- comp_prompt_days per output group (13 + ~119 of them), which measured
  -- 1.6s on the largest brand's all-time window against ~100ms this way.
  visible_by_comp as (
    select competitor_id, count(distinct prompt_id) as visible_prompts
    from comp_prompt_days group by competitor_id
  ),
  visible_by_comp_engine as (
    select competitor_id, model_used, platform,
           count(distinct prompt_id) as visible_prompts
    from comp_prompt_days group by competitor_id, model_used, platform
  ),
  by_competitor as (
    select
      cd.competitor_id,
      max(c.name)               as name,
      sum(cd.sum_visibility)    as sum_visibility,
      sum(cd.answer_count)      as row_count,
      coalesce(sum(cd.total_mentions), 0)::bigint  as total_mentions,
      coalesce(sum(cd.total_citations), 0)::bigint as total_citations,
      coalesce(max(v.visible_prompts), 0)          as visible_prompts
    from comp_days cd
    join public.competitors c
      on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
    left join visible_by_comp v on v.competitor_id = cd.competitor_id
    group by cd.competitor_id
  ),
  by_competitor_provider as (
    select
      cd.model_used, cd.platform, cd.competitor_id,
      max(c.name)                         as competitor_name,
      sum(cd.sum_visibility)              as sum_visibility,
      sum(cd.answer_count)                as row_count,
      coalesce(max(v.visible_prompts), 0) as visible_prompts
    from comp_days cd
    join public.competitors c
      on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
    left join visible_by_comp_engine v
      on v.competitor_id = cd.competitor_id
     and v.model_used is not distinct from cd.model_used
     and v.platform is not distinct from cd.platform
    group by cd.model_used, cd.platform, cd.competitor_id
  )
  select jsonb_build_object(
    'brand_row_count',       b.row_count,
    'brand_sum_visibility',  b.sum_visibility,
    'brand_total_mentions',  b.total_mentions,
    'brand_total_citations', b.total_citations,
    'brand_prompt_count',    b.prompt_count,
    'brand_visible_prompts', b.visible_prompts,
    'by_competitor', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'competitor_id',   bc.competitor_id,
                'name',            bc.name,
                'sum_visibility',  bc.sum_visibility,
                'row_count',       bc.row_count,
                'total_mentions',  bc.total_mentions,
                'total_citations', bc.total_citations,
                'visible_prompts', bc.visible_prompts)
              order by bc.row_count desc, bc.competitor_id)
       from by_competitor bc),
      '[]'::jsonb),
    'by_brand_provider', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',      bbp.model_used,
                'platform',        bbp.platform,
                'sum_visibility',  bbp.sum_visibility,
                'row_count',       bbp.row_count,
                'prompt_count',    bbp.prompt_count,
                'visible_prompts', bbp.visible_prompts)
              order by bbp.platform nulls last, bbp.model_used nulls last)
       from by_brand_provider bbp),
      '[]'::jsonb),
    'by_competitor_provider', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',      bcp.model_used,
                'platform',        bcp.platform,
                'competitor_id',   bcp.competitor_id,
                'competitor_name', bcp.competitor_name,
                'sum_visibility',  bcp.sum_visibility,
                'row_count',       bcp.row_count,
                'visible_prompts', bcp.visible_prompts)
              order by bcp.platform nulls last, bcp.model_used nulls last, bcp.competitor_id)
       from by_competitor_provider bcp),
      '[]'::jsonb)
  )
  from brand_totals b;
$$;

-- share_of_voice_aggregates over rollups. No competitors join anywhere — the
-- raw RPC sums every jsonb element regardless of liveness, and SoV parity
-- means keeping that.
create or replace function public.share_of_voice_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with brand_days as (
    select * from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  comp_days as (
    select * from public.insights_competitor_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  totals as (
    select
      coalesce((select sum(total_mentions) from brand_days), 0)::bigint as total_brand_mentions,
      coalesce((select sum(total_mentions) from comp_days), 0)::bigint  as total_competitor_mentions
  ),
  by_platform as (
    select b.model_used, b.platform,
           b.brand_mentions,
           coalesce(c.competitor_mentions, 0) as competitor_mentions
    from (
      select model_used, platform,
             coalesce(sum(total_mentions), 0)::bigint as brand_mentions
      from brand_days group by model_used, platform
    ) b
    left join (
      select model_used, platform,
             coalesce(sum(total_mentions), 0)::bigint as competitor_mentions
      from comp_days group by model_used, platform
    ) c on c.model_used is not distinct from b.model_used
       and c.platform is not distinct from b.platform
  ),
  by_day as (
    select b.day,
           b.brand_mentions,
           coalesce(c.competitor_mentions, 0) as competitor_mentions
    from (
      select to_char(day, 'YYYY-MM-DD') as day,
             coalesce(sum(total_mentions), 0)::bigint as brand_mentions
      from brand_days group by day
    ) b
    left join (
      select to_char(day, 'YYYY-MM-DD') as day,
             coalesce(sum(total_mentions), 0)::bigint as competitor_mentions
      from comp_days group by day
    ) c on c.day = b.day
  )
  select jsonb_build_object(
    'total_brand_mentions',      t.total_brand_mentions,
    'total_competitor_mentions', t.total_competitor_mentions,
    'by_platform', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',          bp.model_used,
                'platform',            bp.platform,
                'brand_mentions',      bp.brand_mentions,
                'competitor_mentions', bp.competitor_mentions)
              order by bp.platform nulls last, bp.model_used nulls last)
       from by_platform bp),
      '[]'::jsonb),
    'by_day', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'day',                 bd.day,
                'brand_mentions',      bd.brand_mentions,
                'competitor_mentions', bd.competitor_mentions)
              order by bd.day)
       from by_day bd),
      '[]'::jsonb)
  )
  from totals t;
$$;

-- visibility_rate_trend over rollups. Brand rows fold the day-grain and
-- prompt-grain tables; competitor rows are the dense per-day counts left-
-- joined with the visible-sighting distincts (liveness join preserved).
create or replace function public.visibility_rate_trend_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with brand_daily as (
    select d.day,
           sum(d.answer_count)     as answers,
           sum(d.mention_answers)  as mention_answers,
           sum(d.citation_answers) as citation_answers,
           sum(d.sum_inv_position) / nullif(sum(d.position_count), 0) as position_factor,
           sum(d.position_count)   as position_n
    from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    group by d.day
  ),
  prompt_daily as (
    select d.day,
           count(distinct d.prompt_id) as prompt_count,
           count(distinct d.prompt_id)
             filter (where d.has_mention or d.has_citation) as visible_prompts
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    group by d.day
  ),
  comp_daily as (
    select cd.day, cd.competitor_id,
           sum(cd.mention_answers)  as mention_answers,
           sum(cd.citation_answers) as citation_answers,
           sum(cd.sum_inv_position) / nullif(sum(cd.position_count), 0) as position_factor,
           sum(cd.position_count)   as position_n
    from public.insights_competitor_daily cd
    join public.competitors c
      on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
    where cd.brand_id = p_brand_id
      and (p_platform is null or cd.platform = p_platform)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
    group by cd.day, cd.competitor_id
  ),
  comp_visible as (
    select cpd.day, cpd.competitor_id,
           count(distinct cpd.prompt_id) as visible_prompts
    from public.insights_competitor_prompt_daily cpd
    join public.competitors c
      on c.id::text = cpd.competitor_id and c.brand_id = p_brand_id
    where cpd.brand_id = p_brand_id
      and (p_platform is null or cpd.platform = p_platform)
      and (p_models is null or cpd.model_used = any (p_models))
      and (p_region is null or cpd.region = p_region)
      and (p_day_from is null or cpd.day >= p_day_from)
      and (p_day_to is null or cpd.day <= p_day_to)
    group by cpd.day, cpd.competitor_id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'day',              bd.day,
      'prompt_count',     coalesce(pd.prompt_count, 0),
      'visible_prompts',  coalesce(pd.visible_prompts, 0),
      'answers',          bd.answers,
      'mention_answers',  bd.mention_answers,
      'citation_answers', bd.citation_answers,
      'position_factor',  bd.position_factor,
      'position_n',       bd.position_n,
      'competitors', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'competitor_id',    cd.competitor_id,
                  'visible_prompts',  coalesce(cv.visible_prompts, 0),
                  'mention_answers',  cd.mention_answers,
                  'citation_answers', cd.citation_answers,
                  'position_factor',  cd.position_factor,
                  'position_n',       cd.position_n)
                order by cd.competitor_id)
         from comp_daily cd
         left join comp_visible cv
           on cv.day = cd.day and cv.competitor_id = cd.competitor_id
         where cd.day = bd.day),
        '[]'::jsonb)
    ) order by bd.day),
    '[]'::jsonb)
  from brand_daily bd
  left join prompt_daily pd on pd.day = bd.day;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00067_citation_url_detail_rpcs.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Read the per-URL citation detail page from prompt_result_citations (#732),
-- phase 3.
--
-- Phase 2 moved the Citations overview onto the citation rows and left the
-- detail page behind. It still pages every answer in the window out to the app
-- tier and looks for one URL in JavaScript: 60,442 rows carrying 75 MB of
-- jsonb across 61 sequential requests on the largest brand, to render a page
-- about a URL cited in 2,084 of them.
--
-- The cost is the visible half of the problem. The scan stops at 50,000 rows
-- and walks the window oldest-first, so that brand's detail page never reached
-- its newest 10,442 answers — five days of citations missing from the counts
-- and a "last seen" date five days stale, with nothing on screen to say so.
--
-- Matching stays in the app tier on purpose. The page aggregates by
-- `normalizeCitationUrl`, which folds away query strings and one trailing
-- slash, and that is not cosmetic: the largest brand's 124,134 distinct cited
-- URLs collapse to 73,289 under it. Reimplementing those rules in SQL would
-- make two definitions of the same identity that can drift apart. So SQL
-- narrows to a domain and the caller normalizes the candidates itself, with
-- the same function that renders them.

-- ─── Indexes ────────────────────────────────────────────────────────────────
-- Both replace a narrower index with the same leading column, so no query
-- loses an access path; the narrow ones are dropped below.
--
-- (brand_id, created_at) carrying url_id and prompt_result_id turns the
-- overview's scan of a brand's citations into an index-only scan: 8,296 ms of
-- random heap access became 273 ms, and citations_urls went from 11.9 s cold
-- (over the 8 s statement timeout for `authenticated`) to 2.0 s.
create index if not exists prompt_result_citations_brand_created_cover_idx
  on public.prompt_result_citations (brand_id, created_at desc)
  include (url_id, prompt_result_id);

-- (url_id, brand_id) answers "does this brand cite this URL" from the index
-- alone. citation_url_candidates probes it once per URL on the domain — 15,736
-- times for youtube.com — which cost 5,941 ms against the url_id-only index
-- and 66 ms against this one.
create index if not exists prompt_result_citations_url_brand_idx
  on public.prompt_result_citations (url_id, brand_id);

drop index if exists public.prompt_result_citations_brand_created_idx;
drop index if exists public.prompt_result_citations_url_idx;

-- ─── Domains ────────────────────────────────────────────────────────────────
-- Unchanged in what it returns; the model list is now built from the distinct
-- (domain, model) pairs instead of `array_agg(distinct m)` over every
-- (domain, answer) pair. The old form sorted 580,707 rows into 21,082 groups
-- and was the larger half of the function's runtime: 7.0 s against 2.8 s here,
-- which brings the last of the three overview functions under the timeout.
--
-- `order by m` keeps the array sorted, which is what array_agg(distinct)
-- guaranteed and what the page's own sort assumes.
create or replace function public.citations_domains(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  domain text,
  total_citations bigint,
  results_citing bigint,
  models text[]
)
language sql
stable
security definer
set search_path to 'public'
set work_mem to '96MB'
as $$
  with pairs as (
    select cu.domain as d, c.prompt_result_id as rid, count(*) as n,
           min(coalesce(pr.model_used, pr.platform)) as m
    from public.prompt_result_citations c
    join public.prompt_results pr on pr.id = c.prompt_result_id
    join public.citation_urls cu on cu.id = c.url_id
    where c.brand_id = p_brand_id
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or (c.created_at >= p_date_from and pr.created_at >= p_date_from))
      and (p_date_to    is null or (c.created_at <= p_date_to   and pr.created_at <= p_date_to))
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
    group by cu.domain, c.prompt_result_id
  ),
  counts as (
    select d, sum(n)::bigint as tc, count(*)::bigint as rc from pairs group by d
  ),
  model_lists as (
    select d, array_agg(m order by m) as ms
    from (select distinct d, m from pairs) s
    group by d
  )
  select c.d, c.tc, c.rc, m.ms
  from counts c join model_lists m on m.d = c.d
  order by c.tc desc;
$$;

-- ─── URL detail: candidates ─────────────────────────────────────────────────
-- Every URL on one domain that this brand has cited, for the caller to
-- normalize and match. Brand-scoped so an authenticated user cannot enumerate
-- the cross-tenant URL dictionary a domain at a time.
--
-- Deliberately unfiltered by window: which raw URLs fold into the target is a
-- property of the URL, not of the window, and the occurrence query applies the
-- window anyway. Filtering here would only make the candidate set depend on
-- the filter bar, so switching from 7d to 30d could change which variants of a
-- URL the page considers part of it.
create or replace function public.citation_url_candidates(
  p_brand_id uuid,
  p_domain text
)
returns table (
  id bigint,
  url text,
  title text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select cu.id, cu.url, cu.title
  from public.citation_urls cu
  where cu.domain = p_domain
    and exists (
      select 1 from public.prompt_result_citations c
      where c.url_id = cu.id and c.brand_id = p_brand_id
    );
$$;

-- ─── URL detail: occurrences ────────────────────────────────────────────────
-- One row per answer citing any of p_url_ids, carrying what the detail table
-- renders. The caller passes the ids its own normalization matched.
--
-- `rank` is `position + 1` because `position` is the citation's index in the
-- provider's original array, which is the ordering the page ranks by: every
-- one of 20,000 sampled answers has its citations already in startIndex order,
-- and position survives the entries the row writer drops as unparsable, so it
-- stays truer to the original array than counting rows would.
--
-- `total_sources` counts the answer's citation rows. That is the array length
-- except where an entry had no recoverable host — one answer in 19,176 on the
-- largest brand.
create or replace function public.citation_url_occurrences(
  p_brand_id uuid,
  p_url_ids bigint[],
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  result_id uuid,
  prompt_id uuid,
  prompt_text text,
  platform text,
  model_used text,
  region text,
  created_at timestamptz,
  sentiment text,
  brand_mentioned boolean,
  citations_in_answer int,
  rank int,
  total_sources int
)
language sql
stable
security definer
set search_path to 'public'
set work_mem to '96MB'
as $$
  with hits as (
    select c.prompt_result_id as rid,
           count(*)::int as cited,
           (min(c.position) + 1)::int as rnk
    from public.prompt_result_citations c
    where c.brand_id = p_brand_id
      and c.url_id = any(p_url_ids)
      and (p_date_from is null or c.created_at >= p_date_from)
      and (p_date_to   is null or c.created_at <= p_date_to)
    group by c.prompt_result_id
  ),
  answers as (
    select h.rid, h.cited, h.rnk, pr.prompt_id, pr.platform, pr.model_used,
           pr.region, pr.created_at, pr.sentiment,
           coalesce(pr.mention_count, 0) > 0 as mentioned
    from hits h
    join public.prompt_results pr on pr.id = h.rid
    where pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or pr.created_at >= p_date_from)
      and (p_date_to    is null or pr.created_at <= p_date_to)
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
  ),
  -- Grouped once and joined, rather than counted per answer in a correlated
  -- subselect: the subselect re-probed the index for each of the 2,084 rows
  -- the busiest URL returns.
  sizes as (
    select a.prompt_result_id as rid, count(*)::int as total
    from public.prompt_result_citations a
    where a.prompt_result_id in (select rid from answers)
    group by a.prompt_result_id
  )
  select a.rid, a.prompt_id, p.text, a.platform, a.model_used, a.region,
         a.created_at, a.sentiment, a.mentioned, a.cited, a.rnk,
         coalesce(s.total, a.cited)
  from answers a
  left join sizes s on s.rid = a.rid
  left join public.prompts p on p.id = a.prompt_id
  order by a.created_at desc;
$$;

revoke all on function public.citation_url_candidates(uuid, text) from public;
revoke all on function public.citation_url_occurrences(uuid, bigint[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) from public;

grant execute on function public.citation_url_candidates(uuid, text) to authenticated, service_role;
grant execute on function public.citation_url_occurrences(uuid, bigint[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) to authenticated, service_role;

comment on function public.citation_url_candidates(uuid, text) is
  'URLs on one domain that a brand has cited (#732), for the detail page to normalize and match in the app tier.';
comment on function public.citation_url_occurrences(uuid, bigint[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Answers citing any of the given URL ids (#732) — the per-URL citation detail table, one row per answer.';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00068_citation_gap_rpcs.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Read Competitor Gaps from prompt_result_citations (#777), phase 4 of #732.
--
-- getCitationGaps was the last reader paging raw answers to the app tier:
-- every answer in the window with its `citations` AND `competitor_mentions`
-- jsonb attached — 77 MB + 52 MB across 62,285 rows on the largest brand —
-- and, like the detail page before #776, capped at 50,000 rows oldest-first,
-- so the newest answers were silently missing from the gap analysis.
--
-- Domain identity comes from `citation_urls.domain`, written by the same
-- hostname extraction the page used to run per read (verified: 135,040
-- (answer, domain) pairs computed both ways on a full brand, zero different).
-- The you/competitor split cannot be precomputed there, because it depends on
-- the brand's CURRENT domain lists — so the caller passes those lists in and
-- the suffix rule (`d = entry or d ends with ".entry"`) runs here, on the
-- distinct domains only. The rest of classification (forum/social/editorial…)
-- stays in the app tier; it is display-only for this page.
--
-- Both functions carry the membership guard from report_citation_evidence:
-- they are security definer (citation_urls has no select policy of its own),
-- so without the guard any authenticated user could read any brand's gap
-- data by uuid. The `allowed` CTE pins execution to members of the brand's
-- organization; service_role clients get empty results, which no current
-- caller minds — both are called from user-session server actions.
--
-- `jsonb_path_exists` instead of expanding competitor_mentions: the answer
-- "does this answer mention any competitor" does not need rows, and the
-- expansion was the single largest cost of the naive shape (3.8 s of the
-- 8.6 s total on the largest brand; this shape measures 3.8 s end to end).
-- Full expansion happens only where entries are actually needed: names on
-- gap-qualifying answers, per-competitor rows in citation_competitor_sources.

-- ─── Gap domains ────────────────────────────────────────────────────────────
-- One row per third-party domain the window cites, with the co-occurrence
-- counts the Competitor Gaps tab aggregates today, plus one summary row
-- (domain null) so the answer totals survive even when no domain qualifies.
--
-- Semantics mirror the page exactly:
--   * an answer's weight is 1 / its distinct cited domains;
--   * "we are present" = brand mentioned OR any own-domain cited;
--   * a domain's gap counters only grow from answers where a competitor is
--     mentioned and we are absent; appears_in_ours records the opposite side;
--   * domains on the brand's or a competitor's own sites are excluded — only
--     third-party publications are actionable.
create or replace function public.citation_gap_domains(
  p_brand_id uuid,
  p_brand_domains text[],
  p_competitor_domains text[],
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  domain text,
  competitor_answers bigint,
  appears_in_ours boolean,
  strength double precision,
  competitor_names text[],
  our_answer_count bigint,
  total_answers bigint
)
language sql
stable
security definer
set search_path to 'public'
set work_mem to '96MB'
as $$
  with allowed as (
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ),
  answers as materialized (
    select pr.id as rid,
           coalesce(pr.mention_count, 0) > 0 as we_mention,
           coalesce(
             jsonb_path_exists(pr.competitor_mentions, '$[*] ? (@.mention_count > 0)'),
             false
           ) as comp_present,
           pr.competitor_mentions
    from prompt_results pr
    where exists (select 1 from allowed)
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or pr.created_at >= p_date_from)
      and (p_date_to    is null or pr.created_at <= p_date_to)
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
  ),
  adomains as materialized (
    select distinct c.prompt_result_id as rid, cu.domain as d
    from prompt_result_citations c
    join citation_urls cu on cu.id = c.url_id
    where c.brand_id = p_brand_id
      and c.prompt_result_id in (select rid from answers)
  ),
  -- The suffix match runs once per distinct domain, not once per pair.
  dtags as materialized (
    select s.d,
      exists (select 1 from unnest(p_brand_domains) e
              where s.d = e or right(s.d, length(e) + 1) = '.' || e) as is_you,
      exists (select 1 from unnest(p_competitor_domains) e
              where s.d = e or right(s.d, length(e) + 1) = '.' || e) as is_comp
    from (select distinct ad.d from adomains ad) s
  ),
  per_answer as (
    select ad.rid, 1.0 / count(*) as w, bool_or(t.is_you) as you_cited
    from adomains ad join dtags t on t.d = ad.d
    group by ad.rid
  ),
  flags as materialized (
    select a.rid,
           a.we_mention or coalesce(pa.you_cited, false) as we_present,
           a.comp_present,
           coalesce(pa.w, 0) as w
    from answers a
    left join per_answer pa on pa.rid = a.rid
  ),
  domain_rows as (
    select ad.d,
      count(*) filter (where f.comp_present and not f.we_present) as competitor_answers,
      bool_or(f.we_present) as appears,
      coalesce(sum(f.w) filter (where f.comp_present and not f.we_present), 0) as strength
    from adomains ad
    join dtags t on t.d = ad.d and not t.is_you and not t.is_comp
    join flags f on f.rid = ad.rid
    group by ad.d
  ),
  -- Competitor names only exist on gap-qualifying answers, so the jsonb
  -- expansion is bounded by those instead of the whole window. A mention of
  -- a still-live competitor renders under its current name; a deleted one
  -- keeps the name recorded in the answer.
  qualifying as (
    select f.rid from flags f where f.comp_present and not f.we_present
  ),
  mention_names as (
    select q.rid,
      case when co.id is not null
           then coalesce(nullif(trim(co.name), ''), 'Competitor')
           else coalesce(nullif(trim(x.e ->> 'name'), ''), 'Competitor')
      end as cname
    from qualifying q
    join answers a on a.rid = q.rid,
    lateral jsonb_array_elements(a.competitor_mentions) x(e)
    left join competitors co
      on co.brand_id = p_brand_id and co.id::text = x.e ->> 'competitor_id'
    where coalesce((x.e ->> 'mention_count')::numeric, 0) > 0
  ),
  domain_names as (
    select ad.d, array_agg(distinct mn.cname order by mn.cname) as names
    from adomains ad
    join dtags t on t.d = ad.d and not t.is_you and not t.is_comp
    join mention_names mn on mn.rid = ad.rid
    group by ad.d
  ),
  totals as (
    select count(*)::bigint as total_answers,
           (count(*) filter (where f.we_present))::bigint as our_answer_count
    from flags f
  )
  select dr.d, dr.competitor_answers::bigint, dr.appears, dr.strength::float8,
         coalesce(dn.names, '{}'::text[]), t.our_answer_count, t.total_answers
  from domain_rows dr
  left join domain_names dn on dn.d = dr.d
  cross join totals t
  where dr.competitor_answers > 0 or dr.appears
  union all
  select null, 0, false, 0, '{}'::text[], t.our_answer_count, t.total_answers
  from totals t;
$$;

-- ─── Per-competitor source domains ──────────────────────────────────────────
-- (competitor, third-party domain) rows for the per-competitor source map.
-- Unlike the gap counters these accumulate from every answer mentioning the
-- competitor, whether or not we are present — alsoCitesUs comes from joining
-- the gap rows in the app tier. Keyed by the mention's competitor_id as
-- recorded (text), so mentions of since-deleted competitors keep counting,
-- exactly as the page behaves today.
create or replace function public.citation_competitor_sources(
  p_brand_id uuid,
  p_brand_domains text[],
  p_competitor_domains text[],
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  competitor_id text,
  domain text,
  answers_feeding bigint,
  strength double precision
)
language sql
stable
security definer
set search_path to 'public'
set work_mem to '96MB'
as $$
  with allowed as (
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ),
  answers as materialized (
    select pr.id as rid, pr.competitor_mentions
    from prompt_results pr
    where exists (select 1 from allowed)
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or pr.created_at >= p_date_from)
      and (p_date_to    is null or pr.created_at <= p_date_to)
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
  ),
  adomains as materialized (
    select distinct c.prompt_result_id as rid, cu.domain as d
    from prompt_result_citations c
    join citation_urls cu on cu.id = c.url_id
    where c.brand_id = p_brand_id
      and c.prompt_result_id in (select rid from answers)
  ),
  dtags as materialized (
    select s.d,
      exists (select 1 from unnest(p_brand_domains) e
              where s.d = e or right(s.d, length(e) + 1) = '.' || e) as is_you,
      exists (select 1 from unnest(p_competitor_domains) e
              where s.d = e or right(s.d, length(e) + 1) = '.' || e) as is_comp
    from (select distinct ad.d from adomains ad) s
  ),
  per_answer as (
    select ad.rid, 1.0 / count(*) as w
    from adomains ad group by ad.rid
  ),
  -- Expansion bounded to answers that actually mention someone; the jsonpath
  -- probe is far cheaper than expanding every answer's array.
  mentions as materialized (
    select a.rid, x.e ->> 'competitor_id' as competitor_id
    from answers a,
    lateral jsonb_array_elements(a.competitor_mentions) x(e)
    where coalesce(
            jsonb_path_exists(a.competitor_mentions, '$[*] ? (@.mention_count > 0)'),
            false
          )
      and coalesce((x.e ->> 'mention_count')::numeric, 0) > 0
  )
  select m.competitor_id, ad.d,
         count(distinct m.rid)::bigint as answers_feeding,
         sum(pa.w)::float8 as strength
  from mentions m
  join adomains ad on ad.rid = m.rid
  join dtags t on t.d = ad.d and not t.is_you and not t.is_comp
  join per_answer pa on pa.rid = m.rid
  group by m.competitor_id, ad.d;
$$;

revoke all on function public.citation_gap_domains(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) from public;
revoke all on function public.citation_competitor_sources(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) from public;

grant execute on function public.citation_gap_domains(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) to authenticated, service_role;
grant execute on function public.citation_competitor_sources(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) to authenticated, service_role;

comment on function public.citation_gap_domains(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Per-domain competitor co-occurrence for the Competitor Gaps tab (#777). Third-party domains only; one null-domain summary row carries the answer totals.';
comment on function public.citation_competitor_sources(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Per-competitor source domains for the Competitor Gaps tab (#777), keyed by the competitor id recorded in the mention.';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00069_citations_rpc_org_guard.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Put the org-membership guard on the five reachable citation RPCs (#779).
--
-- All five are `security definer` and cannot stop being so: they read
-- `citation_urls`, a cross-tenant dictionary with no select policy of its own,
-- so an invoker-rights version would return nothing to anyone. Definer rights
-- mean RLS is not consulted at all, and the only thing standing between an
-- authenticated caller and another organization's citation data was the web
-- tier passing the right `p_brand_id`. Practical exposure was small — brand
-- ids are unguessable uuids and the payloads are aggregates — but the tenant
-- boundary belongs in the database, where `report_citation_evidence` (00063)
-- and the gap functions (00068) already put it.
--
-- The guard is their `allowed` CTE, unchanged: a non-member's scan filters to
-- nothing rather than raising, so the page renders its empty state instead of
-- an error. `citation_url_ids` shares the definer pattern but carries no
-- `authenticated` grant, so it is unreachable and left alone.
--
-- Bodies are otherwise identical to 00061 and 00067 — the guard is the only
-- change, and a member's results are byte-for-byte what they were.
--
-- One consequence worth stating: `auth.uid()` is null under the service role,
-- so a service-role caller now reads empty. Nothing calls these that way today
-- (the five have exactly one caller, `web/src/lib/actions/citations.ts`, and
-- every call site uses the user-session client; the MCP layer runs its own
-- queries behind its own ownership check, and `server/src` never touches
-- them). A future service-role caller has to come through a user context or
-- change this deliberately — the comments below say so.

-- ─── Domains ────────────────────────────────────────────────────────────────
create or replace function public.citations_domains(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  domain text,
  total_citations bigint,
  results_citing bigint,
  models text[]
)
language sql
stable
security definer
set search_path to 'public'
set work_mem to '96MB'
as $$
  with allowed as (
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ),
  pairs as (
    select cu.domain as d, c.prompt_result_id as rid, count(*) as n,
           min(coalesce(pr.model_used, pr.platform)) as m
    from public.prompt_result_citations c
    join public.prompt_results pr on pr.id = c.prompt_result_id
    join public.citation_urls cu on cu.id = c.url_id
    where exists (select 1 from allowed)
      and c.brand_id = p_brand_id
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or (c.created_at >= p_date_from and pr.created_at >= p_date_from))
      and (p_date_to    is null or (c.created_at <= p_date_to   and pr.created_at <= p_date_to))
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
    group by cu.domain, c.prompt_result_id
  ),
  counts as (
    select d, sum(n)::bigint as tc, count(*)::bigint as rc from pairs group by d
  ),
  model_lists as (
    select d, array_agg(m order by m) as ms
    from (select distinct d, m from pairs) s
    group by d
  )
  select c.d, c.tc, c.rc, m.ms
  from counts c join model_lists m on m.d = c.d
  order by c.tc desc;
$$;

-- ─── URLs ───────────────────────────────────────────────────────────────────
create or replace function public.citations_urls(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null,
  p_limit integer default 2000
)
returns table (
  url text,
  domain text,
  title text,
  total_citations bigint,
  results_citing bigint,
  models text[],
  total_urls bigint
)
language sql
stable
security definer
set search_path = public
set work_mem = '96MB'
as $$
  with allowed as (
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ),
  pairs as (
    select c.url_id as uid, c.prompt_result_id as rid, count(*) as n,
           min(coalesce(pr.model_used, pr.platform)) as m
    from public.prompt_result_citations c
    join public.prompt_results pr on pr.id = c.prompt_result_id
    where exists (select 1 from allowed)
      and c.brand_id = p_brand_id
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or (c.created_at >= p_date_from and pr.created_at >= p_date_from))
      and (p_date_to    is null or (c.created_at <= p_date_to   and pr.created_at <= p_date_to))
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
    group by c.url_id, c.prompt_result_id
  ),
  agg as (
    select uid, sum(n)::bigint as tc, count(*)::bigint as rc, array_agg(distinct m) as ms
    from pairs group by uid
  )
  -- The dictionary is joined after the limit, so the URL text is fetched for
  -- the rows that survive rather than for all 117,316 of them.
  select cu.url, cu.domain, cu.title, a.tc, a.rc, a.ms,
         (select count(*)::bigint from agg)
  from (select * from agg order by tc desc, uid limit p_limit) a
  join public.citation_urls cu on cu.id = a.uid
  order by a.tc desc;
$$;

-- ─── Window stats ───────────────────────────────────────────────────────────
-- The one function whose shape survives the guard: it is a single aggregate
-- row, so a non-member reads zero answers and no regions rather than no row.
-- That is what the page's percentages already divide by when a window is
-- empty.
create or replace function public.citations_window_stats(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (results bigint, regions text[])
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  )
  select count(*)::bigint,
         coalesce(array_agg(distinct pr.region) filter (where pr.region is not null), '{}')
  from public.prompt_results pr
  where exists (select 1 from allowed)
    and pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'
    and (p_date_from  is null or pr.created_at >= p_date_from)
    and (p_date_to    is null or pr.created_at <= p_date_to)
    and (p_models     is null or pr.model_used = any(p_models))
    and (p_regions    is null or pr.region = any(p_regions))
    and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
    and (p_topic_ids  is null or pr.prompt_id in (
          select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)));
$$;

-- ─── URL detail: candidates ─────────────────────────────────────────────────
create or replace function public.citation_url_candidates(
  p_brand_id uuid,
  p_domain text
)
returns table (
  id bigint,
  url text,
  title text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with allowed as (
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  )
  select cu.id, cu.url, cu.title
  from public.citation_urls cu
  where exists (select 1 from allowed)
    and cu.domain = p_domain
    and exists (
      select 1 from public.prompt_result_citations c
      where c.url_id = cu.id and c.brand_id = p_brand_id
    );
$$;

-- ─── URL detail: occurrences ────────────────────────────────────────────────
create or replace function public.citation_url_occurrences(
  p_brand_id uuid,
  p_url_ids bigint[],
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  result_id uuid,
  prompt_id uuid,
  prompt_text text,
  platform text,
  model_used text,
  region text,
  created_at timestamptz,
  sentiment text,
  brand_mentioned boolean,
  citations_in_answer int,
  rank int,
  total_sources int
)
language sql
stable
security definer
set search_path to 'public'
set work_mem to '96MB'
as $$
  with allowed as (
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ),
  hits as (
    select c.prompt_result_id as rid,
           count(*)::int as cited,
           (min(c.position) + 1)::int as rnk
    from public.prompt_result_citations c
    where exists (select 1 from allowed)
      and c.brand_id = p_brand_id
      and c.url_id = any(p_url_ids)
      and (p_date_from is null or c.created_at >= p_date_from)
      and (p_date_to   is null or c.created_at <= p_date_to)
    group by c.prompt_result_id
  ),
  answers as (
    select h.rid, h.cited, h.rnk, pr.prompt_id, pr.platform, pr.model_used,
           pr.region, pr.created_at, pr.sentiment,
           coalesce(pr.mention_count, 0) > 0 as mentioned
    from hits h
    join public.prompt_results pr on pr.id = h.rid
    where pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or pr.created_at >= p_date_from)
      and (p_date_to    is null or pr.created_at <= p_date_to)
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
  ),
  -- Grouped once and joined, rather than counted per answer in a correlated
  -- subselect: the subselect re-probed the index for each of the 2,084 rows
  -- the busiest URL returns.
  sizes as (
    select a.prompt_result_id as rid, count(*)::int as total
    from public.prompt_result_citations a
    where a.prompt_result_id in (select rid from answers)
    group by a.prompt_result_id
  )
  select a.rid, a.prompt_id, p.text, a.platform, a.model_used, a.region,
         a.created_at, a.sentiment, a.mentioned, a.cited, a.rnk,
         coalesce(s.total, a.cited)
  from answers a
  left join sizes s on s.rid = a.rid
  left join public.prompts p on p.id = a.prompt_id
  order by a.created_at desc;
$$;

comment on function public.citations_domains(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Per-domain citation aggregates for the Citations page (#732). Returns every domain — the long tail is the point. Members of the brand''s organization only (#779): a service-role caller reads empty.';
comment on function public.citations_urls(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer) is
  'Per-URL citation aggregates for the Citations page (#732), capped at p_limit and ordered by citation count. Every row carries total_urls, the uncapped count. Members of the brand''s organization only (#779): a service-role caller reads empty.';
comment on function public.citations_window_stats(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Answers scanned and regions observed in a Citations window (#732) — the denominator for every usage percentage, including answers that cite nothing. Members of the brand''s organization only (#779): a service-role caller reads zero.';
comment on function public.citation_url_candidates(uuid, text) is
  'URLs on one domain that a brand has cited (#732), for the detail page to normalize and match in the app tier. Members of the brand''s organization only (#779): a service-role caller reads empty.';
comment on function public.citation_url_occurrences(uuid, bigint[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Answers citing any of the given URL ids (#732) — the per-URL citation detail table, one row per answer. Members of the brand''s organization only (#779): a service-role caller reads empty.';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00070_org_prompt_location_usage.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Aggregate the tracked-location quota count in Postgres (#691 part 1).
--
-- The web tier first computed it by selecting every prompt row's `regions`
-- and summing in JavaScript. PostgREST silently caps an un-paginated select
-- at 1000 rows (the #427/#450/#464 trap), and the failure direction is the
-- bad one: a truncated sum UNDER-counts, so the quota guard would let an org
-- past its plan limit without an error anywhere. The largest org holds 552
-- prompt rows today, but part 2 of #691 multiplies rows into locations, so
-- the ceiling was already in reach. Aggregating here means no rows travel at
-- all — and the bulk-add path, which runs one guard check per prompt in
-- parallel, stops downloading the org's whole roster N times over.
--
-- One row per brand rather than a single org total: savePromptSet replaces a
-- brand's whole set, so its cap check and the wizards' capacity endpoint
-- need "the org minus this brand", which the caller derives from these rows.
--
-- A prompt's location count is `greatest(coalesce(array_length(regions,1),0),1)`
-- — one per region entry, minimum one, because the tracking worker runs a
-- prompt with no regions once (`regions or [null]`). This mirrors
-- `promptLocationCount` in web/src/lib/prompt-locations.ts exactly; the two
-- definitions must not drift.
--
-- SECURITY INVOKER on purpose, unlike the citation RPCs (#780): prompts,
-- prompt_sets and brands all carry org-membership select policies, so RLS
-- already scopes the aggregation to the caller's own org — a foreign
-- organization id simply aggregates zero visible rows.
create or replace function public.org_prompt_location_usage(p_organization_id uuid)
returns table (brand_id uuid, locations bigint)
language sql
stable
set search_path to 'public'
as $$
  select b.id, sum(greatest(coalesce(array_length(p.regions, 1), 0), 1))::bigint
  from public.prompts p
  join public.prompt_sets ps on ps.id = p.prompt_set_id
  join public.brands b on b.id = ps.brand_id
  where b.organization_id = p_organization_id
  group by b.id;
$$;

revoke all on function public.org_prompt_location_usage(uuid) from public;
grant execute on function public.org_prompt_location_usage(uuid) to authenticated, service_role;

comment on function public.org_prompt_location_usage(uuid) is
  'Tracked prompt locations per brand for one org (#691) — the plan-quota unit, one per region entry per prompt, minimum one. Security invoker: RLS scopes it to the caller''s org.';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00071_prompt_state_locations.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Move state targeting from the brand onto the prompt (#691 part 2).
--
-- APPLY AFTER DEPLOYING THE SERVER, not before. The running worker passes a
-- prompt's region straight through as the Cloro `country` field, so a row
-- reading `US-DE` would be submitted as country "US-DE" and rejected — this
-- brand's tracking would fail until the deploy landed. The new worker parses
-- the code first, so once it is live the order no longer matters.
--
-- `brands.state` was a single USPS code the tracking worker applied to every
-- US task the brand ran (#554). Targeting now lives on the prompt, as a
-- location code in `prompts.regions` (`US-CA`), so different prompts can
-- track different places — and the worker no longer reads `brands.state` at
-- all. Left alone, that would silently downgrade the brands that had a state
-- set: their prompts would keep saying `US` and start running country-wide.
--
-- So fold the brand's state into its own prompts' `US` entries, once. Other
-- countries are untouched: the state only ever applied to US tasks.
--
-- Quota is unaffected — a prompt targeting `US-DE` tracks exactly one
-- location, the same as one targeting `US` (#691 part 1 counts entries, not
-- codes), so no org's usage or limit standing moves.
--
-- The column itself stays, with a narrower job: it is the DEFAULT location
-- offered to prompts created for that brand, not a tracking-time override.
-- Two sources of truth for "where does this prompt run" is exactly the
-- conflict this migration removes.
update public.prompts p
set regions = (
  select array_agg(
    case when r = 'US' then 'US-' || b.state else r end
    order by idx
  )
  from unnest(p.regions) with ordinality as t(r, idx)
)
from public.prompt_sets ps, public.brands b
where ps.id = p.prompt_set_id
  and b.id = ps.brand_id
  and b.state is not null
  and b.state ~ '^[A-Z]{2}$'
  and 'US' = any(p.regions);

comment on column public.brands.state is
  'Default US state for prompts created for this brand (#691). Targeting itself lives in prompts.regions as location codes (US-CA); the tracking worker does not read this column.';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00072_prompt_visibility_summaries_region.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Let the per-prompt health column answer "…in which location?" (#691).
--
-- Prompts can now be tracked in several places at once, so a single blended
-- number per prompt hides the thing multi-location tracking was bought for:
-- a prompt can be strong at home and invisible in Germany, and the All
-- Prompts table averaged the two into one figure with no way to split them.
-- Every other analytical surface already takes a region — Insights, the
-- citation RPCs, the KPI cards — this one was the gap.
--
-- The parameter is appended with a NULL default, and NULL keeps the previous
-- whole-brand behaviour exactly, so callers that don't pass it are unchanged.
--
-- The 3-argument signature is dropped rather than left in place: with both
-- installed, a 3-argument call would match the old function AND the new one
-- through its default, which Postgres rejects as ambiguous. Dropping it is
-- safe across the deploy window because PostgREST passes arguments by name —
-- the running app's 3-name call binds to the new function and takes the
-- default.
DROP FUNCTION IF EXISTS public.prompt_visibility_summaries(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to   timestamptz DEFAULT NULL,
  p_region    text DEFAULT NULL
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
    AND (p_region    IS NULL OR pr.region = p_region)
  GROUP BY pr.prompt_id
$$;

GRANT EXECUTE ON FUNCTION
  public.prompt_visibility_summaries(uuid, timestamptz, timestamptz, text)
  TO authenticated;

COMMENT ON FUNCTION
  public.prompt_visibility_summaries(uuid, timestamptz, timestamptz, text) IS
  'Per-prompt visibility/mention aggregates for the All Prompts table. p_region scopes to one tracked location (#691); NULL blends every location, as before.';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00073_clear_derived_logo_urls.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Migration: 00073_clear_derived_logo_urls
--
-- Context (issue #759):
--   logo_url was written at brand creation and on every primary-domain change
--   using Google's s2/favicons service. The new BrandAvatar component derives
--   the favicon at render time instead (Google → /favicon.ico → initials), so
--   logo_url should only hold a URL the user explicitly chose.
--
-- Effect:
--   Clears the derived Google favicon URLs so existing brands reach the
--   fallback chain. The single brand with logo_url = null already did.
--   Manual URLs (2 rows in production at time of writing) are unaffected
--   because they do not match the s2/favicons pattern.
--
-- Safe to re-run: WHERE clause is idempotent.

update brands
set logo_url = null
where logo_url like '%s2/favicons%';

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/00074_apply_prompt_locations.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Apply a bulk retargeting of prompt locations in one statement (#691).
--
-- Retargeting a selection is the one prompt edit that meters against the plan:
-- adding a location to forty prompts costs forty locations. Looping the
-- single-prompt action over the selection would read, check and write once per
-- prompt, and the failure mode is the bad one — the twenty-first write hits the
-- cap and the operation stops half-applied, with no way back and a bill for
-- what did land. One statement makes the batch all-or-nothing.
--
-- The caller passes the finished per-prompt result rather than the operation to
-- perform. Add/remove semantics, the "never leave a prompt with zero locations"
-- rule and the quota arithmetic all live in `planBulkLocationChange`
-- (web/src/lib/prompt-locations.ts), which the dialog also runs to price the
-- change before the click. Re-implementing that here would give the preview and
-- the write two definitions that can drift; this function only stores what it
-- is given.
--
-- SECURITY INVOKER, like org_prompt_location_usage (00070): `prompts` carries
-- an admin/manager update policy through its prompt set's brand, so RLS decides
-- which ids a caller may touch. Ids outside the caller's organization simply
-- match no row, and the returned count reflects that.
--
-- The plan cap itself stays in the app tier, because the limit lives in the
-- plan config rather than the database (`maxPrompts`, with enterprise
-- overrides). A concurrent write between the check and this call could still
-- carry an org a few locations past its cap — the same window the single-prompt
-- path has always had, and bounded by what one batch can add.
create or replace function public.apply_prompt_locations(p_updates jsonb)
returns bigint
language sql
volatile
security invoker
set search_path to 'public'
as $$
  with wanted as (
    select (e ->> 'id')::uuid as id,
           array(select jsonb_array_elements_text(e -> 'regions')) as regions
    from jsonb_array_elements(p_updates) e
  ),
  applied as (
    update public.prompts p
    set regions = w.regions
    from wanted w
    -- The empty guard is defence in depth: a prompt with no location is not
    -- tracked at all, and the planner already refuses to produce one.
    where p.id = w.id
      and coalesce(array_length(w.regions, 1), 0) > 0
    returning 1
  )
  select count(*)::bigint from applied;
$$;

revoke all on function public.apply_prompt_locations(jsonb) from public;
grant execute on function public.apply_prompt_locations(jsonb) to authenticated, service_role;

comment on function public.apply_prompt_locations(jsonb) is
  'Bulk-writes prompt tracking locations from [{id, regions}] (#691), one statement so a batch cannot land half-applied. Security invoker: RLS decides which prompts the caller may retarget.';

