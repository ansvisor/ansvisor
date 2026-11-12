import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { AI_SOURCES_VERSION } from '../lib/ai-sources.js';
import { MANAGER_ROLES, assertBrandAccess } from '../lib/access.js';
import {
  activateBrandAccount,
  removeBrandAccount,
  startBrandAccount,
  usableAccounts,
  useAccountForBrand,
} from '../lib/brand-integrations.js';
import { assertSignInReach, reachableBrandIds } from '../lib/brand-integration-reach.js';
import {
  connectedAccountStatus,
  deleteConnection,
  entityIdFor,
  isHubspotConfigured,
  linkHubspot,
} from '../lib/composio.js';
import { HubspotError, INTERACTIVE_WAIT_MS, hubspotClient } from '../lib/hubspot/client.js';
import { listBlogs } from '../lib/cms/hubspot-blog.js';
import {
  HUBSPOT,
  hubspotConnection,
  labelSignIn,
  markSignInRefused,
  nextConsent,
  propertiesReady,
  writeHubspotSettings,
} from '../lib/hubspot/connection.js';
import { runHubspotPipelineSync } from '../lib/hubspot/pipeline-sync.js';
import { PROPERTIES_VERSION } from '../lib/hubspot/properties.js';
import { ensureProperties, portalLabel, readPortal } from '../lib/hubspot/setup.js';
import { PlanLimitError, enforceFeature, requireFeature } from '../lib/plan-guard.js';

/**
 * HubSpot per brand (#2140), under /api/hubspot. Settings › Integrations'
 * HubSpot card reads and changes the active brand's connection here.
 *
 *   - Anyone who can access the brand reads it (GET).
 *   - An admin or manager who can access it connects HubSpot, uses the
 *     HubSpot account another brand uses, changes what Ansvisor may write
 *     and disconnects. Connecting needs the plan's `crm_integrations`
 *     (Growth and above); disconnecting never does: it ends an access.
 *   - Nothing is written to HubSpot without the person's consent, given
 *     when connecting (lib/hubspot/connection.js): with consent to mark
 *     contacts, the "Ansvisor" property group and its properties are made
 *     right after the sign-in (lib/hubspot/setup.js).
 *   - The demo brand connects nothing. No token, entity or Composio id leaves.
 */

const router = Router();

const FEATURE = 'crm_integrations';
const needsPlan = requireFeature(FEATURE);

const brandParams = z.object({ brandId: z.guid() });
const consentBody = z.object({ contacts: z.boolean(), pages: z.boolean() });
const connectBody = z.object({ callbackUrl: z.string().max(2048), consent: consentBody });
const accountBody = z.object({ accountId: z.guid(), consent: consentBody });
const settingsBody = z.object({ consent: consentBody });
const blogBody = z.object({ blogId: z.string().regex(/^\d{1,20}$/) });

