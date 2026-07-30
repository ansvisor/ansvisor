import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

/**
 * Deliver an event payload to a brand's active webhook configs.
 *
 * Same wire format as the Content Optimization send routes: a flat JSON
 * payload with an `event` field, plus the shared secret echoed in the
 * `X-Webhook-Secret` header when one is configured. Delivery is
 * best-effort — failures are logged, never thrown.
 *
 * Returns { sent, failed } delivery counts.
 */
export async function dispatchBrandWebhook(brandId, payload) {
  const { data: configs } = await supabaseAdmin
    .from('webhook_configs')
    .select('id, webhook_url, webhook_secret')
    .eq('brand_id', brandId)
    .eq('is_active', true);

  if (!configs?.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const config of configs) {
    const headers = { 'Content-Type': 'application/json' };
    if (config.webhook_secret) {
      headers['X-Webhook-Secret'] = config.webhook_secret;
    }

    try {
      const res = await fetch(config.webhook_url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        sent++;
      } else {
        failed++;
        logger.warn(
          { brandId, configId: config.id, status: res.status, event: payload?.event },
          'webhook delivery got non-2xx response',
        );
      }
    } catch (err) {
      failed++;
      logger.warn(
        { err, brandId, configId: config.id, event: payload?.event },
        'webhook delivery failed',
      );
    }
  }

  return { sent, failed };
}
