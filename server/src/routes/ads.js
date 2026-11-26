import { Router } from 'express';
import { z } from 'zod';
import { AD_CHANNELS } from '../config/ad-limits.js';
import { ADS_THRESHOLDS, adsThresholds } from '../config/ads.js';
import { MANAGER_ROLES, assertBrandAccess, assertRole, brandAccessOf } from '../lib/access.js';
import { adsEnabled } from '../lib/ads-flag.js';
import { logNotifyMe, readAdsActivity } from '../lib/ads/activity.js';
import {
  AdDraftsError,
  SEARCH_DESCRIPTIONS,
  SEARCH_HEADLINES,
  createAdDrafts,
} from '../lib/ads/drafts.js';
import { sendEarn } from '../lib/ads/earn.js';
import { exportEditor, exportOpportunity } from '../lib/ads/export.js';
import {
  SNAPSHOT_PERIOD,
  isDemoPrompt,
  readAdsSettings,
  readOpportunities,
  readsEveryOpportunity,
  saveAdsSettings,
  setDecision,
} from '../lib/ads/opportunities.js';
import { readOpportunity } from '../lib/ads/opportunity.js';
import { readOverview } from '../lib/ads/overview.js';
import { ADS_PERIODS } from '../lib/ads/standing.js';
import { PlanLimitError } from '../lib/plan-guard.js';
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
 * decision, the thresholds, the Pay card's ad drafts) and the Earn card's
 * Action Center action, each logged (lib/ads/activity.js), and the Google
 * Ads Editor exports, logged too, which a person imports themselves. Notify
 * me is only logged, for any member on any plan.
 */

const router = Router();

const off = (res) => res.status(404).json({ error: 'Not available', code: 'off' });

// Before every route, so a path added later is hidden with the rest.
router.use((req, res, next) => (adsEnabled() ? next() : off(res)));

/** A brand-access refusal as it is (403 or 404), a conflict (409); anything else is a failure. */
function failed(req, res, err, what) {
  if (err?.status === 403 || err?.status === 404) {
    return res
      .status(err.status)
      .json({ error: err.message, code: err.status === 404 ? 'not_found' : 'forbidden' });
  }
  if (err?.status === 409) return res.status(409).json({ error: err.message, code: 'conflict' });
  req.log.error({ err: { name: err?.name, message: err?.message, stack: err?.stack } }, what);
  return res.status(500).json({ error: 'Failed to read Ads', code: 'failed' });
}

/** Starter's and the trial's answer to a write, or a row past theirs: Growth's (ADS-01 §8). */
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
// trial get the first rows and how many more are locked, decided here; at
// 30 days, what moved in those rows since the last week compared.
router.get('/opportunities', async (req, res) => {
  const parsed = brandPeriod.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { brand, orgId } = await assertBrandAccess(parsed.data.brandId, req.user.id);
    const { period } = parsed.data;
    return res.json(await readOpportunities({ brand, orgId, period, compareWeeks: true }));
  } catch (err) {
    return failed(req, res, err, 'ads opportunities read error');
  }
});

