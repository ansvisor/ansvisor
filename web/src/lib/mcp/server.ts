import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { McpAuthContext } from '@/lib/mcp-auth';
import {
  CONTENT_OPPORTUNITY_STATUSES,
  acceptTopicSuggestionFor,
  dismissTopicSuggestionFor,
  listPromptSuggestionsFor,
  acceptPromptSuggestionFor,
  dismissPromptSuggestionFor,
  generateBriefFor,
  getCompetitorComparisonFor,
  listCompetitorsFor,
  listReportsFor,
  getReportFor,
  getContentOpportunityFor,
  getVisibilitySummaryFor,
  getVisibilityTrendFor,
  listBrandsFor,
  listCitationsFor,
  listContentOpportunitiesFor,
  listPromptsFor,
  listTopicsFor,
  listTopicSuggestionsFor,
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
  getPromptUsageFor,
  MCP_TASK_STATUSES,
  getActionFor,
  listActionHistoryFor,
  listActionsFor,
  listSignalsFor,
  updateTaskStatusFor,
  IMPROVE_PRESETS,
  IMPROVE_SOURCE_TYPES,
  createImproveActionFor,
} from './data';
import { exportActionFor } from './action-export';
import {
  addContentSourceFor,
  createContentDraftFor,
  getContentDraftFor,
  getContentImpactFor,
  getContentSourcesFor,
  listContentDraftsFor,
  setContentDraftReadyFor,
  suggestContentChangesFor,
} from './content';
import { MAX_API_SUGGESTIONS } from '@/lib/content/agent-suggestions';
import { HEADING_LIMITS } from '@/lib/content/suggestions';
import {
  addSourceShape,
  createDraftShape,
  impactDays,
  listDraftsShape,
  sourceRefError,
  suggestionsShape,
} from './content-schemas';
import {
  getMentionCompetitorsFor,
  getMentionFor,
  getMentionsPerceptionFor,
  getMentionsSummaryFor,
  listMentionsFor,
  overrideMentionSentimentFor,
  type MentionsFilterParams,
} from './mentions';
import { MENTION_SENTIMENTS, MENTION_SORTS } from '@/lib/mentions-list';

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

/** The Mentions & Sentiment page's filters, the same on every mentions tool. */
const mentionFilters = {
  brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
  date_from: z
    .string()
    .optional()
    .describe('ISO timestamp (inclusive) lower bound. Defaults to 30 days ago, as the page.'),
  date_to: z
    .string()
    .optional()
    .describe('ISO timestamp (inclusive) upper bound; a YYYY-MM-DD covers that whole day.'),
  platform: z
    .string()
    .optional()
    .describe('One platform id, e.g. "chatgpt-web", "gemini-web", "perplexity-web".'),
  region: z.string().optional().describe('Optional country code filter (e.g. "US", "TR").'),
  topic_id: relaxedUuid.optional().describe('Topic UUID, from list_topics.'),
  search: z.string().optional().describe("Matched against the prompts' text."),
};

function mentionParams(args: {
  brand_id: string;
  date_from?: string;
  date_to?: string;
  platform?: string;
  region?: string;
  topic_id?: string;
  search?: string;
}): MentionsFilterParams {
  return {
    brandId: args.brand_id,
    dateFrom: args.date_from,
    dateTo: args.date_to,
    platform: args.platform,
    region: args.region,
    topicId: args.topic_id,
    search: args.search,
  };
}

