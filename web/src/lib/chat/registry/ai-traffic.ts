import { z } from 'zod';
import { contentUuid } from '@/lib/mcp/content-schemas';
import { getGaSummaryFor, getGscQueriesFor, getGscSummaryFor } from '@/lib/mcp/google-reads';
import { FIXTURE_IDS, defineTool } from './define-tool';

/**
 * Chat's Google reads (CHAT-20 §9 row 35; Chat Wave 1 W1-16), and the Search
 * Console queries the /prompts skill proposes prompts from (AGENTS plan §3
 * #10). Each needs its source connected.
 */

const input = z.object({
  brand_id: contentUuid.describe('Brand id, from list_brands.'),
  days: z.number().int().min(1).max(90).optional().describe('Days back, 28 by default.'),
});

export const AI_TRAFFIC_READS = [
  defineTool({
    name: 'get_gsc_summary',
    class: 'read',
    area: 'ai_traffic',
    description:
      "The brand's Google Search Console clicks over a period, against the period before, or that Search Console isn't connected. Google reports about two to three days late.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'gscSummary',
    route: '/dashboard/traffic',
    mcpTool: null,
    specRow: '35',
    inputSchema: input,
    run: (ctx, params) => getGscSummaryFor(ctx, { brandId: params.brand_id, days: params.days }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
  defineTool({
    name: 'get_gsc_queries',
    class: 'read',
    area: 'ai_traffic',
    description:
      "The brand's Google Search Console queries: each query's clicks, impressions and average position over the last days Google reported, against the span before, the most seen first, or that Search Console isn't connected. Real searches on Google, for which prompts to track; Google reports about two to three days late.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'gscQueries',
    route: '/dashboard/traffic',
    mcpTool: null,
    specRow: '35',
    inputSchema: input.extend({
      limit: z.number().int().min(1).max(50).optional().describe('Queries, 25 by default.'),
    }),
    run: (ctx, params) =>
      getGscQueriesFor(ctx, { brandId: params.brand_id, days: params.days, limit: params.limit }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
  defineTool({
    name: 'get_ga_summary',
    class: 'read',
    area: 'ai_traffic',
    description:
      "The brand's Google Analytics (GA4) sessions over a period: all, from AI, engaged, key events and revenue, against organic, or that Analytics isn't connected. Analytics reports about a day late.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'gaSummary',
    route: '/dashboard/traffic',
    mcpTool: null,
    specRow: '35',
    inputSchema: input,
    run: (ctx, params) => getGaSummaryFor(ctx, { brandId: params.brand_id, days: params.days }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
];
