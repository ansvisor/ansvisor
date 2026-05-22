import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { McpAuthContext } from '@/lib/mcp-auth';
import {
  getContentOpportunityFor,
  getVisibilitySummaryFor,
  listBrandsFor,
  listContentOpportunitiesFor,
  listPromptsFor,
  listTopicsFor,
} from './data';

/**
 * Build a fresh MCP server bound to a single authenticated request.
 *
 * Each call creates a new `McpServer` with tool handlers that close over the
 * `auth` context. The Streamable HTTP route uses this in stateless mode, so
 * connect/run/discard per request — no shared state.
 */
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
        content: [
          { type: 'text', text: JSON.stringify(brands, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    'get_visibility_summary',
    {
      description:
        'Get aggregate visibility metrics for a brand over an optional date range and filter. Returns result count, average visibility score (0-100), total mentions, total citations, and the top 5 competitors by mention count. Use this for "how is my brand doing" / "what changed" style questions.',
      inputSchema: {
        brand_id: z
          .string()
          .uuid()
          .describe('Brand UUID, from list_brands.'),
        date_from: z
          .string()
          .optional()
          .describe(
            'ISO timestamp (inclusive) lower bound, e.g. 2026-05-01T00:00:00Z.',
          ),
        date_to: z
          .string()
          .optional()
          .describe('ISO timestamp (inclusive) upper bound.'),
        model: z
          .string()
          .optional()
          .describe(
            'Optional model slug filter, or comma-separated list of slugs to filter a provider family.',
          ),
        region: z
          .string()
          .optional()
          .describe('Optional region code filter (e.g. "US", "TR").'),
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
        content: [
          { type: 'text', text: JSON.stringify(summary, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    'list_topics',
    {
      description:
        'List topics for a brand, each with the number of prompts attached to it. Use this to audit prompt coverage ("are any topics empty / under-represented?") or before drilling into prompts for a specific theme. Topic-less prompts are not counted here — call list_prompts without a topic filter to see them.',
      inputSchema: {
        brand_id: z
          .string()
          .uuid()
          .describe('Brand UUID, from list_brands.'),
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
        content: [
          { type: 'text', text: JSON.stringify(topics, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    'list_prompts',
    {
      description:
        'List the prompts tracked for a brand, optionally filtered by topic or active status. Returns each prompt with its text, topic, platforms, models, regions, and active flag. Use this when the user asks what is being tracked, wants to drill into a specific topic, or wants to spot inactive / mis-targeted prompts.',
      inputSchema: {
        brand_id: z
          .string()
          .uuid()
          .describe('Brand UUID, from list_brands.'),
        topic_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Optional topic UUID (from list_topics) to filter to one topic.',
          ),
        is_active: z
          .boolean()
          .optional()
          .describe(
            'Optional filter — true returns only active prompts, false only inactive.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe(
            'Optional row cap (default 100, max 500). Newest prompts come first.',
          ),
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
        content: [
          { type: 'text', text: JSON.stringify(prompts, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    'list_content_opportunities',
    {
      description:
        'List content opportunities / gaps for a brand, showing which prompts represent the highest-impact areas where the brand is currently losing visibility. Sorts by opportunity score descending by default. Use this to audit open gaps, see what content needs to be written, or list open strategy priorities.',
      inputSchema: {
        brand_id: z
          .string()
          .uuid()
          .describe('Brand UUID, from list_brands.'),
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
        content: [
          { type: 'text', text: JSON.stringify(opportunities, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    'get_content_opportunity',
    {
      description:
        'Get full details of a specific content opportunity, including raw AI visibility gap metrics, intent, competitor references, and the generated content brief if one already exists. Use this when the user picks a specific opportunity from the list and wants to inspect it further or start writing.',
      inputSchema: {
        opportunity_id: z
          .string()
          .uuid()
          .describe('Content opportunity UUID, from list_content_opportunities.'),
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
        content: [
          { type: 'text', text: JSON.stringify(opportunity, null, 2) },
        ],
      };
    },
  );

  return server;
}