const MENTIONS_BASIS =
  'Built from the stored answers with no LLM call; the window before is the same length. ' +
  'Net sentiment is positive minus negative share of the responses naming the brand, ' +
  '−100…+100; under 20 mentions it is a low sample (lowSample: true): quote it as such and ' +
  'read no change into it. Sentiment is measured for the brand only, not competitors.';

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
        'Get aggregate visibility metrics for a brand over an optional date range and filter. ' +
        'The HEADLINE metric is totals.aiVisibilityScore (0-100): 0.6 × mention rate + 0.25 × ' +
        'citation rate + 0.15 × position factor over the filtered answers — the same Visibility ' +
        'number the dashboard shows everywhere; quote it WITHOUT a % sign. Components are ' +
        'totals.mentionAnswers, totals.citationAnswers and totals.positionFactor (mean of ' +
        '1/position over mentioning answers; 1 = always named first). Coverage survives as ' +
        'totals.visibilityRatePct (visible prompts ÷ tracked prompts, a percentage) with ' +
        'totals.visiblePrompts / totals.promptCount. totals.avgVisibility and the competitors’ ' +
        'avgVisibility are DEPRECATED legacy intensity averages — prefer each competitor’s ' +
        '`score`, which shares the brand’s denominator. ' +
        'Use this for "how is my brand doing" / "what changed" style questions.',
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
    'list_topic_suggestions',
    {
      description:
        'List pending AI-generated topic suggestions for a brand (id, name, reason, and when they were generated). These are suggestions awaiting a decision — already accepted or dismissed suggestions never appear here. Generating new suggestions is not available via MCP; use accept_topic_suggestion or dismiss_topic_suggestion to act on what is already pending.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
      },
    },
    async (args) => {
      const suggestions = await listTopicSuggestionsFor(auth, args.brand_id);
      if (suggestions === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(suggestions, null, 2) }],
      };
    },
  );

  server.registerTool(
    'accept_topic_suggestion',
    {
      description:
        'Accept a pending topic suggestion: creates exactly one new topic from it and marks the suggestion as added. Only fire on explicit user intent for a specific suggestion (from list_topic_suggestions), never as part of an exploratory query. Accepting the same suggestion twice fails cleanly — it is not accepted or already decided — no duplicate topic is created.',
      inputSchema: {
        suggestion_id: relaxedUuid.describe('Topic suggestion UUID, from list_topic_suggestions.'),
      },
    },
    async (args) => {
      const result = await acceptTopicSuggestionFor(auth, args.suggestion_id);
      if (!result) {
        return {
          content: [
            { type: 'text', text: 'Suggestion not found, not pending, or already processed' },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'dismiss_topic_suggestion',
    {
      description:
        'Dismiss a pending topic suggestion so it never reappears in future suggestion batches. Only fire on explicit user intent for a specific suggestion (from list_topic_suggestions), never as part of an exploratory query.',
      inputSchema: {
        suggestion_id: relaxedUuid.describe('Topic suggestion UUID, from list_topic_suggestions.'),
      },
    },
    async (args) => {
      const result = await dismissTopicSuggestionFor(auth, args.suggestion_id);
      if (!result) {
        return {
          content: [
            { type: 'text', text: 'Suggestion not found, not pending, or already processed' },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'list_prompt_suggestions',
    {
      description:
        'List pending AI-generated prompt suggestions for a brand, including the suggested query, topic, reason, estimated volume, relevance, source provenance, generation time and expiry. est_volume is an AI guess, not a measurement: no keyword behind it is measured yet, so treat it as low confidence, likely anywhere from half to twice the number, and say so when you quote it. The result includes a stale flag when no suggestions are available or all have expired. This only reads suggestions already generated by the dashboard; it does not generate new suggestions.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
      },
    },
    async (args) => {
      const result = await listPromptSuggestionsFor(auth, args.brand_id);
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
    'accept_prompt_suggestion',
    {
      description:
        "Accept one pending prompt suggestion by creating a tracked prompt with the brand's default platform/model settings and marking the suggestion added. This consumes one active prompt location and respects the organization's plan limit and allowed engines. Only fire on explicit user intent for a specific suggestion from list_prompt_suggestions, never as part of an exploratory query. Accepting the same suggestion twice does not create a duplicate prompt.",
      inputSchema: {
        suggestion_id: relaxedUuid.describe(
          'Prompt suggestion UUID, from list_prompt_suggestions.',
        ),
      },
    },
    async (args) => {
      const result = await acceptPromptSuggestionFor(auth, args.suggestion_id);
      if (result === null) {
        return {
          content: [
            { type: 'text', text: 'Suggestion not found, not pending, or already processed' },
          ],
          isError: true,
        };
      }
      if ('error' in result) {
        return {
          content: [{ type: 'text', text: result.error }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'dismiss_prompt_suggestion',
    {
      description:
        'Dismiss a pending prompt suggestion so it no longer appears in future suggestion lists. Only fire on explicit user intent for a specific suggestion from list_prompt_suggestions, never as part of an exploratory query.',
      inputSchema: {
        suggestion_id: relaxedUuid.describe(
          'Prompt suggestion UUID, from list_prompt_suggestions.',
        ),
      },
    },
    async (args) => {
      const result = await dismissPromptSuggestionFor(auth, args.suggestion_id);
      if (result === null) {
        return {
          content: [
            { type: 'text', text: 'Suggestion not found, not pending, or already processed' },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'list_competitors',
    {
      description:
        'List the competitors configured for a brand. Returns only id, name, and domain. Use list_brands first to resolve the brand id. This is the configured competitor list, not a performance ranking.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
      },
    },
    async (args) => {
      const competitors = await listCompetitorsFor(auth, args.brand_id);
      if (competitors === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(competitors, null, 2) }],
      };
    },
  );

  server.registerTool(
    'list_reports',
    {
      description:
        'List saved report snapshots for a brand, newest first. Returns report ids, titles, templates, date ranges, and creation timestamps without loading the full report payload. Use get_report to read one report in full.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of reports to return (default 50, max 100).'),
      },
    },
    async (args) => {
      const reports = await listReportsFor(auth, args.brand_id, args.limit);
      if (reports === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(reports, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_report',
    {
      description:
        'Get the full saved snapshot for one report, including its stored payload and metrics. This is read-only and does not regenerate the report. Use a report id from list_reports.',
      inputSchema: {
        report_id: relaxedUuid.describe('Saved report UUID, from list_reports.'),
      },
    },
    async (args) => {
      const report = await getReportFor(auth, args.report_id);
      if (!report) {
        return {
          content: [{ type: 'text', text: 'Report not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
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
          .enum(['new', 'reviewed', 'sent', 'in_progress', 'done', 'dismissed', 'archived'])
          .optional()
          .describe(
            'Filter by progress status of the opportunity. Archived ones (an older per-prompt backlog) are left out unless asked for.',
          ),
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
        "Get full details of a specific content opportunity, including raw AI visibility gap metrics, intent, competitor references, and the generated content brief if one already exists. source_data.estAiVolume is the sum of its prompts' estimated AI searches a month when the opportunity was made or last updated: an estimate, not a measurement, and possibly out of date; get_prompt_volumes has each prompt's current estimate with its range and confidence. Use this when the user picks a specific opportunity from the list and wants to inspect it further or start writing.",
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
    'get_prompt_usage',
    {
      description:
        'Check tracked-prompt usage against the plan — the numbers on the Tracked Prompts usage cards. ' +
        'Returns { plan: { key, name, locationLimit, cta }, brand: { active, paused, total }, ' +
        'account: { activePrompts, brands, locationsUsed }, updatedAt }. The plan limit counts ' +
        'prompt LOCATIONS across every brand of the account: each active prompt uses one slot per ' +
        'location it targets, and paused prompts use none. Slots left = locationLimit − ' +
        'locationsUsed (never below 0); locationLimit null means unlimited. Use this for "how many ' +
        'prompts can we still add?" / "how close are we to the limit?". This is a read.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
      },
    },
    async (args) => {
      const usage = await getPromptUsageFor(auth, args.brand_id);
      if (!usage) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(usage, null, 2) }],
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
        "Get a brand's competitor benchmark and share of voice for a window. " +
        'The headline metric per entry is visibility_rate_pct: distinct prompts the brand (or ' +
        'competitor) appeared in ÷ the shared brand_prompt_count denominator × 100. All entries ' +
        'use the same denominator so rates are directly comparable — this matches the Insights ' +
        'dashboard leaderboard. Each entry also exposes visible_prompts, prompt_count, ' +
        'avg_visibility_score (0-100 intensity, kept for backward compatibility), total_mentions, ' +
        'total_citations, and appearance_count. Also returns overall share-of-voice as a ' +
        'percentage (brand mentions ÷ (brand + competitor mentions)) and the same split per ' +
        '(model_used, platform). Use this for "how do I compare to my competitors?" or "who is ' +
        'gaining share of voice?" questions. Snapshot for the given window — call again with an ' +
        'earlier window to compute a delta.',
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
        'Get per-prompt search demand and competition for a brand. Returns one row per analyzed prompt with its keywords, the Google search volume of each keyword, total_google_volume (the Google volume of the prompt: the median of its keyword volumes, not their sum), est_ai_volume (estimated AI search demand: total_google_volume × the AI adoption rate), est_ai_volume_low and est_ai_volume_high (its likely range, from how far the keyword volumes agree), volume_confidence (high / medium / low; one level less once the volumes are over six months old), volume_type (always "estimate": AI engines publish no search volumes, so quote the range rather than a single number), competition_index (0-100), and competition label (LOW / MEDIUM / HIGH). Sorted by est_ai_volume descending. Use this for "which prompts have the most demand?" or "which prompts have the least competition?" prioritization questions. Only returns prompts that already have volume analysis — triggering a new analysis is not available here.',
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

  server.registerTool(
    'list_actions',
    {
      description:
        'List the Action Center actions for a brand: what the product thinks should be done about its AI visibility. Each action was consolidated from one or more detected signals and carries a task plan. Returns category, kind, impact, priority (a 0–100 score, its level — critical, high, medium or low — and the facts it rests on; null until scored), status, outcome, assignee, due date and task progress, highest priority first (unscored last), or most recently updated first with sort "updated". `kind` is an opaque definition id (e.g. "close_competitor_gap"); the action payload with the specifics is on get_action. Use this to see open work ("what should we do next?") or to check what is in progress.',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        status: z
          .enum(['new', 'in_progress', 'on_hold', 'completed', 'dismissed'])
          .optional()
          .describe('Filter by action status.'),
        category: z
          .enum(['growth', 'protect', 'recover', 'fix', 'compete'])
          .optional()
          .describe('Filter by action category.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Row cap limit (default 50, max 200).'),
        sort: z
          .enum(['updated', 'priority'])
          .optional()
          .describe(
            'Order: "priority" (default) highest priority score first — the order to work on them; "updated" most recently updated first.',
          ),
      },
    },
    async (args) => {
      const actions = await listActionsFor(auth, {
        brandId: args.brand_id,
        status: args.status,
        category: args.category,
        limit: args.limit,
        sort: args.sort,
      });
      if (actions === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(actions, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_action',
    {
      description:
        'Get one Action Center action in full: its priority (score, level and the facts it rests on), its payload (the prompts, pages, competitors or numbers it is about), the signals that triggered it, its task list and its event trail. Each task carries `mode` (who carries it out: system, agent, human or human_or_agent) and `permission` (read, write or execute). Read both before proposing to act on a task — anything beyond read needs a human to approve it in the dashboard. A task is described by `title` when someone wrote one, otherwise by `task_key` with `title_params`. `details` says what the task carries beyond that, or null: `where` (the page, prompt, platform, domain or competitor), `why` (the evidence), `how` (the steps), `done_when` (the check that closes it), `type` (content, on_page, technical, outreach, pr or product), `effort` and `role`; a task sent from the Improve tab also carries `body`, `platform`, `platform_label` and `sources`; `sent_to_content` (the opportunity it became) and `sent_to_webhook` say where it was sent. With `format` "markdown" or "csv" it returns the action as the dashboard\'s Copy Data and Export CSV write it instead (everything its tabs show, labelled in English, dates in UTC): Markdown to paste into a doc, ticket or another agent, CSV with a row per affected item, task and signal.',
      inputSchema: {
        action_id: relaxedUuid.describe('Action UUID, from list_actions or list_action_history.'),
        format: z
          .enum(['json', 'markdown', 'csv'])
          .optional()
          .describe('json (default): the fields above. markdown or csv: the export, as text.'),
      },
    },
    async (args) => {
      if (args.format === 'markdown' || args.format === 'csv') {
        const exported = await exportActionFor(auth, args.action_id, args.format);
        if (!exported) {
          return {
            content: [{ type: 'text', text: 'Action not found' }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: exported.body }] };
      }
      const action = await getActionFor(auth, args.action_id);
      if (!action) {
        return {
          content: [{ type: 'text', text: 'Action not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(action, null, 2) }],
      };
    },
  );

  server.registerTool(
    'list_signals',
    {
      description:
        "List the signals the Action Center detected for a brand: measured changes such as a visibility drop, a competitor gaining citations or a page losing AI traffic. Newest first. Each signal carries its raw row (previous_value, current_value, change_value, payload, action_id) and, read from it: `where` (the prompt, topic, platforms with names, locations, domain, competitor or pages it is about; a field is null when no detector records it yet), `change` (labelled figures: metric, role such as before/after or you/competitor, value, unit and the period it covers, e.g. 'week_over_week', given per figure since one finding can mix windows; null when the signal records no figures), `evidence` (first and last detection, and app paths that show the underlying answers) and `used_by_actions` (every action built on it, closed ones too, the latest first). Prefer `change` over the raw value columns: their meaning differs per signal kind. Use this to explain why an action exists or what has changed recently.",
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
        status: z
          .enum(['new', 'acknowledged', 'resolved', 'dismissed'])
          .optional()
          .describe('Filter by signal status.'),
        kind: z
          .string()
          .optional()
          .describe('Filter by signal kind, an opaque detector id as returned in earlier rows.'),
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
      const signals = await listSignalsFor(auth, {
        brandId: args.brand_id,
        status: args.status,
        kind: args.kind,
        limit: args.limit,
      });
      if (signals === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(signals, null, 2) }],
      };
    },
  );

  server.registerTool(
    'list_action_history',
    {
      description:
        'List closed Action Center actions (completed or dismissed) for a brand with their measured result, most recently closed first. `outcome` is the verdict (improved, no_meaningful_change, declined, not_measurable, or pending_measurement while the after-window is still open) and `results` holds the before/after values the validation sweep measured. Use this to answer "did what we did last month work?".',
      inputSchema: {
        brand_id: relaxedUuid.describe('Brand UUID, from list_brands.'),
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
      const history = await listActionHistoryFor(auth, {
        brandId: args.brand_id,
        limit: args.limit,
      });
      if (history === null) {
        return {
          content: [{ type: 'text', text: 'Brand not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(history, null, 2) }],
      };
    },
  );

  server.registerTool(
    'update_task_status',
    {
      description:
        "Record progress on one task of an Action Center action: in_progress, completed, skipped (skip_reason required) or failed. This reports work a person has done or decided; it does not carry the task out. It is a write logged under the API key's user — only fire on explicit user intent for a specific task, never as part of an exploratory query.",
      inputSchema: {
        task_id: relaxedUuid.describe('Task UUID, from get_action.'),
        status: z
          .enum(MCP_TASK_STATUSES)
          .describe('New task status. One of: in_progress, completed, skipped, failed.'),
        skip_reason: z
          .string()
          .max(200)
          .optional()
          .describe('Why the task was skipped. Required when status is skipped.'),
      },
    },
    async (args) => {
      if (args.status === 'skipped' && !args.skip_reason?.trim()) {
        return {
          content: [{ type: 'text', text: 'skip_reason is required when status is skipped' }],
          isError: true,
        };
      }
      const updated = await updateTaskStatusFor(auth, args.task_id, args.status, args.skip_reason);
      if (!updated) {
        return {
          content: [{ type: 'text', text: 'Task not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
      };
    },
  );

  server.registerTool(
    'create_improve_action',
    {
      description:
        'Send Improve suggestions for one prompt to Action Center as a new `prompt_improve` action, one human task per suggestion — the same as the Positions panel\'s Improve tab "Send Actions". The prompt must already have an Improve suggestion set for this exact range (generated in the dashboard); otherwise it errors with "Generate suggestions for this range first". Needs a plan that includes Improve. Reuse the same idempotency_key when retrying: a repeated call returns the action the first one created (created: false) instead of a duplicate. It is a write logged under the API key\'s user — only fire on explicit user intent, never as part of an exploratory query.',
      inputSchema: {
        prompt_id: relaxedUuid.describe('Prompt UUID, from list_prompts.'),
        range: z
          .object({
            preset: z
              .enum(IMPROVE_PRESETS)
              .describe(
                'The range the suggestion set was generated for: 24h, 7d, 30d, 90d or custom.',
              ),
            from: z
              .string()
              .describe('ISO timestamp lower bound; for custom, its date is part of the set key.'),
            to: z
              .string()
              .optional()
              .describe('ISO timestamp upper bound; for custom, its date is part of the set key.'),
            region: z
              .string()
              .optional()
              .describe('Region code the set was generated for (e.g. "US"); omit for all regions.'),
          })
          .describe('The Positions panel range the suggestion set belongs to.'),
        idempotency_key: z
          .string()
          .min(8)
          .max(64)
          .describe('Unique per send (e.g. a UUID); reuse it only to retry the same send.'),
        suggestions: z
          .array(
            z.object({
              id: z.string().min(1).max(120).describe('Suggestion id from the set, or your own.'),
              platform: z
                .string()
                .describe(
                  'Platform id: chatgpt-web, perplexity-web, google-aio, google-aimode, gemini-web, copilot-web, grok-web or claude.',
                ),
              title: z.string().min(1).max(200).describe('Task title.'),
              body: z.string().max(1000).optional().describe('What to do, in a sentence or two.'),
              sources: z
                .array(
                  z.object({ type: z.enum(IMPROVE_SOURCE_TYPES), ref: z.string().min(1).max(300) }),
                )
                .max(6)
                .optional()
                .describe('Evidence behind the suggestion.'),
            }),
          )
          .min(1)
          .max(50)
          .describe('The suggestions to send, in task order.'),
      },
    },
    async (args) => {
      const result = await createImproveActionFor(auth, {
        promptId: args.prompt_id,
        range: args.range,
        idempotencyKey: args.idempotency_key,
        suggestions: args.suggestions,
      });
      if (!result) {
        return {
          content: [{ type: 'text', text: 'Prompt not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_mentions_summary',
    {
      description:
        "The Mentions & Sentiment page's Overview for a brand: times named (`timesNamed`, the " +
        "page's Total mentions), responses naming it, mention rate, prompts with mentions, " +
        'average position and sentiment (counts, shares, net), now and in the window before, ' +
        "with `changes` taken as the page's cards take them: on the prompts both windows " +
        'answered (`changes.basis`), mentionsPct on times named; the platform that moved net sentiment ' +
        'most and the competitors AI names beside the brand (`headline`); each platform; and ' +
        'each day. Use it for "how is AI talking about us" / "why did sentiment drop on ' +
        'Gemini?". ' +
        MENTIONS_BASIS,
      inputSchema: mentionFilters,
    },
    async (args) => {
      const summary = await getMentionsSummaryFor(auth, mentionParams(args));
      if (!summary) {
        return { content: [{ type: 'text', text: 'Brand not found' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    },
  );

  server.registerTool(
    'list_mentions',
    {
      description:
        "The responses naming the brand, as the Mentions tab's table: prompt, platform, model, " +
        'country, sentiment, times named, position among the brands named, competitors in the ' +
        'same response and an excerpt around the first mention. 100 a page; `total` counts ' +
        'every match. Pass a row id to get_mention for the full response. ' +
        MENTIONS_BASIS,
      inputSchema: {
        ...mentionFilters,
        sentiment: z.enum(MENTION_SENTIMENTS).optional().describe('Only this sentiment.'),
        competitor_id: z
          .string()
          .optional()
          .describe(
            'Only responses that also name this competitor (UUID, from ' +
              'get_mention_competitors), or "none" for responses naming no competitor.',
          ),
        sort: z
          .enum(MENTION_SORTS)
          .optional()
          .describe('newest (default), oldest, co_mentions (most competitors first) or negative.'),
        page: z.number().int().min(1).optional().describe('1-based page, 100 rows each.'),
      },
    },
    async (args) => {
      const list = await listMentionsFor(auth, {
        ...mentionParams(args),
        sentiment: args.sentiment,
        competitorId: args.competitor_id,
        sort: args.sort,
        page: args.page,
      });
      if (!list) {
        return { content: [{ type: 'text', text: 'Brand not found' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    },
  );

  server.registerTool(
    'get_mention',
    {
      description:
        "One response in full, as the page's response drawer: the stored text, its citations, " +
        'the competitors it names, its sentiment and the latest "Sentiment is wrong" correction ' +
        '(sentimentOverride), if any.',
      inputSchema: {
        id: relaxedUuid.describe('The response id, from list_mentions.'),
      },
    },
    async (args) => {
      const mention = await getMentionFor(auth, args.id);
      if (!mention) {
        return { content: [{ type: 'text', text: 'Answer not found' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(mention, null, 2) }] };
    },
  );

  server.registerTool(
    'get_mention_competitors',
    {
      description:
        'Competitor framing from the Mentions page: how often AI names each competitor in the ' +
        "brand's tracked responses (count and share of responses, change against the window " +
        'before) and how often in the same response as the brand. ' +
        MENTIONS_BASIS,
      inputSchema: mentionFilters,
    },
    async (args) => {
      const competitors = await getMentionCompetitorsFor(auth, mentionParams(args));
      if (!competitors) {
        return { content: [{ type: 'text', text: 'Brand not found' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(competitors, null, 2) }] };
    },
  );

  server.registerTool(
    'get_mentions_perception',
    {
      description:
        'What AI associates with the brand (the Perception tab): the terms in the sentences ' +
        'naming it, with responses and share of the responses naming it, now and before; the ' +
        "attributes that tell the brand and its top competitors apart, as each one's share of " +
        'the responses naming it; competitors named in the same responses; and the biggest ' +
        'gap, an attribute a competitor leads by 20+ points (null when none does, or when ' +
        'the brand or that competitor has fewer than 20 mentions). Terms are found by rule, ' +
        'no LLM: a sentence naming two brands lends its words to both.',
      inputSchema: mentionFilters,
    },
    async (args) => {
      const perception = await getMentionsPerceptionFor(auth, mentionParams(args));
      if (!perception) {
        return { content: [{ type: 'text', text: 'Brand not found' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(perception, null, 2) }] };
    },
  );

  server.registerTool(
    'override_mention_sentiment',
    {
      description:
        '"Sentiment is wrong": set one response\'s sentiment toward the brand, with an optional ' +
        'note. Every figure that reads it follows (Mentions, Insights) and the change is logged ' +
        "under the API key's user, who must be an admin or manager of the brand's organization. " +
        'It is a write — only fire on explicit user intent for a specific response, never as ' +
        'part of an exploratory query.',
      inputSchema: {
        id: relaxedUuid.describe('The response id, from list_mentions.'),
        sentiment: z.enum(MENTION_SENTIMENTS).describe('The correct sentiment.'),
        note: z.string().max(500).optional().describe('Why, for the correction history.'),
      },
    },
    async (args) => {
      const result = await overrideMentionSentimentFor(auth, args.id, args.sentiment, args.note);
      if ('error' in result) {
        return { content: [{ type: 'text', text: result.message }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── Content Editor (CE-022): drafts, read and written as a person would ───

  const json = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  });
  const notFound = (what: string) => ({
    content: [{ type: 'text' as const, text: `${what} not found` }],
    isError: true,
  });

  server.registerTool(
    'list_content_drafts',
    {
      description:
        "List a brand's Content Editor drafts, the latest changed first (up to 100): title, status (draft, in_review, ready, published), method (create or optimize), page type, author (user or agent), the live page it optimizes, how many agent suggestions wait for review, and the editor path.",
      inputSchema: listDraftsShape,
    },
    async (args) => {
      const drafts = await listContentDraftsFor(auth, args.brand_id, args.status);
      return drafts ? json(drafts) : notFound('Brand');
    },
  );

  server.registerTool(
    'get_content_draft',
    {
      description:
        'Read one Content Editor draft: its HTML, and the page passage by passage (numbered, as suggest_content_changes refers to them). Passages marked locked are quoted by AI answers today: never suggest changing them. Also the action it belongs to and the agent suggestions still waiting for review.',
      inputSchema: {
        draft_id: relaxedUuid.describe('Draft UUID, from list_content_drafts.'),
      },
    },
    async (args) => {
      const draft = await getContentDraftFor(auth, args.draft_id);
      return draft ? json(draft) : notFound('Draft');
    },
  );

  server.registerTool(
    'create_content_draft',
    {
      description:
        "Write a new Content Editor draft as the agent. It goes to the Library's In review for a person to read, edit and mark ready — the agent never publishes. The HTML is checked against the editor's allow-list (headings, paragraphs, lists, tables, links, schema JSON-LD). Without page_type, it is detected from the page. It is a write logged as the agent's — only on explicit user intent.",
      inputSchema: createDraftShape,
    },
    async (args) => {
      const created = await createContentDraftFor(auth, {
        brandId: args.brand_id,
        title: args.title,
        bodyHtml: args.body_html,
        method: args.method,
        pageType: args.page_type,
        sourceUrl: args.source_url,
        promptIds: args.prompt_ids,
      });
      if (created === 'off_domain') {
        return {
          content: [
            {
              type: 'text' as const,
              text: "source_url must be a page on one of the brand's domains",
            },
          ],
          isError: true,
        };
      }
      return created ? json(created) : notFound('Brand');
    },
  );

  server.registerTool(
    'get_content_impact',
    {
      description:
        "What the draft's live page earns, as the editor's Live page tab reads it: citations in AI answers, AI visits, Google clicks and the prompts citing it, against the period before. Only for a draft of a live page (method optimize, or published).",
      inputSchema: {
        draft_id: relaxedUuid.describe('Draft UUID.'),
        days: impactDays,
      },
    },
    async (args) => {
      const impact = await getContentImpactFor(auth, args.draft_id, args.days);
      if (impact === 'no_page') {
        return {
          content: [{ type: 'text' as const, text: 'This draft is a new page, not live yet' }],
          isError: true,
        };
      }
      return impact ? json(impact) : notFound('Draft');
    },
  );

  server.registerTool(
    'get_content_sources',
    {
      description:
        "The brand's data the draft draws on over 30 days, as the Sources tab shows it: its prompts, the AI searches (fan-outs) run for them, the pages AI cites, Search Console queries, and the person's choices (sources left out or added).",
      inputSchema: {
        draft_id: relaxedUuid.describe('Draft UUID.'),
      },
    },
    async (args) => {
      const sources = await getContentSourcesFor(auth, args.draft_id);
      return sources ? json(sources) : notFound('Draft');
    },
  );

  server.registerTool(
    'add_content_source',
    {
      description:
        "Add a source to a draft, as the Sources tab's Add does: a tracked prompt (by id) joins the draft's prompts; a page address or a Search Console query is kept as added.",
      inputSchema: {
        draft_id: relaxedUuid.describe('Draft UUID.'),
        ...addSourceShape,
      },
    },
    async (args) => {
      const ref = args.ref.trim();
      const refError = sourceRefError(args.kind, ref);
      if (refError) {
        return { content: [{ type: 'text' as const, text: refError }], isError: true };
      }
      const result = await addContentSourceFor(
        auth,
        args.draft_id,
        args.kind === 'prompt' ? { kind: 'prompt', promptId: ref } : { kind: args.kind, ref },
      );
      if (result === 'not_found') return notFound('Prompt');
      return result ? json(result) : notFound('Draft');
    },
  );

  server.registerTool(
    'suggest_content_changes',
    {
      description: `Leave changes on a draft for a person to accept or reject in the editor — never applied by the agent. Read the draft with get_content_draft first: each suggestion names a passage by its number. A replace changes words in that passage ("before" copied exactly as the passage has it, "after" as plain text); an insert adds blocks after it ("after" as simple HTML: h2, h3, p, ul, ol, li, strong, em). A heading stays one line (an H1 up to ${HEADING_LIMITS.h1} characters, others up to ${HEADING_LIMITS.other}): to answer under it, insert a paragraph after it (an answer or blocks sent in a heading's replace are moved into an insert after it). Never change a locked passage. While a person still has the draft's open suggestions to decide, no new ones are taken: wait until get_content_draft lists none. At most ${MAX_API_SUGGESTIONS}; ones the editor can't apply come back in "dropped" with the reason (no_passage, locked, not_in_passage, no_change, empty, duplicate, too_many, heading_too_long).`,
      inputSchema: {
        draft_id: relaxedUuid.describe('Draft UUID.'),
        ...suggestionsShape,
      },
    },
    async (args) => {
      const result = await suggestContentChangesFor(auth, args.draft_id, args.suggestions);
      if (result === 'published') {
        return {
          content: [
            { type: 'text' as const, text: 'The draft is published; suggest on a new draft' },
          ],
          isError: true,
        };
      }
      if (result === 'open_suggestions') {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'A person still has open suggestions on this draft to accept or reject; suggest again once get_content_draft lists none',
            },
          ],
          isError: true,
        };
      }
      return result ? json(result) : notFound('Draft');
    },
  );

  server.registerTool(
    'set_content_draft_ready',
    {
      description:
        "Mark a draft ready to publish, as the editor's Mark ready does: from draft only — an agent's draft in review waits for a person to mark it ready in the editor. History keeps the page as a version, and a draft linked to an Action Center action completes the action's writing task (action_tasks_done). Ansvisor never publishes — a person does. Only on explicit user intent.",
      inputSchema: {
        draft_id: relaxedUuid.describe('Draft UUID.'),
      },
    },
    async (args) => {
      const result = await setContentDraftReadyFor(auth, args.draft_id);
      if (result === 'in_review') {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'The draft is in review: a person marks it ready in the editor',
            },
          ],
          isError: true,
        };
      }
      return result ? json(result) : notFound('Draft');
    },
  );

  return server;
}
