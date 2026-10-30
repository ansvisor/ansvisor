import { createTranslator } from 'next-intl';
import { z } from 'zod';
import messages from '../../../../messages/en.json';
import { getAuditQuota, startSiteAudits } from '@/lib/actions/audits';
import { contentUuid, isHttpUrl } from '@/lib/mcp/content-schemas';
import { FIXTURE_IDS, defineTool } from './define-tool';
import { listWords } from './targets';

/**
 * Chat's Site Audit WRITE row (CHAT-20 §9 row 37): audits of the brand's
 * pages, started as the Site Audit page starts them, against the month's
 * Site Audit quota (the API's check), as the signed-in member. One page
 * runs from a card, or without one in Full auto; several always ask, with
 * what they use of the quota on the card (`cost_card`, CHAT-04). Admins and
 * Managers (DECISIONS T). Its results stay once it ran: no Undo (§9).
 */

const BRAND = FIXTURE_IDS.brand;

const costT = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.costs' });

export const AUDIT_TOOLS = [
  defineTool({
    name: 'run_site_audit',
    class: 'write',
    area: 'site_audit',
    description:
      "Audit pages of the brand's site in Site Audit: one URL by default, or several at once. Each page uses one of the month's Site Audit audits; several start only if all fit. Only pages the person asked for.",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    // Several pages: a card in every mode, with what they use of the quota (§9 row 37).
    flags: { costCard: true },
    minRole: 'manager',
    // The month's Site Audit quota is the API's check (quota_exceeded).
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C3',
    labelKey: 'startAudit',
    route: '/dashboard/audit',
    mcpTool: 'run_site_audit',
    specRow: '37',
    batch: { field: 'urls', askAbove: 1 },
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      urls: z
        .array(z.string().trim().max(2048).refine(isHttpUrl, 'Each page is an http(s) address'))
        .min(1)
        .max(10)
        .describe('The pages to audit, as full addresses.'),
    }),
    run: (_ctx, input) => startSiteAudits(input.brand_id, input.urls),
    target: async (input) => {
      const pages = listWords(input.urls);
      // What the card's Approve uses of the month's audits, when it can be read.
      const quota = await getAuditQuota().catch(() => null);
      const cost =
        quota && quota.limit !== -1
          ? costT('siteAudit', { count: input.urls.length, left: quota.remaining })
          : null;
      return [pages, cost].filter(Boolean).join(' · ') || null;
    },
    fixture: { input: { brand_id: BRAND, urls: ['https://acme.example/pricing'] } },
  }),
];
