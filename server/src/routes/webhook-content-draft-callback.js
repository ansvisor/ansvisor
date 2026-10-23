import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { DELIVERY_EVENT } from '../lib/content-delivery.js';
import {
  webhookCallbackLimiter,
  webhookCallbackAuthFailureLimiter,
} from '../middleware/rate-limiter.js';
import { webhookSecretsMatch } from '../lib/webhook-secret.js';

/**
 * Send to CMS's callback (#1331): the workspace's automation tells where a
 * page it was sent went live. Public by design, as /webhooks/content is: the
 * webhook's own secret (X-Webhook-Secret) authenticates it, each webhook has
 * its own budget, and failed attempts are counted by IP. A delivery id with
 * its webhook's secret proves the package arrived, so the callback counts
 * whatever the delivery reads: an automation may publish and call back
 * before it answers the send, or after the send gave up waiting.
 */

const router = Router();

router.use(webhookCallbackLimiter, webhookCallbackAuthFailureLimiter);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DENIED = { error: 'Invalid webhook credentials' };

const publishedBody = z.object({
  url: z.url({ protocol: /^https?$/ }).max(2048),
});

/**
 * POST /webhooks/content-drafts/:deliveryId/published
 * Body: { url }. Marks the delivery published at that address, and its page
 * too when it is the page's latest delivery (an older one's late callback
 * doesn't move the page's address back).
 */
router.post('/:deliveryId/published', async (req, res) => {
  try {
    const { deliveryId } = req.params;
    // A malformed id, an unknown delivery, no webhook and a wrong secret all
    // answer the same, so this route doesn't tell which deliveries exist.
    if (!UUID.test(deliveryId)) return res.status(401).json(DENIED);

    const { data: delivery, error } = await supabaseAdmin
      .from('content_draft_deliveries')
      .select('id, brand_id, draft_id, status')
      .eq('id', deliveryId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!delivery) return res.status(401).json(DENIED);

    const { data: configs, error: configError } = await supabaseAdmin
      .from('webhook_configs')
      .select('webhook_secret, events')
      .eq('brand_id', delivery.brand_id)
      .eq('is_active', true);
    if (configError) throw new Error(configError.message);
    const provided = req.get('X-Webhook-Secret');
    const matches = (configs ?? []).some(
      (c) => c.events?.includes(DELIVERY_EVENT) && webhookSecretsMatch(c.webhook_secret, provided),
    );
    if (!matches) return res.status(401).json(DENIED);

    const parsed = publishedBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Send { url }: where the page is live, http(s).' });
    }
    const now = new Date().toISOString();
    // As the browser would read it: no stray whitespace kept.
    const url = new URL(parsed.data.url).href;
    const { error: deliveryError } = await supabaseAdmin
      .from('content_draft_deliveries')
      .update({ status: 'published', published_url: url, published_at: now })
      .eq('id', delivery.id);
    if (deliveryError) throw new Error(deliveryError.message);
    if (delivery.draft_id) {
      const { data: latest, error: latestError } = await supabaseAdmin
        .from('content_draft_deliveries')
        .select('id')
        .eq('draft_id', delivery.draft_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw new Error(latestError.message);
      if (latest?.id === delivery.id) {
        const { error: draftError } = await supabaseAdmin
          .from('content_drafts')
          .update({ status: 'published', published_url: url, published_at: now })
          .eq('id', delivery.draft_id);
        if (draftError) throw new Error(draftError.message);
      }
    }
    return res.json({ success: true, status: 'published' });
  } catch (error) {
    req.log?.error?.({ err: error }, 'content draft published callback error');
    return res.status(500).json({ error: 'Failed to mark the page published' });
  }
});

export default router;
