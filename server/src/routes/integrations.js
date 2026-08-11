import { Router } from 'express';
import supabaseAdmin from '../config/supabase.js';
import {
  PROVIDERS,
  isKnownProvider,
  isComposioConfigured,
  initiateConnection,
  getActiveConnection,
  deleteConnection,
  listGscSites,
  listGaProperties,
} from '../lib/composio.js';
import { runGscSync } from '../lib/gsc-sync.js';

const router = Router();

const GSC = 'google-search-console';
const GA = 'google-analytics';
const WRITE_ROLES = ['admin', 'manager'];

/** Entity id: one connection per organization per provider (#577). */
function entityIdFor(organizationId) {
  return `org_${organizationId}`;
}

async function getProfile(userId) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .single();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  if (!profile?.organization_id) {
    const err = new Error('No organization found for user.');
    err.status = 400;
    throw err;
  }
  return profile;
}

async function upsertConnectionRow(organizationId, provider, fields) {
  const { error } = await supabaseAdmin.from('integration_connections').upsert(
    {
      organization_id: organizationId,
      provider,
      updated_at: new Date().toISOString(),
      ...fields,
    },
    { onConflict: 'organization_id,provider' },
  );
  if (error) throw new Error(`Failed to save connection: ${error.message}`);
}

/**
 * Resolve `:provider` and reject anything unknown before it reaches Composio.
 * Keeps the URL space closed — only providers declared in PROVIDERS exist.
 */
function resolveProvider(req, res) {
  const { provider } = req.params;
  if (!isKnownProvider(provider)) {
    res.status(404).json({ error: 'Unknown integration provider.' });
    return null;
  }
  return provider;
}

function notConfigured(res, provider) {
  return res
    .status(503)
    .json({ error: `${PROVIDERS[provider].label} integration is not configured.` });
}

// ─── Shared connect / status / disconnect ────────────────────────────────────
// Identical for every OAuth provider; only the auth config differs, which
// lives in the PROVIDERS map.

/**
 * GET /api/integrations/:provider/status
 * Resolves the live state against Composio (not just our stored row) and
 * syncs the row so teammates see the same state.
 */
