import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { connectWebflowToken, deleteConnection, isWebflowConfigured } from '../lib/composio.js';
import {
  WebflowError,
  checkFieldMap,
  getCollection,
  listCollections,
  listSites,
  suggestFieldMap,
} from '../lib/cms/webflow.js';
import { cmsLimiter } from '../middleware/rate-limiter.js';

/**
 * A brand's CMS connection for Send to CMS (#1331, phase 2; 00283): Webflow
 * first. Members read a brand's connection; admins and managers connect the
 * brand's site with a site token, pick the collection pages go to and its
 * fields, and disconnect:
 *   GET    /api/cms/brands/:brandId/webflow                             the connection, or none
 *   POST   /api/cms/brands/:brandId/webflow { token }                   connect, or replace the token
 *   GET    /api/cms/brands/:brandId/webflow/collections?siteId=         a site's collections
 *   GET    /api/cms/brands/:brandId/webflow/collections/:collectionId   its fields and a suggested map
 *   PUT    /api/cms/brands/:brandId/webflow { siteId?, collectionId, fieldMap }
 *   DELETE /api/cms/brands/:brandId/webflow
 * The token passes through here once, from the browser to Composio, which
 * keeps it: it is never stored, logged or sent back.
 */

const router = Router();

const PROVIDER = 'webflow';
const WRITE_ROLES = ['admin', 'manager'];
const COLUMNS =
  'brand_id, composio_account_id, composio_entity_id, status, site_id, site_name, collection_id, collection_name, field_map, created_at, updated_at';

const brandId = z.guid();
// A Webflow site token: no spaces, as Webflow shows it.
const tokenInput = z.object({ token: z.string().trim().min(16).max(512).regex(/^\S+$/) });
const webflowId = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);
const mapInput = z.object({
  siteId: webflowId.optional(),
  collectionId: webflowId,
  fieldMap: z.record(z.string(), z.string().max(100)),
});

/** A brand's Composio user: a site token is one site's, so the brand's own. */
const entityIdFor = (id) => `brand_${id}`;

function routeError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

async function assertWriter(id, userId) {
  await assertBrandAccess(id, userId);
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (!WRITE_ROLES.includes(profile?.role)) {
    throw routeError('Only admins and managers can connect a CMS.', 403, 'forbidden');
  }
}

async function connectionOf(id) {
  const { data, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select(COLUMNS)
    .eq('brand_id', id)
    .eq('provider', PROVIDER)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** The connection as the web shows it: never Composio's ids. */
const shape = (row) =>
  row
    ? {
        status: row.status,
        siteId: row.site_id,
        siteName: row.site_name,
        collectionId: row.collection_id,
        collectionName: row.collection_name,
        fieldMap: row.field_map ?? {},
        connectedAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;

const accountOf = (row) => ({
  entityId: row.composio_entity_id,
  accountId: row.composio_account_id,
});

/** A brand that must have a connection to go on. */
async function connected(id) {
  const row = await connectionOf(id);
  if (!row) throw routeError('Connect Webflow first.', 409, 'not_connected');
  return row;
}

/** Remove a connected account at Composio; a failure is logged by name only. */
async function forget(req, accountId) {
  try {
    await deleteConnection(accountId);
  } catch (err) {
    req.log.warn({ err: { name: err?.name } }, 'cms webflow account not removed');
  }
}

/**
 * Answers a failure: a refused token marks the connection auth_failed, so
 * Settings asks for a new one. Errors are logged without their message
 * where it may quote what the person typed.
 */
async function fail(req, res, err, what, id) {
  if (err instanceof WebflowError) {
    if (err.code === 'auth_failed' && id) {
      await supabaseAdmin
        .from('brand_cms_connections')
        .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
        .eq('brand_id', id)
        .eq('provider', PROVIDER);
    }
    const status = err.code === 'failed' ? 502 : err.code === 'not_found' ? 404 : 409;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  if (err?.status && err.status < 500) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code === 'not_in_workspace' ? 'not_in_workspace' : (err.code ?? 'forbidden'),
    });
  }
  req.log.error({ err: { name: err?.name } }, what);
  return res.status(500).json({ error: 'Something went wrong with Webflow', code: 'failed' });
}

const notConfigured = (res) =>
  res.status(503).json({ error: 'Webflow is not set up on this server.', code: 'not_configured' });

/** The brand from the path, or a 400. */
function brandOf(req, res) {
  const parsed = brandId.safeParse(req.params.brandId);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid brand', code: 'invalid' });
    return null;
  }
  return parsed.data;
}

// GET — the brand's connection, for every member (Settings, the Send dialog).
router.get('/brands/:brandId/webflow', async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertBrandAccess(id, req.user.id);
    return res.json({
      configured: isWebflowConfigured(),
      connection: shape(await connectionOf(id)),
    });
  } catch (err) {
    return fail(req, res, err, 'cms webflow read error');
  }
});

