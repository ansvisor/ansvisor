import { z } from 'zod';
import { contentUuid } from '@/lib/mcp/content-schemas';
import { makeChatPresentation } from '../presentation-run';
import { FIXTURE_IDS, defineTool } from './define-tool';

/**
 * Chat's presentation WRITE row (issue #2298): a saved report turned into
 * an editable .pptx deck (native text, charts and tables) and filed in the
 * workspace's Chat files against its storage cap, ready to download. As
 * build_report (§9 row 64): it asks first, and Admins and Managers.
 */

export const PRESENTATION_TOOLS = [
  defineTool({
    name: 'make_presentation',
    class: 'write',
    area: 'reports',
    description:
      "Turn a saved report from Reports (from get_reports) into an editable PowerPoint deck: the report's summary, key figures, visibility trend, share of voice, competitors, prompts, topics and citation sources as native slides, figures as the report stored them, each data slide naming the report and its period. The deck is filed in Files to download.",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    planGate: null,
    brandOf: { lookup: 'reports', idField: 'report_id' },
    costClass: 'C2',
    labelKey: 'reportPresentation',
    route: '/dashboard/chat/files',
    mcpTool: null,
    specRow: '81',
    inputSchema: z.object({
      report_id: contentUuid.describe('The saved report, from get_reports or get_report.'),
    }),
    run: (ctx, input) => makeChatPresentation(ctx, input),
    // The deck, filed as it was made: its card downloads it.
    deliverable: (_input, output) => {
      const made = output as { ok?: unknown; file_id?: unknown; title?: unknown };
      if (made?.ok !== true || typeof made.file_id !== 'string') return null;
      return {
        title: typeof made.title === 'string' ? made.title : 'Report presentation',
        type: 'report',
        formats: ['pptx'],
        fileId: made.file_id,
      };
    },
    fixture: {
      input: { report_id: FIXTURE_IDS.item },
    },
  }),
];