router.get('/:provider/status', async (req, res) => {
  try {
    const provider = resolveProvider(req, res);
    if (!provider) return;

    if (!isComposioConfigured(provider)) {
      return res.json({ configured: false, status: 'not_configured' });
    }

    const profile = await getProfile(req.user.id);
    const entityId = entityIdFor(profile.organization_id);

    const active = await getActiveConnection(provider, entityId);
    if (active) {
      await upsertConnectionRow(profile.organization_id, provider, {
        composio_account_id: active.id,
        composio_entity_id: entityId,
        status: 'connected',
      });
      return res.json({ configured: true, status: 'connected', accountId: active.id });
    }

    // No active account on Composio — reflect that in our row if it claims
    // otherwise (revoked from the Google side, expired, etc.).
    const { data: row } = await supabaseAdmin
      .from('integration_connections')
      .select('status')
      .eq('organization_id', profile.organization_id)
      .eq('provider', provider)
      .maybeSingle();

    if (row?.status === 'connected') {
      await upsertConnectionRow(profile.organization_id, provider, {
        composio_account_id: null,
        composio_entity_id: entityId,
        status: 'disconnected',
      });
    }

    return res.json({ configured: true, status: 'not_connected' });
  } catch (err) {
    req.log.error({ err }, 'integrations status error');
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/integrations/:provider/connect
 * Body: { callbackUrl } — where Composio sends the browser after consent.
 * Returns { redirectUrl } for the client to open.
 */
router.post('/:provider/connect', async (req, res) => {
  try {
    const provider = resolveProvider(req, res);
    if (!provider) return;

    if (!isComposioConfigured(provider)) return notConfigured(res, provider);

    const profile = await getProfile(req.user.id);
    if (!WRITE_ROLES.includes(profile.role)) {
      return res.status(403).json({ error: 'Only admins and managers can connect integrations.' });
    }

    const { callbackUrl } = req.body ?? {};
    if (typeof callbackUrl !== 'string' || !/^https?:\/\//.test(callbackUrl)) {
      return res.status(400).json({ error: 'callbackUrl is required' });
    }
    // Compare origins, not prefixes — PUBLIC_APP_URL may be misconfigured
    // with a path and must still validate correctly.
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

    const entityId = entityIdFor(profile.organization_id);
    const { redirectUrl, connectedAccountId } = await initiateConnection(
      provider,
      entityId,
      callbackUrl,
    );

    await upsertConnectionRow(profile.organization_id, provider, {
      composio_account_id: connectedAccountId,
      composio_entity_id: entityId,
      status: 'pending',
      connected_by: req.user.id,
    });

    return res.json({ redirectUrl });
  } catch (err) {
    req.log.error({ err }, 'integrations connect error');
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * DELETE /api/integrations/:provider
 * Removes the connected account on Composio and resets our row.
 */
router.delete('/:provider', async (req, res) => {
  try {
    const provider = resolveProvider(req, res);
    if (!provider) return;

    if (!isComposioConfigured(provider)) return notConfigured(res, provider);

    const profile = await getProfile(req.user.id);
    if (!WRITE_ROLES.includes(profile.role)) {
      return res
        .status(403)
        .json({ error: 'Only admins and managers can disconnect integrations.' });
    }

    const entityId = entityIdFor(profile.organization_id);
    const active = await getActiveConnection(provider, entityId);
    if (active) {
      await deleteConnection(active.id);
    }

    const { error } = await supabaseAdmin
      .from('integration_connections')
      .delete()
      .eq('organization_id', profile.organization_id)
      .eq('provider', provider);
    if (error) throw new Error(`Failed to clear connection: ${error.message}`);

    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, 'integrations disconnect error');
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── Provider specific ───────────────────────────────────────────────────────
// Property listing differs per provider (a GSC property is a URL, a GA4
// property is a numeric id), and the query-stats sync has no Analytics
// equivalent yet, so these stay on explicit paths rather than under :provider.

/**
 * GET /api/integrations/google-search-console/properties
 * Properties visible to the org's connected account (#642). Member-readable —
 * the mapping UI is shown to the whole org; writes stay role-gated elsewhere.
 */
router.get('/google-search-console/properties', async (req, res) => {
  try {
    if (!isComposioConfigured(GSC)) return notConfigured(res, GSC);

    const profile = await getProfile(req.user.id);
    const entityId = entityIdFor(profile.organization_id);

    const active = await getActiveConnection(GSC, entityId);
    if (!active) {
      return res.status(409).json({ error: 'Google Search Console is not connected.' });
    }

    const properties = await listGscSites(entityId);
    return res.json({ properties });
  } catch (err) {
    req.log.error({ err }, 'integrations properties error');
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/integrations/google-search-console/sync
 * Runs the query-stats sync for the caller's org immediately (#644) —
 * testing and first-time backfill; the daily cycle runs the same sync.
 */
router.post('/google-search-console/sync', async (req, res) => {
  try {
    if (!isComposioConfigured(GSC)) return notConfigured(res, GSC);

    const profile = await getProfile(req.user.id);
    if (!WRITE_ROLES.includes(profile.role)) {
      return res.status(403).json({ error: 'Only admins and managers can trigger a sync.' });
    }

    const result = await runGscSync({ organizationId: profile.organization_id });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, 'integrations sync error');
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /api/integrations/google-analytics/properties
 * GA4 properties visible to the org's connected account (#694). Member-
 * readable, like the Search Console listing above.
 */
router.get('/google-analytics/properties', async (req, res) => {
  try {
    if (!isComposioConfigured(GA)) return notConfigured(res, GA);

    const profile = await getProfile(req.user.id);
    const entityId = entityIdFor(profile.organization_id);

    const active = await getActiveConnection(GA, entityId);
    if (!active) {
      return res.status(409).json({ error: 'Google Analytics is not connected.' });
    }

    const properties = await listGaProperties(entityId);
    return res.json({ properties });
  } catch (err) {
    req.log.error({ err }, 'integrations GA properties error');
    return res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
