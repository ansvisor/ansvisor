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
 * Send to CMS's callback (#1331): the workspace's automation tells how a sent
 * page went in the CMS: published at an address, or failed (Zapier and Make
 * answer the send before their CMS step runs, so a post the CMS refused is
 * told here). Public by design, as /webhooks/content is: the webhook's own
 * secret (X-Webhook-Secret) authenticates it, the opportunity callback's
 * limiters (each secret's budget, failed attempts by IP) cover it too. A
 * delivery id with its webhook's secret proves the package arrived, so the
 * callback counts whatever the delivery reads: an automation may call back
 * before it answers the send, or after the send gave up waiting.
 */

const router = Router();

router.use(webhookCallbackLimiter, webhookCallbackAuthFailureLimiter);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DENIED = { error: 'Invalid webhook credentials' };
const MAX_URL = 2048;

/** A field a workflow left unmapped (Zapier and Make send "" or null) reads as left out. */
const mapped = (schema) =>
  z.preprocess(
    (value) => (value === null || (typeof value === 'string' && !value.trim()) ? undefined : value),
    schema.optional(),
  );

const statusBody = z.object({
  status: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    z.enum(['published', 'failed']),
  ),
  // Read as the browser would, then held to the column's length (00262).
  url: mapped(
    z
      .string()
      .trim()
      .max(MAX_URL * 4),
  ),
  // The CMS's own id for the post, for the workflow's later updates: a
  // number where the CMS counts its posts (WordPress, Ghost).
  externalId: mapped(
    z.union([z.string().trim().max(200), z.number().int().nonnegative().transform(String)]),
  ),
  // Why it failed, as the workflow says it.
  reason: mapped(z.string().trim().max(500)),
});

/**
 * An http(s) address as the browser reads it (no stray whitespace kept),
 * without sign-in details (they'd be stored and shown as a link), or null.
 */
function liveAddress(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href.length <= MAX_URL ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * POST /webhooks/content-drafts/:deliveryId/status
 * Body: { status: "published", url, externalId? } or { status: "failed", reason?, externalId? }.
 * Published marks the delivery published at that address, and its page too
 * when it is the page's latest delivery (an older one's late callback doesn't
 * move the page's address back), keeping the page in History as a "publish"
 * version unless History's latest version is already this page.
 * Failed marks the delivery failed with the workflow's reason, unless it was
 * already published.
 */
router.post('/:deliveryId/status', async (req, res) => {
  try {
    const { deliveryId } = req.params;
    // A malformed id, an unknown delivery, no webhook and a wrong secret all
    // answer the same, so this route doesn't tell which deliveries exist.
    if (!UUID.test(deliveryId)) return res.status(401).json(DENIED);

    const { data: delivery, error } = await supabaseAdmin
      .from('content_draft_deliveries')
      .select('id, brand_id, draft_id, status, published_url')
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

    const parsed = statusBody.safeParse(req.body ?? {});
    const url = parsed.success && parsed.data.url ? liveAddress(parsed.data.url) : null;
    if (!parsed.success || (parsed.data.status === 'published' && !url)) {
      return res.status(400).json({
        error:
          'Send { status: "published", url } with the http(s) address the page is live at (up to 2,048 characters, no sign-in details), or { status: "failed", reason? }.',
      });
    }
    const { status, externalId, reason } = parsed.data;
    const now = new Date().toISOString();
    const own = externalId ? { external_id: externalId } : {};

    if (status === 'failed') {
      // A page the CMS already said is live stays so (a later step's failure),
      // even when the two callbacks land together.
      const { data: failed, error: failError } = await supabaseAdmin
        .from('content_draft_deliveries')
        .update({
          status: 'failed',
          error: reason ?? 'Your workflow said the page wasn’t published',
          ...own,
        })
        .eq('id', delivery.id)
        .neq('status', 'published')
        .select('id');
      if (failError) throw new Error(failError.message);
      return res.json({ success: true, status: failed?.length ? 'failed' : 'published' });
    }

    // This delivery said so already (a workflow's retry): nothing changes,
    // its time included, but a CMS id the retry adds. A new delivery of a
    // page live at the same address (the post updated in place) is the page
    // as published again.
    if (delivery.status === 'published' && delivery.published_url === url) {
      if (externalId) {
        const { error: idError } = await supabaseAdmin
          .from('content_draft_deliveries')
          .update(own)
          .eq('id', delivery.id);
        if (idError) throw new Error(idError.message);
      }
      return res.json({ success: true, status: 'published' });
    }
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
        // The page as published, in History (00215 keeps "publish" for the
        // server), unless History's latest version is already this page.
        const { error: keepError } = await supabaseAdmin.rpc('content_draft_snapshot', {
          p_draft_id: delivery.draft_id,
          p_origin: 'publish',
        });
        if (keepError) {
          req.log?.warn?.({ err: keepError }, 'content draft publish version not kept');
        }
      }
    }
    // The delivery last: a write above that fails answers 500, and the
    // workflow's retry, finding it not yet published, does it all again.
    const { error: deliveryError } = await supabaseAdmin
      .from('content_draft_deliveries')
      .update({ status: 'published', published_url: url, published_at: now, ...own })
      .eq('id', delivery.id);
    if (deliveryError) throw new Error(deliveryError.message);
    return res.json({ success: true, status: 'published' });
  } catch (error) {
    req.log?.error?.({ err: error }, 'content draft status callback error');
    return res.status(500).json({ error: 'Failed to record the page’s status' });
  }
});

export default router;
