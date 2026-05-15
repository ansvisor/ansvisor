import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { McpAuthContext } from '@/lib/mcp-auth';
import { getVisibilitySummaryFor, listBrandsFor } from './data';

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

  return server;
}