function httpError(message, status, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

/** The brand, for someone who may read it; with `write`, change it too. */
async function brandFor(req, { write = false } = {}) {
  const parsed = brandParams.safeParse(req.params);
  if (!parsed.success) throw httpError('Invalid request', 400);
  const { brand, role } = await assertBrandAccess(parsed.data.brandId, req.user.id);
  if (write && !MANAGER_ROLES.includes(role)) {
    throw httpError('Only admins and managers can change integrations.', 403, 'forbidden');
  }
  // The demo brand is everyone's sample data: it connects nothing.
  if (write && brand.is_demo) throw httpError('The sample brand connects nothing.', 409, 'demo');
  return brand;
}

/** Writing to HubSpot needs one thing allowed at least: marking contacts, or draft pages. */
function assertConsent(consent) {
  if (!consent.contacts && !consent.pages) {
    throw httpError(
      'Choose what Ansvisor may do in HubSpot before connecting.',
      400,
      'consent_required',
    );
  }
}

function assertConfigured() {
  if (!isHubspotConfigured()) {
    throw httpError('HubSpot is not set up on this server.', 503, 'not_configured');
  }
}

/** Whether the plan has HubSpot: a lapsed plan still reads what it has (readOnly). */
async function planAllows(userId) {
  try {
    await enforceFeature(userId, FEATURE, { readOnly: true });
    return true;
  } catch (err) {
    if (err instanceof PlanLimitError) return false;
    throw err;
  }
}

/** The name of whoever allowed the writes, from their profile in the brand's workspace. */
async function profileName(userId, organizationId) {
  if (!userId) return null;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.full_name === 'string' && data.full_name ? data.full_name : null;
}

/**
 * Sets up HubSpot for the brand's connection: names the sign-in by its Hub
 * ID and, with consent to mark contacts, makes the Ansvisor properties.
 * HubSpot's refusals are kept on the settings (the card offers Try again),
 * and a refused sign-in is marked so the card asks to connect again.
 * Answers the settings to store.
 */
async function setUp(connection, settings, { portal = true } = {}) {
  const next = { ...settings };
  const request = hubspotClient(connection.composioAccountId, { maxWaitMs: INTERACTIVE_WAIT_MS });
  const refused = async (err) => {
    if (!(err instanceof HubspotError)) throw err;
    if (err.code === 'auth' && connection.accountId) await markSignInRefused(connection.accountId);
    return err.code;
  };
  if (portal) {
    try {
      next.portal = await readPortal(request);
      if (connection.accountId) await labelSignIn(connection.accountId, portalLabel(next.portal));
    } catch (err) {
      await refused(err);
    }
  }
  if (next.consent?.contacts) {
    try {
      await ensureProperties(request);
      next.properties = {
        version: PROPERTIES_VERSION,
        sourcesVersion: AI_SOURCES_VERSION,
        at: new Date().toISOString(),
        error: null,
      };
    } catch (err) {
      next.properties = { ...(settings.properties ?? {}), error: await refused(err) };
    }
  }
  return next;
}

/** The brand's HubSpot, as its card reads it. */
async function cardOf(req, brand) {
  const [connection, brandIds, allowed] = await Promise.all([
    hubspotConnection(brand.id),
    reachableBrandIds(req.user.id, brand.organization_id),
    planAllows(req.user.id),
  ]);
  const usable = await usableAccounts(brand.organization_id, HUBSPOT, brandIds);
  const own = connection ? usable.find((a) => a.accountId === connection.accountId) : null;
  const settings = connection?.settings ?? null;
  const allowedBy = settings ? await profileName(settings.consent.by, brand.organization_id) : null;
  return {
    brandId: brand.id,
    configured: isHubspotConfigured(),
    // The plan's crm_integrations; a connection kept past a downgrade is paused.
    allowed,
    connection: connection
      ? {
          accountId: connection.accountId,
          label: connection.label,
          status: connection.status,
          connected: connection.connected,
          portal: settings.portal
            ? {
                id: settings.portal.id,
                currency: settings.portal.currency,
                uiDomain: settings.portal.uiDomain,
              }
            : null,
          // The other brands (that the person can see) on the same HubSpot account.
          sharedWith: (own?.brandIds ?? []).filter((id) => id !== brand.id),
          consent: {
            contacts: settings.consent.contacts,
            pages: settings.consent.pages,
            by: allowedBy,
            at: settings.consent.at,
          },
          // The blog Send to CMS writes draft posts to (00522).
          blog: settings.blog ?? null,
          properties: {
            ready: propertiesReady(settings),
            at: settings.properties?.at ?? null,
            error: settings.properties?.error ?? null,
          },
          // The AI-sourced pipeline's last read of HubSpot (00520).
          sync: settings.sync ?? null,
          syncing: syncing.has(brand.id),
        }
      : null,
    // HubSpot accounts other brands the person can see use, which this one could use too.
    usable: usable
      .filter((a) => a.accountId !== connection?.accountId)
      .map(({ accountId, label, brandIds: ids }) => ({ accountId, label, brandIds: ids })),
  };
}

function sendError(req, res, err, what) {
  if (!err.status) req.log.error({ err: { name: err?.name, code: err?.code } }, what);
  return res
    .status(err.status || 500)
    .json({ error: err.status ? err.message : 'Something went wrong.', code: err.code });
}

/**
 * GET /api/hubspot/brands/:brandId
 * The brand's HubSpot connection: whether this server and the plan offer it,
 * the account it uses (with the other brands on it), what Ansvisor may
 * write, whether the Ansvisor properties are ready, and the HubSpot accounts
 * other brands use that it could use instead.
 */
router.get('/brands/:brandId', async (req, res) => {
  try {
    const brand = await brandFor(req);
    return res.json(await cardOf(req, brand));
  } catch (err) {
    return sendError(req, res, err, 'hubspot read error');
  }
});

/**
 * The brand's connected HubSpot, for picking its blog: a live sign-in the
 * person reaches (it reads every brand's on it), with consent to send pages
 * as drafts. 409 otherwise.
 */
async function blogConnection(req, brand) {
  const connection = await hubspotConnection(brand.id);
  if (!connection?.connected) throw httpError('Connect HubSpot first.', 409, 'not_connected');
  if (!connection.settings.consent.pages) {
    throw httpError('Allow sending pages as drafts first.', 409, 'consent_required');
  }
  await assertSignInReach(req.user.id, { accountId: connection.accountId });
  return connection;
}

/** HubSpot's refusal of a blog read, as the card names it: the content scope, the sign-in, or else. */
async function blogRefusal(err, connection) {
  if (!(err instanceof HubspotError)) throw err;
  if (err.code === 'auth' && connection.accountId) await markSignInRefused(connection.accountId);
  const code =
    err.code === 'scopes' ? 'scopes' : err.code === 'auth' ? 'refused' : 'hubspot_failed';
  return httpError("HubSpot didn't list the blogs.", 409, code);
}

/**
 * GET /api/hubspot/brands/:brandId/blogs
 * The blogs of the brand's HubSpot account, for Send to CMS's draft posts
 * (00522), and the one picked. Needs HubSpot's `content` scope: without it,
 * 409 `scopes` (connect HubSpot again).
 */
router.get('/brands/:brandId/blogs', needsPlan, async (req, res) => {
  try {
    const brand = await brandFor(req, { write: true });
    const connection = await blogConnection(req, brand);
    const request = hubspotClient(connection.composioAccountId, { maxWaitMs: INTERACTIVE_WAIT_MS });
    let blogs;
    try {
      blogs = await listBlogs(request);
    } catch (err) {
      throw await blogRefusal(err, connection);
    }
    return res.json({ blogs, picked: connection.settings.blog?.id ?? null });
  } catch (err) {
    return sendError(req, res, err, 'hubspot blogs error');
  }
});

/**
 * PUT /api/hubspot/brands/:brandId/blog  { blogId }
 * The HubSpot blog Send to CMS writes the brand's pages to, as draft posts.
 * One of the account's blogs (read again to check it, and keep its name).
 */
router.put('/brands/:brandId/blog', needsPlan, async (req, res) => {
  try {
    const body = blogBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: 'Invalid request' });
    const brand = await brandFor(req, { write: true });
    const connection = await blogConnection(req, brand);
    const request = hubspotClient(connection.composioAccountId, { maxWaitMs: INTERACTIVE_WAIT_MS });
    let blogs;
    try {
      blogs = await listBlogs(request);
    } catch (err) {
      throw await blogRefusal(err, connection);
    }
    const blog = blogs.find((b) => b.id === body.data.blogId);
    if (!blog) throw httpError("That blog isn't in the HubSpot account.", 404, 'blog_not_found');
    await writeHubspotSettings(brand.id, {
      ...connection.settings,
      blog: { id: blog.id, name: blog.name },
    });
    return res.json(await cardOf(req, brand));
  } catch (err) {
    return sendError(req, res, err, 'hubspot blog error');
  }
});

