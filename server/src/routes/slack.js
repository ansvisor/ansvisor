import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import {
  connectedAccountStatus,
  deleteConnection,
  entityIdFor,
  initiateSlackConnection,
  isSlackConfigured,
} from '../lib/composio.js';
import {
  activateBrandAccount,
  removeBrandAccount,
  signInBrandIds,
  startBrandAccount,
  usableAccounts,
  useAccountForBrand,
} from '../lib/brand-integrations.js';
import {
  CHANNEL_ID,
  PROVIDER,
  SEND_KINDS,
  brandSlack,
  listChannels,
  markRefused,
  postConnectedMessage,
  readChannel,
  readWorkspaceLabel,
  saveSettings,
  saveWorkspaceLabel,
  settingsOf,
  stateOf,
} from '../lib/slack/connection.js';
import { CHANNEL_CODES, REFUSED_CODES, SlackError } from '../lib/slack/api.js';
import { assertBrandAccess, assertEveryBrand, brandAccessOf, brandReaders } from '../lib/access.js';
import { PlanLimitError, enforceFeature } from '../lib/plan-guard.js';
import { slackLimiter } from '../middleware/rate-limiter.js';

/**
 * A brand's Slack (#2139, N1): the workspace it posts to and its channel.
 * Everyone who can access the brand reads it; an admin or manager who can
 * access it connects a workspace (Slack's install of the Ansvisor app, in a
 * popup, through Composio), uses another brand's, picks the channel and what
 * goes to it, sends a test message and disconnects:
 *
 *   GET    /api/slack/brands/:brandId                       where it stands
 *   POST   /api/slack/brands/:brandId/connect { callbackUrl }   start an install
 *   POST   /api/slack/brands/:brandId/activate { accountId }    finish it
 *   POST   /api/slack/brands/:brandId/use { accountId }         another brand's workspace
 *   GET    /api/slack/brands/:brandId/channels               the workspace's channels
 *   PUT    /api/slack/brands/:brandId { channelId?, send? }   the channel, what to send
 *   POST   /api/slack/brands/:brandId/test                   a test message
 *   DELETE /api/slack/brands/:brandId                        disconnect
 *
 * Slack notifications are on every paid plan (slack_notifications): writes
 * but Disconnect need it. A workspace is posted to only while the person
 * who connected it can see the brand (owner, 2026-11-10). No token, entity or
 * Composio id leaves, and Slack's failures are logged by code only.
 */

const router = Router();

const WRITE_ROLES = ['admin', 'manager'];
const FEATURE = 'slack_notifications';

const brandParams = z.object({ brandId: z.guid() });
const accountBody = z.object({ accountId: z.guid() });
const callbackBody = z.object({ callbackUrl: z.string().max(2048) });
const settingsBody = z
  .object({
    channelId: z.string().regex(CHANNEL_ID).nullable().optional(),
    send: z.object(Object.fromEntries(SEND_KINDS.map((kind) => [kind, z.boolean()]))).partial(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0);

function routeError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

/** The brand, for someone who may read it. */
async function readableBrand(req) {
  const parsed = brandParams.safeParse(req.params);
  if (!parsed.success) throw routeError('Invalid brand', 400, 'invalid');
  const { brand, role } = await assertBrandAccess(parsed.data.brandId, req.user.id, {
    columns: 'name',
  });
  return { brand, role };
}

/**
 * The brand, for an admin or manager who can access it, to change its Slack.
 * The demo brand is everyone's sample data: it connects nothing.
 */
async function writableBrand(req) {
  const { brand, role } = await readableBrand(req);
  if (!WRITE_ROLES.includes(role)) {
    throw routeError('Only admins and managers can change Slack.', 403, 'forbidden');
  }
  if (brand.is_demo) throw routeError('The sample brand connects nothing.', 409, 'demo_brand');
  return brand;
}

/** The plan has Slack notifications (every paid plan, and self-host): else 402 or 403. */
async function assertPlan(userId) {
  try {
    await enforceFeature(userId, FEATURE);
  } catch (err) {
    if (err instanceof PlanLimitError) {
      throw routeError(err.message, err.statusCode, 'plan_limit');
    }
    throw err;
  }
}

/** Whether the plan has Slack notifications now, for the card. */
async function planAllows(userId) {
  try {
    await enforceFeature(userId, FEATURE);
    return true;
  } catch (err) {
    if (err instanceof PlanLimitError) return false;
    throw err;
  }
}

const notConfigured = () =>
  routeError('Slack is not set up on this server.', 503, 'not_configured');

/** The ids of the organization's brands the person can access. */
async function reachableBrandIds(userId, organizationId) {
  const access = await brandAccessOf(userId);
  if (!access.all) return [...access.brandIds];
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('organization_id', organizationId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => b.id);
}

/** People's names by id, for "connected by". */
async function namesOf(ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .in('id', wanted);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p) => [p.id, p.full_name?.trim() || null]));
}

