import type { CmsTarget } from '@/lib/content/cms-send-client';

/** A CMS a page goes to, as the app names it (the Send dialog, Chat's cards and Activity). */
export const CMS_NAMES: Record<CmsTarget, string> = {
  webflow: 'Webflow',
  wordpress: 'WordPress',
  framer: 'Framer',
  wix: 'Wix',
  webhook: 'Webhook',
};

/**
 * The CMSs Chat sends a page to, as a draft there (push_cms_draft). Not the
 * brand's webhook: it hands the page to the brand's own automation, which
 * may publish it, so it is a row of its own (trigger_content_webhook,
 * AUTONOMOUS-GO-LIVE PR 11).
 */
export const CHAT_CMS_TARGETS = ['webflow', 'wordpress', 'framer', 'wix'] as const;
export type ChatCmsTarget = (typeof CHAT_CMS_TARGETS)[number];