// GET /api/ads/opportunities/:promptId?brandId=…&period=… — one prompt's
// drawer: the latest answer per platform, its fan-outs and keyword seeds
// (lib/ads/opportunity.js). A prompt outside the brand is not found; one
// past Starter's or the trial's rows is the plan's.
router.get('/opportunities/:promptId', async (req, res) => {
  const promptId = z.guid().safeParse(req.params.promptId);
  const parsed = brandPeriod.safeParse(req.query);
  if (!promptId.success || !parsed.success) {
    return res.status(400).json({ error: 'invalid', code: 'invalid' });
  }
  try {
    const { brand, orgId } = await assertBrandAccess(parsed.data.brandId, req.user.id);
    const read = await readOpportunity({
      brand,
      orgId,
      promptId: promptId.data,
      period: parsed.data.period,
    });
    return read ? res.json(read) : planLimit(res);
  } catch (err) {
    return failed(req, res, err, 'ads opportunity read error');
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

// POST /api/ads/opportunities/:promptId/earn { brandId, idempotencyKey } — the
// Earn card's fix as one Action Center action (lib/ads/earn.js), or the active
// action that already covers the prompt: as a decision is set (admins and
// managers, a plan that reads every opportunity, never the demo brand). The
// same key again answers what it made. Logged.
router.post('/opportunities/:promptId/earn', async (req, res) => {
  const promptId = z.guid().safeParse(req.params.promptId);
  const body = z
    .object({ brandId: z.guid(), idempotencyKey: z.string().trim().min(8).max(100) })
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
      'Only admins and managers can send a fix to the Action Center.',
    );
    if (!(await readsEveryOpportunity(orgId, brand))) return planLimit(res);
    const sent = await sendEarn({
      brand,
      orgId,
      promptId: promptId.data,
      userId: req.user.id,
      idempotencyKey: body.data.idempotencyKey,
    });
    return res.status(sent.created ? 201 : 200).json(sent);
  } catch (err) {
    return failed(req, res, err, 'ads earn error');
  }
});

/** A channel's copy given to gate (Chat's /ad-drafts): at most Ansvisor's draft size. */
const givenDraft = z
  .object({
    channel: z.enum(AD_CHANNELS),
    headlines: z.array(z.string().max(300)).min(1).max(SEARCH_HEADLINES),
    descriptions: z.array(z.string().max(500)).min(1).max(SEARCH_DESCRIPTIONS),
    contextHint: z.string().max(1000).nullable().default(null),
    keywords: z.array(z.string().max(200)).max(20).default([]),
    claims: z
      .array(z.object({ text: z.string().max(200), factId: z.guid().nullable() }))
      .max(20)
      .default([]),
  })
  .refine(
    // A ChatGPT ad is one headline and one description, as the model writes it.
    (d) => d.channel !== 'chatgpt' || (d.headlines.length === 1 && d.descriptions.length === 1),
  );

// POST /api/ads/opportunities/:promptId/drafts { brandId, idempotencyKey?, drafts? } —
// the Pay card's ad drafts, one per channel (lib/ads/drafts.js): a model call
// on the workspace's AI budget as 'ads', so admins and managers only, on a
// plan that reads every opportunity, never the demo brand. With `drafts`
// (Chat's /ad-drafts, written or rewritten in Chat), that copy is gated as
// it is, one per channel given, with no model call. Only drafts that pass
// the claims gate are saved (none: 422 gate_failed); no approved brand
// fact, or brand facts off below Quality's phase 2, is 409 facts_needed. The
// same key again answers the drafts it saved. Logged.
router.post('/opportunities/:promptId/drafts', async (req, res) => {
  const promptId = z.guid().safeParse(req.params.promptId);
  const body = z
    .object({
      brandId: z.guid(),
      idempotencyKey: z.string().trim().min(8).max(100).optional(),
      drafts: z
        .array(givenDraft)
        .min(1)
        .max(AD_CHANNELS.length)
        .refine((list) => new Set(list.map((d) => d.channel)).size === list.length)
        .optional(),
    })
    .safeParse(req.body);
  if (!promptId.success || !body.success) {
    return res.status(400).json({ error: 'invalid', code: 'invalid' });
  }
  try {
    const { brand, orgId } = await assertBrandAccess(body.data.brandId, req.user.id, {
      columns: 'name',
    });
    if (brand?.is_demo || (await isDemoPrompt(orgId, promptId.data))) {
      return res.status(402).json(DEMO_BRAND);
    }
    await assertRole(req.user.id, MANAGER_ROLES, 'Only admins and managers can write ad drafts.');
    if (!(await readsEveryOpportunity(orgId, brand))) return planLimit(res);
    const opportunity = await readOpportunity({
      brand,
      orgId,
      promptId: promptId.data,
      period: SNAPSHOT_PERIOD,
    });
    if (!opportunity) return planLimit(res);
    const made = await createAdDrafts({
      brand,
      orgId,
      opportunity,
      userId: req.user.id,
      idempotencyKey: body.data.idempotencyKey ?? null,
      ...(body.data.drafts ? { given: body.data.drafts, source: 'chat' } : { source: 'drawer' }),
    });
    return res.status(made.created ? 201 : 200).json(made);
  } catch (err) {
    if (err instanceof AdDraftsError) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    }
    // No plan: one to choose (402); a spent AI budget waits for the next period (429).
    if (err instanceof PlanLimitError) {
      const code = err.statusCode === 402 ? 'no_subscription' : 'ai_budget';
      return res.status(err.statusCode === 402 ? 402 : 429).json({ error: err.message, code });
    }
    return failed(req, res, err, 'ads drafts error');
  }
});

