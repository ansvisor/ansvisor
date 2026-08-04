import { Router } from 'express';
import supabaseAdmin from '../config/supabase.js';
import {
  isComposioConfigured,
  initiateGscConnection,
  getActiveGscConnection,
  deleteGscConnection,
} from '../lib/composio.js';

const router = Router();

const PROVIDER = 'google-search-console';
const WRITE_ROLES = ['admin', 'manager'];

/** Entity id: one Search Console connection per organization (#577). */
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

async function upsertConnectionRow(organizationId, fields) {
  const { error } = await supabaseAdmin.from('integration_connections').upsert(
    {
      organization_id: organizationId,
      provider: PROVIDER,
      updated_at: new Date().toISOString(),
      ...fields,
    },
    { onConflict: 'organization_id,provider' },
  );
  if (error) throw new Error(`Failed to save connection: ${error.message}`);
}

/**
 * GET /api/integrations/google-search-console/status
 * Resolves the live state against Composio (not just our stored row) and
 * syncs the row so teammates see the same state.
 */
router.get('/google-search-console/status', async (req, res) => {
  try {
    if (!isComposioConfigured()) {
      return res.json({ configured: false, status: 'not_configured' });
    }

    const profile = await getProfile(req.user.id);
    const entityId = entityIdFor(profile.organization_id);

    const active = await getActiveGscConnection(entityId);
    if (active) {
      await upsertConnectionRow(profile.organization_id, {
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
      .eq('provider', PROVIDER)
      .maybeSingle();

    if (row?.status === 'connected') {
      await upsertConnectionRow(profile.organization_id, {
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
 * POST /api/integrations/google-search-console/connect
 * Body: { callbackUrl } — where Composio sends the browser after consent.
 * Returns { redirectUrl } for the client to open.
 */
router.post('/google-search-console/connect', async (req, res) => {
  try {
    if (!isComposioConfigured()) {
      return res.status(503).json({ error: 'Search Console integration is not configured.' });
    }

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
    const { redirectUrl, connectedAccountId } = await initiateGscConnection(entityId, callbackUrl);

    await upsertConnectionRow(profile.organization_id, {
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
 * DELETE /api/integrations/google-search-console
 * Removes the connected account on Composio and resets our row.
 */
router.delete('/google-search-console', async (req, res) => {
  try {
    if (!isComposioConfigured()) {
      return res.status(503).json({ error: 'Search Console integration is not configured.' });
    }

    const profile = await getProfile(req.user.id);
    if (!WRITE_ROLES.includes(profile.role)) {
      return res
        .status(403)
        .json({ error: 'Only admins and managers can disconnect integrations.' });
    }

    const entityId = entityIdFor(profile.organization_id);
    const active = await getActiveGscConnection(entityId);
    if (active) {
      await deleteGscConnection(active.id);
    }

    const { error } = await supabaseAdmin
      .from('integration_connections')
      .delete()
      .eq('organization_id', profile.organization_id)
      .eq('provider', PROVIDER);
    if (error) throw new Error(`Failed to clear connection: ${error.message}`);

    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, 'integrations disconnect error');
    return res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
