import { Router } from 'express';
import { z } from 'zod';
import { ADS_THRESHOLDS, adsThresholds } from '../config/ads.js';
import { MANAGER_ROLES, assertBrandAccess, assertRole, brandAccessOf } from '../lib/access.js';
import { adsEnabled } from '../lib/ads-flag.js';
import { readAdsActivity } from '../lib/ads/activity.js';
import {
  SNAPSHOT_PERIOD,
  isDemoPrompt,
  readAdsSettings,
  readOpportunities,
  readsEveryOpportunity,
  saveAdsSettings,
  setDecision,
} from '../lib/ads/opportunities.js';
import { readOverview } from '../lib/ads/overview.js';
import { ADS_PERIODS } from '../lib/ads/standing.js';
import { DEMO_BRAND } from '../middleware/demo-brand.js';

/**
 * Ads (the Drive Ads spec, ADS-01) under /api/ads, while it is built.
 *
 *   - Off (the server's ADS_ENABLED isn't "true", as in production), every
 *     path here, known or not and whatever the method, is not found:
 *     404 { code: 'off' }, as brand-facts.js answers below Quality's phase 2.
 *   - The person is signed in: /api's decodeToken (server.js) refuses a
 *     request without a session before it gets here, on or off.
 *   - A route that names a brand checks the person can reach it
 *     (assertBrandAccess), as every brand route does.
 *   - The demo brand's decisions are the rule's: a decision naming it, or a
 *     prompt of it, is refused before it gets here
 *     (middleware/demo-brand.js), and here too (402 demo_brand).
 *   - A write is for a plan that reads every opportunity (Growth and up;
 *     self-hosted has no plans): Starter and the trial get 403 plan_limit.
 *
 * Nothing here reaches an ad platform. The writes are Ads' own rows (a
 * decision, the thresholds), each logged (lib/ads/activity.js).
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

/** Starter's and the trial's answer to a write: it is Growth's (ADS-01 §8). */
const planLimit = (res) =>
  res.status(403).json({ error: 'plan_limit', code: 'plan_limit', feature: 'ads_read' });

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

// GET /api/ads/activity?brandId=…&before=…&limit=… — the workspace's Ads
// activity log, newest first (00530), of one brand or all: Admins only.
// Others read their own rows through the table's policy.
router.get('/activity', async (req, res) => {
  const parsed = z
    .object({
      brandId: z.guid().optional(),
      before: z.iso.datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  const { brandId, before, limit } = parsed.data;
  try {
    const { orgId, role } = brandId
      ? await assertBrandAccess(brandId, req.user.id)
      : await brandAccessOf(req.user.id);
    if (!orgId || role !== 'admin') {
      return res.status(403).json({
        error: 'Only admins can read the Ads activity log.',
        code: 'forbidden',
      });
    }
    return res.json(await readAdsActivity({ orgId, brandId, before, limit }));
  } catch (err) {
    return failed(req, res, err, 'ads activity read error');
  }
});

/** A read of one brand over a period: 30 days, the page's own, unless asked. */
const brandPeriod = z.object({
  brandId: z.guid(),
  period: z.enum(Object.keys(ADS_PERIODS)).default(SNAPSHOT_PERIOD),
});

// GET /api/ads/opportunities?brandId=…&period=7d|30d|90d — each buying-intent
// prompt's standing and decision (lib/ads/opportunities.js). Starter and the
// trial get the first rows and how many more are locked, decided here.
router.get('/opportunities', async (req, res) => {
  const parsed = brandPeriod.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { brand, orgId } = await assertBrandAccess(parsed.data.brandId, req.user.id);
    return res.json(await readOpportunities({ brand, orgId, period: parsed.data.period }));
  } catch (err) {
    return failed(req, res, err, 'ads opportunities read error');
  }
});

// GET /api/ads/overview?brandId=…&period=7d|30d|90d — the Overview's counts
// over every buying-intent prompt (lib/ads/overview.js), for every plan:
// Starter and the trial see the Overview whole (§8).
router.get('/overview', async (req, res) => {
  const parsed = brandPeriod.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { brand, orgId } = await assertBrandAccess(parsed.data.brandId, req.user.id);
    return res.json(await readOverview({ brand, orgId, period: parsed.data.period }));
  } catch (err) {
    return failed(req, res, err, 'ads overview read error');
  }
});