/**
 * An export's refusals before anything is read, as the Ads writes': the
 * file is the Phase 0 form of pushing paused drafts to an ad account (§7a
 * rules 7 and 11), so admins and managers, on a plan that reads every
 * opportunity, never the demo brand (a GET, so not the middleware's: here).
 * Answered here, and false.
 */
async function mayExport(req, res, brand, orgId, promptId = null) {
  if (brand?.is_demo || (promptId && (await isDemoPrompt(orgId, promptId)))) {
    res.status(402).json(DEMO_BRAND);
    return false;
  }
  await assertRole(req.user.id, MANAGER_ROLES, 'Only admins and managers can export Ads.');
  if (await readsEveryOpportunity(orgId, brand)) return true;
  planLimit(res);
  return false;
}

// GET /api/ads/export/editor?brandId=…&decision=all|earn_pay|pay|earn&period=… —
// the Opportunities' rows under the decision filter as a Google Ads Editor
// CSV (lib/ads/export.js): { fileName, csv, rowCount, prompts, droppedUrls },
// as JSON (the web's proxy passes on no Content-Disposition). Logged.
router.get('/export/editor', async (req, res) => {
  const parsed = brandPeriod
    .extend({ decision: z.enum(['all', 'earn_pay', 'pay', 'earn']).default('all') })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  const { brandId, decision, period } = parsed.data;
  try {
    const { brand, orgId } = await assertBrandAccess(brandId, req.user.id, { columns: 'name' });
    if (!(await mayExport(req, res, brand, orgId))) return undefined;
    return res.json(await exportEditor({ brand, orgId, userId: req.user.id, decision, period }));
  } catch (err) {
    return failed(req, res, err, 'ads editor export error');
  }
});

// GET /api/ads/export/opportunity/:promptId?brandId=…&period=… — one prompt
// as a Google Ads Editor CSV, as above; another brand's prompt is not found.
router.get('/export/opportunity/:promptId', async (req, res) => {
  const promptId = z.guid().safeParse(req.params.promptId);
  const parsed = brandPeriod.safeParse(req.query);
  if (!promptId.success || !parsed.success) {
    return res.status(400).json({ error: 'invalid', code: 'invalid' });
  }
  try {
    const { brand, orgId } = await assertBrandAccess(parsed.data.brandId, req.user.id, {
      columns: 'name',
    });
    if (!(await mayExport(req, res, brand, orgId, promptId.data))) return undefined;
    const file = await exportOpportunity({
      brand,
      orgId,
      userId: req.user.id,
      promptId: promptId.data,
      period: parsed.data.period,
    });
    return res.json(file);
  } catch (err) {
    return failed(req, res, err, 'ads opportunity export error');
  }
});

// POST /api/ads/connections/notify { brandId, platform } — Notify me on an ad
// platform that comes later (ADS-01 §3.5, `conn.notify`): any member who
// sees Ads, on any plan, since nothing runs or costs; logged once per person
// and platform in the workspace (201), asked again 200 with nothing logged.
// Never on the demo brand (402 demo_brand), as every Ads write.
router.post('/connections/notify', async (req, res) => {
  const body = z
    .object({ brandId: z.guid(), platform: z.enum(['microsoft', 'meta', 'linkedin']) })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { brand, orgId } = await assertBrandAccess(body.data.brandId, req.user.id);
    if (brand?.is_demo) return res.status(402).json(DEMO_BRAND);
    const { platform } = body.data;
    const logged = await logNotifyMe({ orgId, brandId: brand.id, userId: req.user.id, platform });
    return res.status(logged ? 201 : 200).json({ platform, logged });
  } catch (err) {
    return failed(req, res, err, 'ads notify error');
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
