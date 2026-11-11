import { Router } from 'express';
import { z } from 'zod';
import { assertBrandAccess } from '../lib/access.js';
import { adsEnabled } from '../lib/ads-flag.js';

/**
 * Ads (the Drive Ads spec, ADS-01) under /api/ads, while it is built.
 *
 *   - Off (the server's ADS_ENABLED isn't "true", as in production), every
 *     path here, known or not and whatever the method, is not found:
 *     404 { code: 'off' }, as brand-facts.js answers below Quality's phase 2.
 *   - The person is signed in: /api's decodeToken (server.js) refuses a
 *     request without a session before it gets here, on or off.
 *   - Each route reads one brand, which the person must be able to reach
 *     (assertBrandAccess), as every brand route does.
 *
 * Nothing here reaches an ad platform, and nothing writes.
 */

const router = Router();

const off = (res) => res.status(404).json({ error: 'Not available', code: 'off' });

// Before every route, so a path added later is hidden with the rest.
router.use((req, res, next) => (adsEnabled() ? next() : off(res)));

/** A brand-access refusal as it is (403 or 404); anything else is a failure. */
function failed(req, res, err, what) {
  if (err?.status === 403 || err?.status === 404) {
    return res
      .status(err.status)
      .json({ error: err.message, code: err.status === 404 ? 'not_found' : 'forbidden' });
  }
  req.log.error({ err: { name: err?.name, message: err?.message, stack: err?.stack } }, what);
  return res.status(500).json({ error: 'Failed to read Ads', code: 'failed' });
}

// GET /api/ads/status?brandId=… — Ads is on for this install, for a person
// who can reach the brand. Where the plan stops (Starter's three rows, the
// trial) is decided by the routes that read data.
router.get('/status', async (req, res) => {
  const parsed = z.guid().safeParse(req.query.brandId);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    await assertBrandAccess(parsed.data, req.user.id);
    return res.json({ enabled: true });
  } catch (err) {
    return failed(req, res, err, 'ads status error');
  }
});

export default router;
