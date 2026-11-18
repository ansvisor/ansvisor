/**
 * The Action Center's reads for the web's agents (AEO Operator plan §2,
 * §4.2): a headless agent run has no one's session, so it can't ask GET
 * /api/action-center/today as the person. Server to server: CRON_SECRET
 * auth, compared in constant time, as the other internal endpoints.
 *
 * GET /api/internal/action-center/today?org_id=&brand_id=&user_id=
 *   The Today card's ranking for a person on a brand, as GET
 *   /api/action-center/today reads it for them (routes/action-center.js
 *   todayFor: the brand access check, then lib/action-center/today.js
 *   readToday), for the AEO Operator's plan. The brand must be the
 *   organization's and the person must be its member and reach the brand.
 *   → 200 { success, today: [{ id, category }], next: [{ id, category }] }:
 *     the actions' ids and Action Center categories, best first; nothing
 *     else of them (no title, no payload).
 *   → 400 a bad query; 401 without the secret.
 *   → 404 { code: 'not_found' }: no such brand, or another organization's.
 *   → 403 { code }: the person isn't in the brand's organization
 *     (not_in_workspace) or doesn't reach the brand (no_brand_access).
 *
 * Mounted in server.js before the authenticated /api routes. Reads only; no
 * AI call.
 */

import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { readToday } from '../lib/action-center/today.js';
import { webhookSecretsMatch } from '../lib/webhook-secret.js';

const router = Router();

router.use((req, res, next) => {
  const auth = req.headers.authorization;
  const secret = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!webhookSecretsMatch(process.env.CRON_SECRET, secret)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return next();
});

/** Seeded ids (the demo's) aren't RFC 4122 versions, so a plain GUID shape. */
const todayQuery = z.object({
  org_id: z.guid(),
  brand_id: z.guid(),
  user_id: z.guid(),
});

/**
 * The Action Center categories of the brand's actions, by id.
 *
 * @returns {Promise<Map<string, string>>}
 */
async function categoriesOf(brandId, ids) {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select('id, category')
    .eq('brand_id', brandId)
    .in('id', ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.id, row.category]));
}

/** GET /api/internal/action-center/today?org_id=&brand_id=&user_id= */
router.get('/today', async (req, res) => {
  const query = todayQuery.safeParse(req.query ?? {});
  if (!query.success) {
    return res.status(400).json({ success: false, message: 'Invalid request' });
  }
  const { org_id: orgId, brand_id: brandId, user_id: userId } = query.data;
  try {
    // The person reaches the brand, and the brand is their organization's (todayFor's check).
    const access = await assertBrandAccess(brandId, userId);
    if (access.orgId !== orgId) {
      return res.status(404).json({ success: false, code: 'not_found' });
    }
    const ranked = await readToday(supabaseAdmin, { orgId, brandId, userId });
    const categoryOf = await categoriesOf(
      brandId,
      [...ranked.today, ...ranked.next].map((entry) => entry.id),
    );
    // Ids and categories only; an action gone since it was ranked is left out.
    const shown = (entries) =>
      entries.flatMap((entry) =>
        categoryOf.has(entry.id) ? [{ id: entry.id, category: categoryOf.get(entry.id) }] : [],
      );
    return res.json({ success: true, today: shown(ranked.today), next: shown(ranked.next) });
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ success: false, code: 'not_found' });
    if (error.status === 403) {
      return res.status(403).json({ success: false, code: error.code ?? 'forbidden' });
    }
    req.log.error({ err: error }, 'internal action center today error');
    return res.status(500).json({ success: false, message: 'Failed to read today.' });
  }
});

export default router;