// PATCH /api/ads/opportunities/:promptId/decision { brandId, decision } — a
// person's decision over the rule's (null takes it back): admins and
// managers, on a plan that reads every opportunity, never on the demo brand
// (by the brand named or the prompt's). Logged.
router.patch('/opportunities/:promptId/decision', async (req, res) => {
  const promptId = z.guid().safeParse(req.params.promptId);
  const body = z
    .object({ brandId: z.guid(), decision: z.enum(['earn', 'pay', 'earn_pay']).nullable() })
    .safeParse(req.body);
  if (!promptId.success || !body.success) {
    return res.status(400).json({ error: 'invalid', code: 'invalid' });
  }
  try {
    const { brand, orgId } = await assertBrandAccess(body.data.brandId, req.user.id);
    if (brand?.is_demo || (await isDemoPrompt(orgId, promptId.data))) {
      return res.status(402).json(DEMO_BRAND);
    }
    await assertRole(
      req.user.id,
      MANAGER_ROLES,
      'Only admins and managers can change an Ads decision.',
    );
    if (!(await readsEveryOpportunity(orgId, brand))) return planLimit(res);
    const override = await setDecision({
      orgId,
      brandId: brand.id,
      promptId: promptId.data,
      decision: body.data.decision,
      userId: req.user.id,
    });
    return res.json({ promptId: promptId.data, override });
  } catch (err) {
    return failed(req, res, err, 'ads decision error');
  }
});

/** The caller's workspace when they are its Admin; otherwise answered 403 here, and null. */
async function adminWorkspace(req, res) {
  const access = await brandAccessOf(req.user.id);
  if (access.orgId && access.role === 'admin') return access.orgId;
  res.status(403).json({ error: 'Only admins can see or change Ads settings.', code: 'forbidden' });
  return null;
}

/** The settings as the API answers them: the workspace's own, what applies, the defaults. */
const settingsOf = ({ thresholds, updatedBy, updatedAt }) => ({
  saved: thresholds,
  thresholds: adsThresholds(thresholds),
  defaults: ADS_THRESHOLDS,
  updatedBy,
  updatedAt,
});

// GET /api/ads/settings — the workspace's earn-or-pay thresholds (Admins, on
// any plan: Starter and the trial read the ones their rows are decided by).
router.get('/settings', async (req, res) => {
  try {
    const orgId = await adminWorkspace(req, res);
    return orgId && res.json(settingsOf(await readAdsSettings(orgId)));
  } catch (err) {
    return failed(req, res, err, 'ads settings read error');
  }
});

// PATCH /api/ads/settings { thresholds: { key: number | null } } — changes
// them (null: back to the default), logged: Admins, on a plan that reads
// every opportunity, as a decision. The workspace's own: names no brand.
router.patch('/settings', async (req, res) => {
  const value = (schema) => schema.nullable().optional();
  const body = z
    .object({
      thresholds: z
        .strictObject({
          minIntentWeight: value(z.number().min(0).max(1)),
          leadPosition: value(z.number().min(1).max(20)),
          minPaidVolume: value(z.number().int().min(0).max(100_000_000)),
        })
        .refine((t) => Object.keys(t).length > 0),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const orgId = await adminWorkspace(req, res);
    if (!orgId) return undefined;
    if (!(await readsEveryOpportunity(orgId))) return planLimit(res);
    return res.json(settingsOf(await saveAdsSettings(orgId, req.user.id, body.data.thresholds)));
  } catch (err) {
    return failed(req, res, err, 'ads settings write error');
  }
});

export default router;