/** The callback must be on the app's origin, where the popup came from. */
function checkCallback(callbackUrl) {
  if (!/^https?:\/\//.test(callbackUrl))
    throw routeError('callbackUrl is required', 400, 'invalid');
  const appUrl = process.env.PUBLIC_APP_URL;
  if (!appUrl) return;
  let same;
  try {
    same = new URL(callbackUrl).origin === new URL(appUrl).origin;
  } catch {
    throw routeError('callbackUrl is not a valid URL', 400, 'invalid');
  }
  if (!same) throw routeError('callbackUrl must be on the app origin', 400, 'invalid');
}

/**
 * The brand's Slack as its card reads it. `usable`: the other workspaces of
 * brands the person can access whose connector can see this brand too, for
 * "Use the same workspace as…". No Composio id, and brands the person can't
 * access aren't named.
 */
async function cardOf(brand, userId) {
  const [slack, brandIds, readers, allowed] = await Promise.all([
    brandSlack(brand.id),
    reachableBrandIds(userId, brand.organization_id),
    brandReaders(brand.organization_id, [brand.id]),
    planAllows(userId),
  ]);
  const reachable = new Set(brandIds);
  const usable = (await usableAccounts(brand.organization_id, PROVIDER, brandIds)).filter(
    (account) => account.accountId !== slack?.accountId && readers.has(account.connectedBy),
  );
  const sharedWith = slack
    ? ((await signInBrandIds({ accountId: slack.accountId })) ?? []).filter(
        (id) => id !== brand.id && reachable.has(id),
      )
    : [];
  const names = await namesOf([slack?.connectedBy]);
  const connected = slack?.status === 'connected' || slack?.status === 'auth_failed';
  return {
    configured: isSlackConfigured(),
    allowed,
    state: stateOf(slack, readers.has(slack?.connectedBy)),
    workspace:
      slack && connected
        ? {
            accountId: slack.accountId,
            label: slack.label,
            connectedBy: names.get(slack.connectedBy) ?? null,
            connectedAt: slack.connectedAt,
            sharedWith,
          }
        : null,
    channel: slack && connected ? slack.settings.channel : null,
    send: (slack?.settings ?? settingsOf(null)).send,
    usable: usable.map((account) => ({
      accountId: account.accountId,
      label: account.label,
      brandIds: account.brandIds,
    })),
  };
}

/** The brand's Slack, connected, to call Slack with: else 409 not_connected. */
async function connectedSlack(brand) {
  const slack = await brandSlack(brand.id);
  if (!slack || slack.status !== 'connected' || !slack.composioAccountId) {
    throw routeError('Connect Slack first.', 409, 'not_connected');
  }
  return slack;
}

/**
 * Answers a Slack failure by its code, and keeps the card true: a workspace
 * that refuses the connection is marked so; a channel that is gone is
 * cleared. Logged by code only.
 */
async function slackFailure(req, res, err, { brandId, slack }, what) {
  const { code } = err;
  req.log.warn({ code, status: err.status ?? null }, what);
  if (REFUSED_CODES.has(code)) {
    if (slack) await markRefused(slack.accountId).catch(() => {});
    return res
      .status(409)
      .json({ error: 'Slack no longer accepts this connection. Reconnect it.', code: 'refused' });
  }
  if (code === 'not_in_channel') {
    return res.status(409).json({
      error: 'The Ansvisor app is not in that channel. Invite it there first.',
      code: 'not_in_channel',
    });
  }
  if (CHANNEL_CODES.has(code)) {
    if (slack) await saveSettings(brandId, { ...slack.settings, channel: null }).catch(() => {});
    return res
      .status(409)
      .json({ error: 'That channel was archived or deleted.', code: 'channel_gone' });
  }
  if (code === 'ratelimited') {
    return res
      .status(429)
      .json({ error: 'Slack asked us to wait. Try again soon.', code: 'rate_limited' });
  }
  return res.status(502).json({ error: 'Slack could not be reached.', code: 'failed' });
}

function fail(req, res, err, what) {
  if (err?.status && err.status < 500 && !(err instanceof SlackError)) {
    return res.status(err.status).json({ error: err.message, code: err.code ?? 'forbidden' });
  }
  if (err?.status === 503 && err.code === 'not_configured') {
    return res.status(503).json({ error: err.message, code: err.code });
  }
  req.log.error({ err: { name: err?.name, code: err?.code ?? null } }, what);
  return res.status(500).json({ error: 'Something went wrong with Slack.', code: 'failed' });
}

// GET — where the brand's Slack stands, for every member who can access the brand.
router.get('/brands/:brandId', async (req, res) => {
  try {
    const { brand } = await readableBrand(req);
    return res.json(await cardOf(brand, req.user.id));
  } catch (err) {
    return fail(req, res, err, 'slack read error');
  }
});

// POST — start Slack's install of the app, as one more sign-in of the Account.
router.post('/brands/:brandId/connect', slackLimiter, async (req, res) => {
  try {
    const brand = await writableBrand(req);
    if (!isSlackConfigured()) throw notConfigured();
    await assertPlan(req.user.id);
    const body = callbackBody.safeParse(req.body ?? {});
    if (!body.success) throw routeError('callbackUrl is required', 400, 'invalid');
    checkCallback(body.data.callbackUrl);
    const started = await startBrandAccount(
      {
        brand,
        provider: PROVIDER,
        userId: req.user.id,
        entityId: entityIdFor(brand.organization_id),
      },
      {
        initiate: (entityId) => initiateSlackConnection(entityId, body.data.callbackUrl),
        deleteRemote: deleteConnection,
      },
    );
    return res.json(started);
  } catch (err) {
    return fail(req, res, err, 'slack connect error');
  }
});

// POST — the install is done once Composio says the account is active: the brand uses it.
router.post('/brands/:brandId/activate', slackLimiter, async (req, res) => {
  try {
    const brand = await writableBrand(req);
    if (!isSlackConfigured()) throw notConfigured();
    await assertPlan(req.user.id);
    const body = accountBody.safeParse(req.body ?? {});
    if (!body.success) throw routeError('Invalid request', 400, 'invalid');
    const status = await activateBrandAccount(
      { brand, provider: PROVIDER, accountId: body.data.accountId, userId: req.user.id },
      { status: connectedAccountStatus, deleteRemote: deleteConnection },
    );
    if (status === 'connected') {
      // The workspace's name, for the card: a failure leaves it unnamed.
      try {
        const slack = await brandSlack(brand.id);
        if (slack) await saveWorkspaceLabel(slack.accountId, await readWorkspaceLabel(slack));
      } catch (err) {
        req.log.warn({ code: err?.code ?? null }, 'slack workspace not named');
      }
    }
    return res.json({ status });
  } catch (err) {
    return fail(req, res, err, 'slack activate error');
  }
});

// POST — use the workspace another brand uses.
router.post('/brands/:brandId/use', slackLimiter, async (req, res) => {
  try {
    const brand = await writableBrand(req);
    await assertPlan(req.user.id);
    const body = accountBody.safeParse(req.body ?? {});
    if (!body.success) throw routeError('Invalid request', 400, 'invalid');
    // A workspace posts for every brand that uses it: the caller needs each of them.
    const ids = await signInBrandIds({ accountId: body.data.accountId });
    if (ids?.length) await assertEveryBrand(ids, req.user.id);
    // And whoever connected it must see this brand too, or nothing would be posted.
    const { data: account, error } = await supabaseAdmin
      .from('integration_accounts')
      .select('connected_by')
      .eq('id', body.data.accountId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const readers = await brandReaders(brand.organization_id, [brand.id]);
    if (!account || !readers.has(account.connected_by)) {
      throw routeError(
        'Whoever connected that workspace can’t see this brand.',
        409,
        'connector_no_access',
      );
    }
    await useAccountForBrand(
      {
        brand,
        provider: PROVIDER,
        accountId: body.data.accountId,
        brandIds: await reachableBrandIds(req.user.id, brand.organization_id),
      },
      { deleteRemote: deleteConnection },
    );
    return res.json(await cardOf(brand, req.user.id));
  } catch (err) {
    return fail(req, res, err, 'slack use error');
  }
});

// GET — the workspace's channels, for the picker.
router.get('/brands/:brandId/channels', slackLimiter, async (req, res) => {
  const target = {};
  try {
    const brand = await writableBrand(req);
    if (!isSlackConfigured()) throw notConfigured();
    Object.assign(target, { brandId: brand.id, slack: await connectedSlack(brand) });
    return res.json({ channels: await listChannels(target.slack) });
  } catch (err) {
    if (err instanceof SlackError)
      return slackFailure(req, res, err, target, 'slack channels error');
    return fail(req, res, err, 'slack channels error');
  }
});

// PUT — the brand's channel (checked with Slack) and what goes to it.
router.put('/brands/:brandId', slackLimiter, async (req, res) => {
  const target = {};
  try {
    const brand = await writableBrand(req);
    await assertPlan(req.user.id);
    const body = settingsBody.safeParse(req.body ?? {});
    if (!body.success) throw routeError('Invalid request', 400, 'invalid');
    const slack = await connectedSlack(brand);
    Object.assign(target, { brandId: brand.id, slack });
    const next = { ...slack.settings, send: { ...slack.settings.send, ...body.data.send } };
    if (body.data.channelId === null) next.channel = null;
    if (body.data.channelId) {
      if (!isSlackConfigured()) throw notConfigured();
      const channel = await readChannel(slack, body.data.channelId);
      if (channel.archived || !channel.name) {
        throw routeError('That channel was archived.', 409, 'channel_gone');
      }
      next.channel = { id: channel.id, name: channel.name, private: channel.private };
    }
    await saveSettings(brand.id, next);
    return res.json(await cardOf(brand, req.user.id));
  } catch (err) {
    if (err instanceof SlackError)
      return slackFailure(req, res, err, target, 'slack channel error');
    return fail(req, res, err, 'slack settings error');
  }
});

// POST — a test message to the brand's channel.
router.post('/brands/:brandId/test', slackLimiter, async (req, res) => {
  const target = {};
  try {
    const brand = await writableBrand(req);
    if (!isSlackConfigured()) throw notConfigured();
    await assertPlan(req.user.id);
    const slack = await connectedSlack(brand);
    Object.assign(target, { brandId: brand.id, slack });
    const readers = await brandReaders(brand.organization_id, [brand.id]);
    if (stateOf(slack, readers.has(slack.connectedBy)) !== 'connected') {
      throw routeError(
        'Whoever connected Slack can’t see this brand any more. Reconnect it.',
        409,
        'access_lost',
      );
    }
    if (!slack.settings.channel) throw routeError('Pick a channel first.', 409, 'no_channel');
    const names = await namesOf([req.user.id]);
    await postConnectedMessage(slack, {
      channelId: slack.settings.channel.id,
      brand: brand.name,
      by: names.get(req.user.id) ?? null,
    });
    return res.json({ sent: true, channel: slack.settings.channel });
  } catch (err) {
    if (err instanceof SlackError) return slackFailure(req, res, err, target, 'slack test error');
    return fail(req, res, err, 'slack test error');
  }
});

// DELETE — the brand stops posting to Slack; a workspace no brand uses any more goes.
router.delete('/brands/:brandId', async (req, res) => {
  try {
    const brand = await writableBrand(req);
    await removeBrandAccount({ brand, provider: PROVIDER }, { deleteRemote: deleteConnection });
    return res.json({ success: true });
  } catch (err) {
    return fail(req, res, err, 'slack disconnect error');
  }
});

export default router;
