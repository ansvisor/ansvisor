import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { McpAuthContext } from '@/lib/mcp-auth';
import {
  CONTENT_OPPORTUNITY_STATUSES,
  generateBriefFor,
  getCompetitorComparisonFor,
  getContentOpportunityFor,
  getVisibilitySummaryFor,
  getVisibilityTrendFor,
  listBrandsFor,
  listCitationsFor,
  listContentOpportunitiesFor,
  listPromptsFor,
  listTopicsFor,
  updateOpportunityStatusFor,
  getAiTrafficFor,
  getPromptVolumesFor,
  listShoppingCards,
  getProductVisibility,
  getPromptPerformanceFor,
  runSiteAuditFor,
  getSiteAuditFor,
  listSiteAuditsFor,
  getSiteAuditQuotaFor,
} from './data';

/**
 * Build a fresh MCP server bound to a single authenticated request.
 *
 * Each call creates a new `McpServer` with tool handlers that close over the
 * `auth` context. The Streamable HTTP route uses this in stateless mode, so
 * connect/run/discard per request — no shared state.
 */
const relaxedUuid = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'Invalid UUID format',
  );

export function createMcpServer(auth: McpAuthContext): McpServer {
  const server = new McpServer({
    name: 'ansvisor',
    version: '0.1.0',
  });

  server.registerTool(
    'list_brands',
    {
      description:
        'List the brands the authenticated user can access. Returns one row per brand with id, name, slug, industry, region, and creation date. Always call this first to resolve a brand id before using other tools.',
      inputSchema: {},
    },
    async () => {
      const brands = await listBrandsFor(auth);
      return {
        content: [{ type: 'text', text: JSON.stringify(brands, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_visibility_summary',
    {
      description:
        'Get aggregate visibility metrics for a brand over an optional date range and filter. Returns result count, average visibility score (0-100), total mentions, total citations, and the top 5 competitors by mention count. Use this for "how is my brand doing" / "what changed" style questions.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        date_from: z
          .string()
          .optional()
          .describe('ISO timestamp (inclusive) lower bound, e.g. 2026-05-01T00:00:00Z.'),
        date_to: z.string().optional().describe('ISO timestamp (inclusive) upper bound.'),
        model: z
          .string()
          .optional()
          .describe(
            'Optional model slug filter, or comma-separated list of slugs to filter a provider family.',
          ),
        region: z.string().optional().describe('Optional region code filter (e.g. "US", "TR").'),
      },
    },
    async (args) => {
      const summary = await getVisibilitySummaryFor(auth, {
        brandId: args.brand_id,
        dateFrom: args.date_from,
        dateTo: args.date_to,
        model: args.model,
        region: args.region,
      });
      if (!summary) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      };
    },
  );

  server.registerTool(
    'list_topics',
    {
      description:
        'List topics for a brand, each with the number of prompts attached to it. Use this to audit prompt coverage ("are any topics empty / under-represented?") or before drilling into prompts for a specific theme. Topic-less prompts are not counted here — call list_prompts without a topic filter to see them.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
      },
    },
    async (args) => {
      const topics = await listTopicsFor(auth, args.brand_id);
      if (topics === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(topics, null, 2) }],
      };
    },
  );

  server.registerTool(
    'list_prompts',
    {
      description:
        'List the prompts tracked for a brand, optionally filtered by topic or active status. Returns each prompt with its text, topic, platforms, models, regions, and active flag. Use this when the user asks what is being tracked, wants to drill into a specific topic, or wants to spot inactive / mis-targeted prompts.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        topic_id: relaxedUuid
          .optional()
          .describe('Optional topic UUID (from list_topics) to filter to one topic.'),
        is_active: z
          .boolean()
          .optional()
          .describe('Optional filter — true returns only active prompts, false only inactive.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Optional row cap (default 100, max 500). Newest prompts come first.'),
      },
    },
    async (args) => {
      const prompts = await listPromptsFor(auth, {
        brandId: args.brand_id,
        topicId: args.topic_id,
        isActive: args.is_active,
        limit: args.limit,
      });
      if (prompts === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(prompts, null, 2) }],
      };
    },
  );

  server.registerTool(
    'list_content_opportunities',
    {
      description:
        'List content opportunities / gaps for a brand, showing which prompts represent the highest-impact areas where the brand is currently losing visibility. Sorts by opportunity score descending by default. Use this to audit open gaps, see what content needs to be written, or list open strategy priorities.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        status: z
          .enum(['new', 'sent', 'in_progress', 'done', 'dismissed'])
          .optional()
          .describe('Filter by progress status of the opportunity.'),
        impact: z
          .enum(['high', 'medium', 'low'])
          .optional()
          .describe('Filter by estimated AEO visibility impact level.'),
        type: z
          .enum(['owned', 'earned'])
          .optional()
          .describe(
            'Filter by channel type: owned (e.g. self-published blogs/pages) vs earned (e.g. PR/affiliate sites).',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Row cap limit (default 50, max 200).'),
      },
    },
    async (args) => {
      const opportunities = await listContentOpportunitiesFor(auth, {
        brandId: args.brand_id,
        status: args.status,
        impact: args.impact,
        type: args.type,
        limit: args.limit,
      });
      if (opportunities === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(opportunities, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_content_opportunity',
    {
      description:
        'Get full details of a specific content opportunity, including raw AI visibility gap metrics, intent, competitor references, and the generated content brief if one already exists. Use this when the user picks a specific opportunity from the list and wants to inspect it further or start writing.',
      inputSchema: {
        opportunity_id: relaxedUuid.describe(
          'Content opportunity UUID, from list_content_opportunities.',
        ),
      },
    },
    async (args) => {
      const opportunity = await getContentOpportunityFor(auth, args.opportunity_id);
      if (!opportunity) {
        return {
          content: [{ type: 'text', text: 'Content opportunity not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(opportunity, null, 2) }],
      };
    },
  );

  server.registerTool(
    'generate_content_brief',
    {
      description:
        'Generate a fresh AI-powered content brief for a specific content opportunity. WARNING: this triggers an LLM call (cost + latency) and ALWAYS re-generates, overwriting any existing brief on the opportunity. Use only after list_content_opportunities + get_content_opportunity and only when the user has explicitly asked to generate or refresh a brief for a specific opportunity — never as part of exploratory queries. To read an existing brief without an LLM call, use get_content_opportunity instead.',
      inputSchema: {
        opportunity_id: relaxedUuid.describe(
          'Content opportunity UUID, from list_content_opportunities.',
        ),
      },
    },
    async (args) => {
      const result = await generateBriefFor(auth, args.opportunity_id);
      if (!result) {
        return {
          content: [{ type: 'text', text: 'Content opportunity not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'run_site_audit',
    {
      description:
        'Run a Site Audit (AEO/GEO page score + AI fix recommendations) for a page URL under a brand. WARNING: this consumes one of the org\'s monthly Site Audit credits (the same pool as the dashboard) and runs asynchronously (~30s). It returns immediately with the new audit id and status "running" — then poll get_site_audit with that id until status is "completed" (or "failed") to read the result. Only fire on explicit user intent to audit a specific URL, never as part of exploratory queries.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        url: z.string().url().describe('Full URL of the page to audit, including https://.'),
      },
    },
    async (args) => {
      const result = await runSiteAuditFor(auth, args.brand_id, args.url);
      if (!result) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_site_audit',
    {
      description:
        'Fetch a Site Audit by id — its status, total score, per-category scores, evaluated signals, and AI fix recommendations. Use after run_site_audit to poll for the result: while status is "running" the scores are not yet populated; once it is "completed" (or "failed") the full result is available. This is a read — no credit is consumed.',
      inputSchema: {
        audit_id: relaxedUuid.describe('Site audit UUID, from run_site_audit.'),
      },
    },
    async (args) => {
      const audit = await getSiteAuditFor(auth, args.audit_id);
      if (!audit) {
        return {
          content: [{ type: 'text', text: 'Audit not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(audit, null, 2) }],
      };
    },
  );

  server.registerTool(
    'list_site_audits',
    {
      description:
        "List a brand's recent Site Audits (newest first) — id, url, status, total score, signals evaluated, and created date. Use this to find a past audit by url or date (then read it in full with get_site_audit) without needing the audit id. This is a read — no credit is consumed.",
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
      },
    },
    async (args) => {
      const audits = await listSiteAuditsFor(auth, args.brand_id);
      if (!audits) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(audits, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_site_audit_quota',
    {
      description:
        "Check the org's monthly Site Audit allowance — { used, limit, remaining } (limit -1 means unlimited). Use this before run_site_audit to see how many audit credits remain this month. This is a read — no credit is consumed.",
      inputSchema: {},
    },
    async () => {
      const quota = await getSiteAuditQuotaFor(auth);
      if (!quota) {
        return {
          content: [{ type: 'text', text: 'No organization found for this API key' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(quota, null, 2) }],
      };
    },
  );

  server.registerTool(
    'update_opportunity_status',
    {
      description:
        'Move a content opportunity between workflow states. Valid statuses are: "new" (just generated), "sent" (delivered to a CMS / writer via webhook), "in_progress" (someone is actively writing), "done" (published), "dismissed" (intentionally skipped). Use this to close the loop on the content backlog from inside an MCP conversation — e.g. "mark that opportunity as in_progress" once the user starts writing, or "dismiss this one, we already cover it." This is a write — only fire on explicit user intent for a specific opportunity, never as part of an exploratory query.',
      inputSchema: {
        opportunity_id: relaxedUuid.describe(
          'Content opportunity UUID, from list_content_opportunities.',
        ),
        status: z
          .enum(CONTENT_OPPORTUNITY_STATUSES)
          .describe('New workflow state. One of: new, sent, in_progress, done, dismissed.'),
      },
    },
    async (args) => {
      const updated = await updateOpportunityStatusFor(auth, args.opportunity_id, args.status);
      if (!updated) {
        return {
          content: [{ type: 'text', text: 'Content opportunity not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_competitor_comparison',
    {
      description:
        'Get a brand\'s competitor benchmark and share of voice for a window. Returns the brand and every tracked competitor with avg visibility score (0-100), total mentions, total citations, and how many tracked prompt results each appeared in. Also returns overall share-of-voice as a percentage (brand mentions / (brand + competitor mentions)) and the same split per (model_used, platform). Use this for "how do I compare to my competitors?" or "who is gaining share of voice?" style questions. This is a snapshot for the given window — call again with an earlier window to compute a delta.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        date_from: z
          .string()
          .optional()
          .describe('ISO timestamp (inclusive) lower bound, e.g. 2026-05-01T00:00:00Z.'),
        date_to: z.string().optional().describe('ISO timestamp (inclusive) upper bound.'),
        model: z
          .string()
          .optional()
          .describe(
            'Optional model slug filter, or comma-separated list of slugs to filter a provider family.',
          ),
        region: z.string().optional().describe('Optional region code filter (e.g. "US", "TR").'),
        topic_id: relaxedUuid
          .optional()
          .describe('Optional topic UUID (from list_topics) to restrict to one topic.'),
      },
    },
    async (args) => {
      const result = await getCompetitorComparisonFor(auth, {
        brandId: args.brand_id,
        dateFrom: args.date_from,
        dateTo: args.date_to,
        model: args.model,
        region: args.region,
        topicId: args.topic_id,
      });
      if (!result) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'list_citations',
    {
      description:
        'List the URLs and domains AI engines cite alongside a brand, classified by source type (news / review / owned / social / forum / competitor / you). Returns totals, a source-type breakdown, and the top cited domains + URLs (each with citation count, results citing, usage %, and article-type guess where available). Use this for "which sources cite me?", "which competitor sites get pulled?", or "what kinds of pages does AI cite?" questions. Snapshot for the given window — call again with an earlier window to compute a delta.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        date_from: z
          .string()
          .optional()
          .describe('ISO timestamp (inclusive) lower bound, e.g. 2026-05-01T00:00:00Z.'),
        date_to: z.string().optional().describe('ISO timestamp (inclusive) upper bound.'),
        model: z
          .string()
          .optional()
          .describe(
            'Optional model slug filter, or comma-separated list of slugs to filter a provider family.',
          ),
        region: z.string().optional().describe('Optional region code filter (e.g. "US", "TR").'),
        topic_id: relaxedUuid
          .optional()
          .describe('Optional topic UUID (from list_topics) to restrict to one topic.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Row cap on top_domains / top_urls (default 50, max 200).'),
        source_filter: z
          .enum(['all', 'owned', 'competitor', 'external'])
          .optional()
          .describe(
            'Scope by source category: "owned" = the brand\'s own domains only, "competitor" = tracked competitor domains only, "external" = everything else (editorial / forum / social / review / etc.), "all" = no filter (default). Use "owned" to answer "which of OUR URLs did AI cite?".',
          ),
      },
    },
    async (args) => {
      const result = await listCitationsFor(auth, {
        brandId: args.brand_id,
        dateFrom: args.date_from,
        dateTo: args.date_to,
        model: args.model,
        region: args.region,
        topicId: args.topic_id,
        limit: args.limit,
        sourceFilter: args.source_filter,
      });
      if (!result) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_visibility_trend',
    {
      description:
        'Get a brand\'s visibility over time for a date range, bucketed by day or week. Returns one bucket per period with result_count, avg_visibility_score (0-100), total_mentions, total_citations, and avg_competitor_score (mean of competitor visibility scores from the same period, or null if no competitors were mentioned). Use this for "how has my visibility changed?" trend questions and to render brand-vs-competitor line charts. Complements get_visibility_summary, which is a single-window snapshot.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        date_from: z
          .string()
          .optional()
          .describe('ISO timestamp (inclusive) lower bound, e.g. 2026-05-01T00:00:00Z.'),
        date_to: z.string().optional().describe('ISO timestamp (inclusive) upper bound.'),
        granularity: z
          .enum(['day', 'week'])
          .optional()
          .describe('Bucket size — "day" (default) or "week" (ISO Monday-start weeks).'),
        model: z
          .string()
          .optional()
          .describe(
            'Optional model slug filter, or comma-separated list of slugs to filter a provider family.',
          ),
        region: z.string().optional().describe('Optional region code filter (e.g. "US", "TR").'),
        topic_id: relaxedUuid
          .optional()
          .describe('Optional topic UUID (from list_topics) to restrict to one topic.'),
      },
    },
    async (args) => {
      const result = await getVisibilityTrendFor(auth, {
        brandId: args.brand_id,
        dateFrom: args.date_from,
        dateTo: args.date_to,
        model: args.model,
        region: args.region,
        topicId: args.topic_id,
        granularity: args.granularity,
      });
      if (!result) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_ai_traffic',
    {
      description:
        'Get AI-referral traffic analytics for a brand over an optional date range. Returns total visits, platform breakdown (visits per AI engine), top landing pages, and country segmentation. Use this to answer questions about traffic referred by ChatGPT, Claude, Perplexity, Gemini, Copilot, etc.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        date_from: z
          .string()
          .optional()
          .describe('Optional ISO timestamp (inclusive) lower bound, e.g. 2026-05-01T00:00:00Z.'),
        date_to: z.string().optional().describe('Optional ISO timestamp (inclusive) upper bound.'),
      },
    },
    async (args) => {
      const result = await getAiTrafficFor(auth, {
        brandId: args.brand_id,
        dateFrom: args.date_from,
        dateTo: args.date_to,
      });
      if (!result) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_prompt_volumes',
    {
      description:
        'Get per-prompt search demand and competition for a brand. Returns one row per analyzed prompt with its keywords, Google search volumes, total_google_volume, est_ai_volume (estimated AI search demand), competition_index (0-100), and competition label (LOW / MEDIUM / HIGH). Sorted by est_ai_volume descending. Use this for "which prompts have the most demand?" or "which prompts have the least competition?" prioritization questions. Only returns prompts that already have volume analysis — triggering a new analysis is not available here.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Optional row cap (default 100, max 500). Highest AI demand comes first.'),
      },
    },
    async (args) => {
      const volumes = await getPromptVolumesFor(auth, {
        brandId: args.brand_id,
        limit: args.limit,
      });
      if (volumes === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(volumes, null, 2) }],
      };
    },
  );

  server.registerTool(
    'list_shopping_cards',
    {
      description:
        'List normalized shopping cards for a brand, showing which products are surfaced by AI engines in commercial-intent contexts. Supports filtering by matched brand role ("own" | "competitor" | "other"), platform, and region. Pagination is cursor-based (default limit 50, max 200). Use this to see which product brands, URLs, and prices are visible in search results.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        role: z
          .enum(['own', 'competitor', 'other'])
          .optional()
          .describe(
            'Filter by role relationship of the matched brand: "own" (this brand), "competitor" (tracked competitors), or "other" (untracked brands).',
          ),
        platform: z
          .string()
          .optional()
          .describe(
            'Optional scraper/platform filter (e.g. "chatgpt-shopping", "perplexity-web").',
          ),
        region: z.string().optional().describe('Optional region code filter (e.g. "US", "TR").'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Optional limit (default 50, max 200).'),
        cursor: z
          .string()
          .optional()
          .describe('Base64 encoded pagination cursor from next_cursor.'),
      },
    },
    async (args) => {
      const result = await listShoppingCards(auth, {
        brandId: args.brand_id,
        role: args.role,
        platform: args.platform,
        region: args.region,
        limit: args.limit,
        cursor: args.cursor,
      });
      if (result === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_product_visibility',
    {
      description:
        "Get aggregate visibility metrics for a specific product title across platforms, regions, and dates. Returns total appearances, platform breakdown, region breakdown, chronological trend of dates, average rating, total reviews, and associated merchant domains. Use this to audit a single product's performance and organic footprint in AI-driven shopping results.",
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        product_title: z.string().describe('The product title/name to query.'),
      },
    },
    async (args) => {
      const result = await getProductVisibility(auth, {
        brandId: args.brand_id,
        productTitle: args.product_title,
      });
      if (result === null) {
        return {
          content: [{ type: 'text', text: 'Product or Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_prompt_performance',
    {
      description:
        'Get aggregate performance metrics (average visibility, total mentions, citations, appearances, and competitor score) grouped by prompt over a date range. Use to answer questions like "what is the best-performing prompt today?" or "which prompts dropped this week?".',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        date_from: z
          .string()
          .optional()
          .describe('Optional ISO timestamp (inclusive) lower bound, e.g. 2026-05-01T00:00:00Z.'),
        date_to: z.string().optional().describe('Optional ISO timestamp (inclusive) upper bound.'),
        topic_id: relaxedUuid
          .optional()
          .describe('Optional topic UUID (from list_topics) to filter to one topic.'),
        sort_by: z
          .enum(['visibility', 'mentions', 'citations', 'appearances'])
          .optional()
          .describe('Optional field to sort by. Default is "visibility".'),
        order: z.enum(['desc', 'asc']).optional().describe('Sort order. Default is "desc".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Optional limit on prompts returned (default 10, max 100).'),
        model: z
          .string()
          .optional()
          .describe(
            'Optional model slug filter, or comma-separated list of slugs to filter a provider family.',
          ),
        region: z.string().optional().describe('Optional region code filter (e.g. "US", "TR").'),
      },
    },
    async (args) => {
      const result = await getPromptPerformanceFor(auth, {
        brandId: args.brand_id,
        dateFrom: args.date_from,
        dateTo: args.date_to,
        topicId: args.topic_id,
        sortBy: args.sort_by,
        order: args.order,
        limit: args.limit,
        model: args.model,
        region: args.region,
      });
      if (result === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}
