import { tool } from 'ai';
import { z } from 'zod';
import type { McpAuthContext } from '@/lib/mcp-auth';
import {
  CONTENT_OPPORTUNITY_STATUSES,
  getCompetitorComparisonFor,
  getVisibilitySummaryFor,
  getVisibilityTrendFor,
  listBrandsFor,
  listCitationsFor,
  listContentOpportunitiesFor,
  listPromptsFor,
  listTopicsFor,
  getPromptPerformanceFor,
  runSiteAuditFor,
  getSiteAuditFor,
  listSiteAuditsFor,
} from '@/lib/mcp/data';

/**
 * Vercel AI SDK tool definitions for the in-product agent. Each tool is a
 * thin wrapper around the same MCP data function the external MCP server
 * exposes — `list_brands` is `listBrandsFor`, etc. — so the agent sees the
 * exact same data Claude Desktop / Cursor users see, with the same
 * org-ownership scoping. We don't duplicate any aggregation logic here.
 *
 * Tool names are kept identical to the MCP tool ids so the system prompt's
 * tool list reads the same in both surfaces.
 */
export function buildAgentTools(auth: McpAuthContext) {
  return {
    list_brands: tool({
      description:
        'List the brands the authenticated user can access. Returns id, name, slug, industry, region, created_at. Call this first when the user has not named a brand.',
      inputSchema: z.object({}),
      execute: async () => listBrandsFor(auth),
    }),

    get_visibility_summary: tool({
      description:
        'Get aggregate visibility metrics for a brand over an optional date range. Returns result count, average visibility (0-100), total mentions, total citations, and the top 5 competitors by mention count. Use for snapshot / "how is my brand doing" questions.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        model: z.string().optional(),
        region: z.string().optional(),
      }),
      execute: async (args) =>
        getVisibilitySummaryFor(auth, {
          brandId: args.brand_id,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          model: args.model,
          region: args.region,
        }),
    }),

    get_visibility_trend: tool({
      description:
        'Visibility / mentions / citations over time for a brand, bucketed by day or week. Each bucket includes avg_visibility_score, total_mentions, total_citations, avg_competitor_score. Use for trend questions and as the data source for charts.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        granularity: z.enum(['day', 'week']).optional(),
        model: z.string().optional(),
        region: z.string().optional(),
        topic_id: z.string().uuid().optional(),
      }),
      execute: async (args) =>
        getVisibilityTrendFor(auth, {
          brandId: args.brand_id,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          model: args.model,
          region: args.region,
          topicId: args.topic_id,
          granularity: args.granularity,
        }),
    }),

    get_competitor_comparison: tool({
      description:
        'Competitor benchmark + share of voice for a brand. Returns the brand and every tracked competitor with avg_visibility_score, total_mentions, total_citations, appearance_count, plus overall_sov_pct and a per-(model_used, platform) SoV split.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        model: z.string().optional(),
        region: z.string().optional(),
        topic_id: z.string().uuid().optional(),
      }),
      execute: async (args) =>
        getCompetitorComparisonFor(auth, {
          brandId: args.brand_id,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          model: args.model,
          region: args.region,
          topicId: args.topic_id,
        }),
    }),

    list_citations: tool({
      description:
        'URLs and domains AI engines cite alongside a brand, classified by source type (news / review / owned / social / forum / competitor / you). Returns totals, source_type_breakdown, top_domains, top_urls. Pass source_filter: "owned" to isolate the brand\'s own cited URLs (e.g. "which of OUR URLs did AI cite?"), "competitor" for competitor domains, "external" for everything else.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        model: z.string().optional(),
        region: z.string().optional(),
        topic_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        source_filter: z
          .enum(['all', 'owned', 'competitor', 'external'])
          .optional()
          .describe(
            'Scope by source: "owned" = brand\'s own domains, "competitor" = tracked competitors, "external" = neither, "all" = no filter (default).',
          ),
      }),
      execute: async (args) =>
        listCitationsFor(auth, {
          brandId: args.brand_id,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          model: args.model,
          region: args.region,
          topicId: args.topic_id,
          limit: args.limit,
          sourceFilter: args.source_filter,
        }),
    }),

    list_topics: tool({
      description:
        'List topics for a brand, each with prompt_count. Use for coverage audits or before drilling into prompts on a theme.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
      }),
      execute: async (args) => listTopicsFor(auth, args.brand_id),
    }),

    list_prompts: tool({
      description:
        'List the prompts tracked for a brand, optionally filtered by topic or active status. Returns each prompt with text, topic, platforms, models, regions, is_active.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        topic_id: z.string().uuid().optional(),
        is_active: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      execute: async (args) =>
        listPromptsFor(auth, {
          brandId: args.brand_id,
          topicId: args.topic_id,
          isActive: args.is_active,
          limit: args.limit,
        }),
    }),

    list_content_opportunities: tool({
      description:
        'List content opportunities / gaps for a brand, sorted by opportunity score descending. Use for "what should I write?" / strategy-priority questions.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        status: z.enum(CONTENT_OPPORTUNITY_STATUSES).optional(),
        impact: z.enum(['high', 'medium', 'low']).optional(),
        type: z.enum(['owned', 'earned']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async (args) =>
        listContentOpportunitiesFor(auth, {
          brandId: args.brand_id,
          status: args.status,
          impact: args.impact,
          type: args.type,
          limit: args.limit,
        }),
    }),

    get_prompt_performance: tool({
      description:
        'Get aggregate performance metrics (average visibility, total mentions, citations, appearances, and competitor score) grouped by prompt over a date range. Use to answer questions like "what is the best-performing prompt today?" or "which prompts dropped this week?".',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        topic_id: z.string().uuid().optional(),
        sort_by: z.enum(['visibility', 'mentions', 'citations', 'appearances']).optional(),
        order: z.enum(['desc', 'asc']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        model: z.string().optional(),
        region: z.string().optional(),
      }),
      execute: async (args) =>
        getPromptPerformanceFor(auth, {
          brandId: args.brand_id,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          topicId: args.topic_id,
          sortBy: args.sort_by,
          order: args.order,
          limit: args.limit,
          model: args.model,
          region: args.region,
        }),
    }),

    run_site_audit: tool({
      description:
        'Run a Site Audit (AEO/GEO page score + AI fix recommendations) for a page URL under a brand. WARNING: this consumes one of the org\'s monthly Site Audit credits (shared with the dashboard) and runs asynchronously (~30s). It returns the new audit id with status "running" — then call get_site_audit with that id until status is "completed" (or "failed") to read the result. Only run on explicit user intent to audit a specific URL; never audit unprompted.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        url: z.string().url(),
      }),
      execute: async (args) => runSiteAuditFor(auth, args.brand_id, args.url),
    }),

    get_site_audit: tool({
      description:
        'Fetch a Site Audit by id — status, total score, per-category scores, evaluated signals, and AI fix recommendations. Use after run_site_audit to poll for the result: while status is "running" the scores are not yet populated; once "completed" (or "failed") the full result is available. Read — no credit consumed.',
      inputSchema: z.object({
        audit_id: z.string().uuid(),
      }),
      execute: async (args) => getSiteAuditFor(auth, args.audit_id),
    }),

    list_site_audits: tool({
      description:
        "List a brand's recent Site Audits (newest first) — id, url, status, total score, signals, and created date. Use to find a past audit by url/date (then read it with get_site_audit) without needing the id. Read — no credit consumed.",
      inputSchema: z.object({
        brand_id: z.string().uuid(),
      }),
      execute: async (args) => listSiteAuditsFor(auth, args.brand_id),
    }),

    render_chart: tool({
      description:
        'Render a chart inline in the chat. Call this AFTER you have the data from another tool (e.g. get_visibility_trend, get_competitor_comparison, list_citations) and you want to visualize it. Pick the chart type: "line" for time series (trends over dates), "bar" for cross-entity comparisons (brand vs competitors, source-type breakdown), "pie" for share-of-X distributions. Pass the data array straight from the previous tool result — never invent or reformat numbers. The tool just echoes the spec back; the UI renders the chart.',
      inputSchema: z.object({
        type: z
          .enum(['line', 'bar', 'pie'])
          .describe('line = time series, bar = cross-entity comparison, pie = share distribution'),
        title: z
          .string()
          .max(120)
          .optional()
          .describe('Optional short title shown above the chart'),
        data: z
          .array(z.record(z.string(), z.union([z.string(), z.number()])))
          .min(1)
          .max(200)
          .describe('Array of objects. Each row is one point/bar/slice. Max 200 rows.'),
        xKey: z
          .string()
          .optional()
          .describe(
            'For line / bar: the key on each row that holds the x-axis label (e.g. "date" or "competitor").',
          ),
        series: z
          .array(
            z.object({
              key: z.string().describe('Key on each row that holds this series value.'),
              label: z.string().describe('Human-readable name shown in legend / tooltip.'),
              color: z.string().optional().describe('Optional hex / CSS color override.'),
            }),
          )
          .max(5)
          .optional()
          .describe('For line / bar: one entry per measured series. Up to 5.'),
        valueKey: z
          .string()
          .optional()
          .describe('For pie: the key on each row that holds the numeric slice value.'),
        labelKey: z
          .string()
          .optional()
          .describe('For pie: the key on each row that holds the slice label.'),
      }),
      execute: async (args) => args,
    }),
  };
}
