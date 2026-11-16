import supabaseAdmin from '../config/supabase.js';
import { captureProductEvents } from './product-events.js';
import { logger } from './logger.js';

/**
 * The server's two events of the core-loop funnel (docs/analytics/core-loop-funnel.md):
 * `tracking_results_ready` and `action_created`, which happen with nobody's
 * browser open. Sent to the web's PostHog project (product-events.js) as a
 * person, by user id, as the web identifies: the acting user when there is one,
 * else the workspace's first admin, who signed up with it. Properties are ids,
 * counts and the plan, never a name, domain or text.
 *
 * Nothing is read or sent without POSTHOG_KEY (a self-hosted install), a demo
 * brand sends nothing, and it never throws: a failure is logged and dropped.
 */

/**
 * @param {string} brandId
 * @param {string} event
 * @param {Record<string, unknown>} [properties]
 * @param {{ userId?: string | null, db?: typeof supabaseAdmin,
 *   capture?: typeof captureProductEvents }} [options]
 * @returns {Promise<void>}
 */
export async function captureWorkspaceEvent(
  brandId,
  event,
  properties = {},
  { userId = null, db = supabaseAdmin, capture = captureProductEvents } = {},
) {
  if (!process.env.POSTHOG_KEY || !brandId) return;
  try {
    const { data: brand } = await db
      .from('brands')
      .select('organization_id, is_demo')
      .eq('id', brandId)
      .maybeSingle();
    if (!brand?.organization_id || brand.is_demo) return;

    const orgId = brand.organization_id;
    const [{ data: org }, owner] = await Promise.all([
      db.from('organizations').select('plan').eq('id', orgId).maybeSingle(),
      userId
        ? { data: { id: userId } }
        : db
            .from('profiles')
            .select('id')
            .eq('organization_id', orgId)
            .eq('role', 'admin')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle(),
    ]);
    const distinctId = owner?.data?.id;
    if (!distinctId) return;

    await capture([
      {
        event,
        distinctId,
        properties: { ...properties, brand_id: brandId, organization_id: orgId, plan: org?.plan },
      },
    ]);
  } catch (err) {
    logger.warn({ err: { name: err?.name }, event }, '[core-loop-events] not sent');
  }
}
