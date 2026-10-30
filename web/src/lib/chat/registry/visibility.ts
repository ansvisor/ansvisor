import { z } from 'zod';
import { contentUuid } from '@/lib/mcp/content-schemas';
import { getOverviewSummaryFor } from '@/lib/mcp/overview-reads';
import { FIXTURE_IDS, defineTool } from './define-tool';

/** Chat's overview read (CHAT-20 §9 row 11; Chat Wave 1 W1-16). */

export const VISIBILITY_READS = [
  defineTool({
    name: 'get_overview_summary',
    class: 'read',
    area: 'visibility',
    description:
      'The brand at a glance: its visibility, mentions, citations and top competitors over a period, and when its tracking last ran and runs next. For "give me an overview" questions.',
    minRole: 'analyst',
    planGate: { platforms: true },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'overviewSummary',
    route: '/dashboard/insights',
    mcpTool: null,
    specRow: '11',
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      date_from: z.string().optional().describe('ISO timestamp (inclusive) lower bound.'),
      date_to: z.string().optional().describe('ISO timestamp (inclusive) upper bound.'),
    }),
    run: (ctx, input) =>
      getOverviewSummaryFor(ctx, {
        brandId: input.brand_id,
        dateFrom: input.date_from,
        dateTo: input.date_to,
      }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
];