/**
 * POST /api/hubspot/brands/:brandId/connect  { callbackUrl, consent }
 * Starts HubSpot's sign-in for the brand: the address to open and the new
 * sign-in's id, which /activate takes once the person has signed in. The
 * consent is asked first: one of marking contacts or draft pages.
 */
router.post('/brands/:brandId/connect', needsPlan, async (req, res) => {
  try {
    const body = connectBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: 'Invalid request' });
    assertConsent(body.data.consent);
    assertConfigured();
    const brand = await brandFor(req, { write: true });
    const { callbackUrl } = body.data;
    if (!/^https?:\/\//.test(callbackUrl)) {
      return res.status(400).json({ error: 'callbackUrl is required' });
    }
    const appUrl = process.env.PUBLIC_APP_URL;
    if (appUrl) {
      try {
        if (new URL(callbackUrl).origin !== new URL(appUrl).origin) {
          return res.status(400).json({ error: 'callbackUrl must be on the app origin' });
        }
      } catch {
        return res.status(400).json({ error: 'callbackUrl is not a valid URL' });
      }
    }
    const started = await startBrandAccount(
      {
        brand,
        provider: HUBSPOT,
        userId: req.user.id,
        entityId: entityIdFor(brand.organization_id),
      },
      {
        initiate: (entityId) => linkHubspot(entityId, callbackUrl),
        deleteRemote: deleteConnection,
      },
    );
    return res.json(started);
  } catch (err) {
    return sendError(req, res, err, 'hubspot connect error');
  }
});