// POST — connect the brand's site with its token, or replace the token.
router.post('/brands/:brandId/webflow', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertWriter(id, req.user.id);
    if (!isWebflowConfigured()) return notConfigured(res);
    const parsed = tokenInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Paste the site token Webflow gave you.', code: 'invalid' });
    }
    const entityId = entityIdFor(id);
    let accountId;
    try {
      accountId = await connectWebflowToken(entityId, parsed.data.token);
    } catch (err) {
      req.log.error({ err: { name: err?.name } }, 'cms webflow connect error');
      return res.status(502).json({ error: 'Webflow could not be connected', code: 'failed' });
    }

    // Webflow says whether it takes the token: a token it refuses isn't kept.
    let sites;
    try {
      sites = await listSites({ entityId, accountId });
    } catch (err) {
      await forget(req, accountId);
      return fail(req, res, err, 'cms webflow sites error');
    }
    if (!sites.length) {
      await forget(req, accountId);
      return res
        .status(409)
        .json({ error: 'This token reaches no Webflow site.', code: 'no_site' });
    }

    // A new token for the same site keeps where pages go; another site starts over.
    const before = await connectionOf(id);
    const kept = before?.site_id && sites.some((s) => s.id === before.site_id) ? before : null;
    const site = kept
      ? sites.find((s) => s.id === kept.site_id)
      : sites.length === 1
        ? sites[0]
        : null;
    const now = new Date().toISOString();
    const { data: row, error } = await supabaseAdmin
      .from('brand_cms_connections')
      .upsert(
        {
          brand_id: id,
          provider: PROVIDER,
          composio_account_id: accountId,
          composio_entity_id: entityId,
          status: 'connected',
          site_id: site?.id ?? null,
          site_name: site?.name ?? null,
          collection_id: kept?.collection_id ?? null,
          collection_name: kept?.collection_name ?? null,
          field_map: kept?.field_map ?? {},
          connected_by: req.user.id,
          updated_at: now,
        },
        { onConflict: 'brand_id,provider' },
      )
      .select(COLUMNS)
      .single();
    if (error) {
      await forget(req, accountId);
      throw new Error(error.message);
    }
    if (before?.composio_account_id && before.composio_account_id !== accountId) {
      await forget(req, before.composio_account_id);
    }
    return res.json({ connection: shape(row), sites });
  } catch (err) {
    return fail(req, res, err, 'cms webflow connect error');
  }
});

// GET — a site's collections (the connection's site unless another is asked).
router.get('/brands/:brandId/webflow/collections', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertWriter(id, req.user.id);
    if (!isWebflowConfigured()) return notConfigured(res);
    const row = await connected(id);
    const asked = req.query.siteId === undefined ? null : webflowId.safeParse(req.query.siteId);
    if (asked && !asked.success)
      return res.status(400).json({ error: 'Invalid site', code: 'invalid' });
    const account = accountOf(row);
    const sites = await listSites(account);
    const siteId = asked?.data ?? row.site_id ?? (sites.length === 1 ? sites[0].id : null);
    if (!siteId || !sites.some((s) => s.id === siteId)) {
      return res.json({ sites, siteId: null, collections: [] });
    }
    return res.json({ sites, siteId, collections: await listCollections(account, siteId) });
  } catch (err) {
    return fail(req, res, err, 'cms webflow collections error', id);
  }
});

// GET — a collection's fields, the map they suggest, and the fields it requires.
router.get('/brands/:brandId/webflow/collections/:collectionId', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  const collectionId = webflowId.safeParse(req.params.collectionId);
  if (!collectionId.success) {
    return res.status(400).json({ error: 'Invalid collection', code: 'invalid' });
  }
  try {
    await assertWriter(id, req.user.id);
    if (!isWebflowConfigured()) return notConfigured(res);
    const row = await connected(id);
    const collection = await getCollection(accountOf(row), collectionId.data);
    const suggested = suggestFieldMap(collection.fields);
    return res.json({ ...collection, suggested });
  } catch (err) {
    return fail(req, res, err, 'cms webflow collection error', id);
  }
});

// PUT — where the brand's pages go: the site, the collection and its fields.
router.put('/brands/:brandId/webflow', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertWriter(id, req.user.id);
    if (!isWebflowConfigured()) return notConfigured(res);
    const parsed = mapInput.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: 'Invalid settings', code: 'invalid' });
    const row = await connected(id);
    const account = accountOf(row);
    const { collectionId, fieldMap } = parsed.data;

    // The site and the collection must be the token's.
    const sites = await listSites(account);
    const site = sites.find((s) => s.id === (parsed.data.siteId ?? row.site_id));
    if (!site)
      return res.status(404).json({ error: 'Pick one of the token’s sites.', code: 'not_found' });
    const collections = await listCollections(account, site.id);
    if (!collections.some((c) => c.id === collectionId)) {
      return res
        .status(404)
        .json({ error: 'Pick one of the site’s collections.', code: 'not_found' });
    }
    const collection = await getCollection(account, collectionId);
    const checked = checkFieldMap(fieldMap, collection.fields);
    if (!checked.ok) {
      return res.status(400).json({
        error: 'The fields don’t fit the collection.',
        code: 'invalid_map',
        problems: checked.problems,
      });
    }

    const { data: saved, error } = await supabaseAdmin
      .from('brand_cms_connections')
      .update({
        status: 'connected',
        site_id: site.id,
        site_name: site.name,
        collection_id: collectionId,
        collection_name: collection.name,
        field_map: checked.map,
        updated_at: new Date().toISOString(),
      })
      .eq('brand_id', id)
      .eq('provider', PROVIDER)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Disconnected while this was read.
    if (!saved) throw routeError('Connect Webflow first.', 409, 'not_connected');
    return res.json({ connection: shape(saved) });
  } catch (err) {
    return fail(req, res, err, 'cms webflow settings error', id);
  }
});

// DELETE — disconnect: the account at Composio, then the brand's row.
router.delete('/brands/:brandId/webflow', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertWriter(id, req.user.id);
    const row = await connectionOf(id);
    if (!row) return res.json({ success: true });
    if (isWebflowConfigured()) await forget(req, row.composio_account_id);
    const { error } = await supabaseAdmin
      .from('brand_cms_connections')
      .delete()
      .eq('brand_id', id)
      .eq('provider', PROVIDER);
    if (error) throw new Error(error.message);
    return res.json({ success: true });
  } catch (err) {
    return fail(req, res, err, 'cms webflow disconnect error');
  }
});

export default router;
