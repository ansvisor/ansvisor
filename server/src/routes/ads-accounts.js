import { Router } from 'express';
import { z } from 'zod';
import { assertBrandAccess, assertRole } from '../lib/access.js';
import { adsEnabled } from '../lib/ads-flag.js';
import {
  AdsAccountError,
  connectChatGptAccount,
  disconnectAccount,
  listAccounts,
} from '../lib/ads/accounts.js';
import { ChatGptAdsKeyError, ChatGptAdsUnavailableError } from '../lib/ads/chatgpt-ads.js';
import { readsEveryOpportunity } from '../lib/ads/opportunities.js';
import { DEMO_BRAND } from '../middleware/demo-brand.js';

/**
 * A brand's ad accounts (Ads Phase 1, C1) under /api/ads/accounts. Like every
 * /api/ads path, not found while Ads is off (ADS_ENABLED), whatever the
 * method. The demo brand's writes are refused before they get here too
 * (middleware/demo-brand.js).
 *
 *   - GET: the brand's accounts, for anyone who can reach the brand. Never a
 *     key or a sign-in.
 *   - POST /chatgpt { brandId, apiKey }: connects a ChatGPT Ads account with
 *     the customer's own key. Admins only, on a plan that reads every
 *     opportunity (Ads' writes, routes/ads.js), never on the demo brand. The
 *     key is checked with ChatGPT Ads before it is kept, sealed.
 *   - DELETE /:accountId?brandId=…: removes one, with its key and metrics.
 *     Admins only.
 *
 * The key is in a request body only: it is never logged or answered back.
 */

const router = Router();

// Before every route, as routes/ads.js does: off, every path is not found.
router.use((req, res, next) =>
  adsEnabled() ? next() : res.status(404).json({ error: 'Not available', code: 'off' }),
);

const ADMIN_ONLY = Object.freeze(['admin']);

/** A refusal or failure as JSON; the key is never in what is logged. */
function failed(req, res, err, what) {
  if (err?.status === 403 || err?.status === 404) {
    return res
      .status(err.status)
      .json({ error: err.message, code: err.status === 404 ? 'not_found' : 'forbidden' });
  }
  if (err instanceof AdsAccountError) {
    const status = { invalid_key: 422, not_configured: 503, not_found: 404 }[err.code] ?? 400;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  if (err instanceof ChatGptAdsKeyError) {
    return res.status(422).json({ error: 'ChatGPT Ads refused this key.', code: 'invalid_key' });
  }
  if (err instanceof ChatGptAdsUnavailableError) {
    return res
      .status(502)
      .json({ error: 'ChatGPT Ads did not answer. Try again later.', code: 'upstream' });
  }
  req.log.error({ err: { name: err?.name, message: err?.message } }, what);
  return res.status(500).json({ error: 'Failed to read Ads', code: 'failed' });
}

const planLimit = (res) =>
  res.status(403).json({ error: 'plan_limit', code: 'plan_limit', feature: 'ads_read' });

// GET /api/ads/accounts?brandId=…
router.get('/', async (req, res) => {
  const parsed = z.guid().safeParse(req.query.brandId);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { brand, orgId } = await assertBrandAccess(parsed.data, req.user.id);
    return res.json({ accounts: await listAccounts({ orgId, brandId: brand.id }) });
  } catch (err) {
    return failed(req, res, err, 'ads accounts read error');
  }
});

// POST /api/ads/accounts/chatgpt { brandId, apiKey }
router.post('/chatgpt', async (req, res) => {
  const body = z
    .object({ brandId: z.guid(), apiKey: z.string().min(1).max(1024) })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { brand, orgId } = await assertBrandAccess(body.data.brandId, req.user.id);
    if (brand?.is_demo) return res.status(402).json(DEMO_BRAND);
    await assertRole(req.user.id, ADMIN_ONLY, 'Only admins can connect ad accounts.');
    if (!(await readsEveryOpportunity(orgId, brand))) return planLimit(res);
    const account = await connectChatGptAccount({
      orgId,
      brandId: brand.id,
      userId: req.user.id,
      apiKey: body.data.apiKey,
    });
    return res.status(201).json({ account });
  } catch (err) {
    return failed(req, res, err, 'ads chatgpt connect error');
  }
});

// DELETE /api/ads/accounts/:accountId?brandId=…
router.delete('/:accountId', async (req, res) => {
  const accountId = z.guid().safeParse(req.params.accountId);
  const brandId = z.guid().safeParse(req.query.brandId);
  if (!accountId.success || !brandId.success) {
    return res.status(400).json({ error: 'invalid', code: 'invalid' });
  }
  try {
    const { brand, orgId } = await assertBrandAccess(brandId.data, req.user.id);
    if (brand?.is_demo) return res.status(402).json(DEMO_BRAND);
    await assertRole(req.user.id, ADMIN_ONLY, 'Only admins can disconnect ad accounts.');
    return res.json(
      await disconnectAccount({
        orgId,
        brandId: brand.id,
        userId: req.user.id,
        accountId: accountId.data,
      }),
    );
  } catch (err) {
    return failed(req, res, err, 'ads account disconnect error');
  }
});

export default router;