/**
 * POST /api/hubspot/brands/:brandId/activate  { accountId, consent }
 * Whether the brand's HubSpot sign-in is done: 'pending' until Composio says
 * it is active; then the brand uses it, the consent is kept, and HubSpot is
 * set up (setUp). { status: 'connected' }.
 */
router.post('/brands/:brandId/activate', needsPlan, async (req, res) => {
  try {
    const body = accountBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: 'Invalid request' });
    assertConsent(body.data.consent);
    assertConfigured();
    const brand = await brandFor(req, { write: true });
    const status = await activateBrandAccount(
      { brand, provider: HUBSPOT, accountId: body.data.accountId, userId: req.user.id },
      { status: connectedAccountStatus, deleteRemote: deleteConnection },
    );
    if (status !== 'connected') return res.json({ status });
    await settle(brand, req.user.id, body.data.consent);
    return res.json({ status });
  } catch (err) {
    return sendError(req, res, err, 'hubspot activate error');
  }
});

/**
 * The brand's new HubSpot account, set up: the consent given now (a new
 * account is asked afresh), then setUp, stored.
 */
async function settle(brand, userId, consent) {
  const connection = await hubspotConnection(brand.id);
  if (!connection) throw httpError('The brand uses no HubSpot account.', 409, 'not_connected');
  const settings = await setUp(connection, {
    consent: nextConsent(null, consent, userId),
    portal: null,
    properties: null,
  });
  await writeHubspotSettings(brand.id, settings);
}

/**
 * POST /api/hubspot/brands/:brandId/use  { accountId, consent }
 * "Use the same HubSpot account as {brand}": the brand uses a HubSpot
 * account another brand the person can see uses, with the consent given now.
 */
router.post('/brands/:brandId/use', needsPlan, async (req, res) => {
  try {
    const body = accountBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: 'Invalid request' });
    assertConsent(body.data.consent);
    assertConfigured();
    const brand = await brandFor(req, { write: true });
    // Reading through the account reads every brand's on it: the caller needs each.
    await assertSignInReach(req.user.id, { accountId: body.data.accountId });
    const brandIds = await reachableBrandIds(req.user.id, brand.organization_id);
    await useAccountForBrand(
      { brand, provider: HUBSPOT, accountId: body.data.accountId, brandIds },
      { deleteRemote: deleteConnection },
    );
    await settle(brand, req.user.id, body.data.consent);
    return res.json(await cardOf(req, brand));
  } catch (err) {
    return sendError(req, res, err, 'hubspot use error');
  }
});

/**
 * PUT /api/hubspot/brands/:brandId/settings  { consent }
 * What Ansvisor may write in the brand's HubSpot: turning one off stops it at
 * once; turning marking contacts on makes the properties when they aren't
 * ready. Who allowed and when is kept.
 */
router.put('/brands/:brandId/settings', needsPlan, async (req, res) => {
  try {
    const body = settingsBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: 'Invalid request' });
    const brand = await brandFor(req, { write: true });
    const connection = await hubspotConnection(brand.id);
    if (!connection) throw httpError('Connect HubSpot first.', 409, 'not_connected');
    let settings = {
      ...connection.settings,
      consent: nextConsent(connection.settings.consent, body.data.consent, req.user.id),
    };
    if (settings.consent.contacts && !propertiesReady(settings) && connection.connected) {
      settings = await setUp(connection, settings, { portal: false });
    }
    await writeHubspotSettings(brand.id, settings);
    return res.json(await cardOf(req, brand));
  } catch (err) {
    return sendError(req, res, err, 'hubspot settings error');
  }
});

/**
 * POST /api/hubspot/brands/:brandId/setup
 * Try again: reads the HubSpot account and, with consent to mark contacts,
 * makes the Ansvisor properties that aren't there.
 */
router.post('/brands/:brandId/setup', needsPlan, async (req, res) => {
  try {
    assertConfigured();
    const brand = await brandFor(req, { write: true });
    const connection = await hubspotConnection(brand.id);
    if (!connection?.connected) {
      throw httpError('Connect HubSpot first.', 409, 'not_connected');
    }
    await writeHubspotSettings(brand.id, await setUp(connection, connection.settings));
    return res.json(await cardOf(req, brand));
  } catch (err) {
    return sendError(req, res, err, 'hubspot setup error');
  }
});

/** Brands whose Sync now is running, and when each last started. */
const syncing = new Set();
const syncStarted = new Map();
/** How often a brand's Sync now may start. */
export const SYNC_NOW_EVERY_MS = 5 * 60 * 1000;

/**
 * POST /api/hubspot/brands/:brandId/sync
 * Sync now: reads the brand's AI-sourced contacts and deals from HubSpot
 * again (lib/hubspot/pipeline-sync.js), in the background: 202 at once, and
 * the card and AI Traffic read the result when it's done. Once every few
 * minutes a brand (429 `busy` meanwhile). Needs consent to mark contacts,
 * which covers reading them back.
 */
router.post('/brands/:brandId/sync', needsPlan, async (req, res) => {
  try {
    assertConfigured();
    const brand = await brandFor(req, { write: true });
    const connection = await hubspotConnection(brand.id);
    if (!connection?.connected) throw httpError('Connect HubSpot first.', 409, 'not_connected');
    if (!connection.settings.consent.contacts) {
      throw httpError('Allow marking contacts first.', 409, 'consent_required');
    }
    const last = syncStarted.get(brand.id) ?? 0;
    if (syncing.has(brand.id) || Date.now() - last < SYNC_NOW_EVERY_MS) {
      return res.status(429).json({ error: 'HubSpot was synced a moment ago.', code: 'busy' });
    }
    syncing.add(brand.id);
    syncStarted.set(brand.id, Date.now());
    runHubspotPipelineSync({ brandId: brand.id })
      .catch((err) => req.log.error({ err: { name: err?.name } }, 'hubspot sync now error'))
      .finally(() => syncing.delete(brand.id));
    return res.status(202).json({ started: true });
  } catch (err) {
    return sendError(req, res, err, 'hubspot sync now error');
  }
});

/**
 * DELETE /api/hubspot/brands/:brandId
 * Disconnect: the brand uses no HubSpot account, so nothing is read from or
 * written to HubSpot for it any more. Its HubSpot sign-in goes too when no
 * other brand uses it. The Ansvisor properties and their values stay in
 * HubSpot (the customer's data). Open on every plan.
 */
router.delete('/brands/:brandId', async (req, res) => {
  try {
    const brand = await brandFor(req, { write: true });
    await removeBrandAccount({ brand, provider: HUBSPOT }, { deleteRemote: deleteConnection });
    return res.json({ success: true });
  } catch (err) {
    return sendError(req, res, err, 'hubspot disconnect error');
  }
});

export default router;
