import supabaseAdmin from '../config/supabase.js';
import { isCloud, isSubscriptionActive } from '../config/plans.js';
import logger from '../lib/logger.js';

/**
 * Read-only once the plan has ended (2026-10-27).
 *
 * On the cloud, an organization whose free trial ended or whose plan was
 * cancelled can still sign in and look around, but nothing it asks for may
 * change anything or start a cost: tracking, scraping, AI, agents, audits,
 * outside services, sends. So every signed-in request that writes — any
 * method but GET, HEAD and OPTIONS — is refused with 402 until a plan is
 * chosen, but for these, named route by route:
 *   - BILLING_ROUTES: telling us why a plan is cancelled;
 *   - COST_STOPPING: stopping work under way, and taking back the access to
 *     an outside account (Google, a CMS, a bot log, a store) the person gave us;
 *   - DATA_REMOVAL: deleting what the person gave us (a brand and its data);
 *   - ONBOARDING_ROUTES, for an organization that never had a subscription:
 *     setup suggests the brand's topics, prompts and competitors before the
 *     plan step, and again when the person comes back from it, up to
 *     ONBOARDING_DAILY_CALLS a day for the organization (429 past them).
 * A person's own profile and signing out are the web app's, through
 * Supabase; neither comes through this API. A request with no signed-in
 * person is refused too: decodeToken answers it first.
 *
 * Self-hosted, nothing is refused: billing doesn't apply.
 *
 * An active organization is remembered per person for ACTIVE_CACHE_MS, so a
 * busy session doesn't read it on every request; an inactive one never is,
 * so a plan chosen this minute works on the very next request.
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Billing's writes, under /api: open whatever the plan. The plan itself is
 * chosen and cancelled by the web app, through Stripe. Named route by route,
 * as the others are, so a billing route that costs is never let through by
 * its path alone.
 */
export const BILLING_ROUTES = [
  // Why a plan is cancelled, kept and e-mailed to the team (billing.js).
  { method: 'POST', path: /^\/billing\/cancel-feedback\/?$/ },
];

/**
 * Requests, under /api, that end a cost or an access, never start one: open
 * whatever the plan. Named route by route, so a new route is never let
 * through by its name alone.
 */
export const COST_STOPPING = [
  // Cancels a tracking job (tracking.js): no more scraping or answers to analyze.
  { method: 'DELETE', path: /^\/tracking\/job\/[^/]+\/?$/ },
  // Stops the Content Agent's run on a draft (content-drafts.js, CE-027).
  { method: 'POST', path: /^\/content-drafts\/[^/]+\/stop\/?$/ },
  // Disconnects Search Console or Analytics (integrations.js).
  { method: 'DELETE', path: /^\/integrations\/[^/]+\/?$/ },
  // Disconnects a brand's Webflow site (cms.js).
  { method: 'DELETE', path: /^\/cms\/brands\/[^/]+\/webflow\/?$/ },
  // Removes an AI-bot log connection (bots.js): its secret stops working.
  { method: 'DELETE', path: /^\/bots\/connections\/[^/]+\/[^/]+\/?$/ },
  // Removes a store from the catalog (catalog.js): its sign-in is revoked at
  // the store, then deleted with its products. Feeds and uploads go through RLS.
  { method: 'DELETE', path: /^\/catalog\/sources\/[^/]+\/?$/ },
];

/**
 * Requests, under /api, that only delete what the person gave us: open
 * whatever the plan, so leaving needs no purchase (Ansvisor, 2026-10-27).
 */
export const DATA_REMOVAL = [
  // Deletes a brand and all its data (brands.js); admins only, as before.
  { method: 'DELETE', path: /^\/brands\/[^/]+\/?$/ },
];

/**
 * The writes onboarding asks of this API (web/src/lib/ai-brand-setup.ts):
 * open to an organization that never had a subscription, so setup works
 * before the plan step. The brand, topics, prompts and competitors
 * themselves are saved by the web app, through Supabase.
 */
export const ONBOARDING_ROUTES = [
  // The brand's topics (topics.js).
  { method: 'POST', path: /^\/topics\/suggest\/?$/ },
  // Prompts for the chosen topics (prompts.js).
  { method: 'POST', path: /^\/prompts\/from-topics\/?$/ },
  // The brand's competitors, and whether it sells online (competitors.js).
  { method: 'POST', path: /^\/competitors\/suggest\/?$/ },
];

/**
 * Onboarding's calls an organization that never subscribed may make a day
 * (UTC), all three routes together: a setup asks each once, so this leaves
 * room for several setups and retries, and bounds what a workspace without a
 * plan can spend on AI. Counted in this process's memory.
 */
export const ONBOARDING_DAILY_CALLS = 20;

/** How long an active organization is taken as still active. */
export const ACTIVE_CACHE_MS = 30_000;
/** People remembered at most; the oldest goes first. */
export const MAX_ENTRIES = 5000;

/** The answer to a write once the plan has ended. */
export const SUBSCRIPTION_INACTIVE = {
  success: false,
  error: 'plan_limit',
  code: 'subscription_inactive',
  message: 'Your plan has ended. Choose a plan to use Ansvisor again.',
};

/** The answer to an onboarding call past the day's ONBOARDING_DAILY_CALLS. */
export const ONBOARDING_LIMIT_REACHED = {
  success: false,
  error: 'rate_limited',
  code: 'onboarding_daily_limit',
  message: 'Setup suggestions are used up for today. Try again tomorrow, or choose a plan.',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Person id → until when their organization is taken as active. */
const activeUntil = new Map();

/** `org:<id>` (`user:<id>` before the organization exists) → { day, calls } */
const onboardingCalls = new Map();

function matches(routes, { method, path }) {
  return routes.some((route) => route.method === method && route.path.test(path));
}

function isOpen(req) {
  return matches(BILLING_ROUTES, req) || matches(COST_STOPPING, req) || matches(DATA_REMOVAL, req);
}

/**
 * Counts one onboarding call for `key` today (UTC): false once the day's
 * ONBOARDING_DAILY_CALLS are used. A count from an earlier day starts over,
 * at the end of the map: the counts are kept in the order their day began,
 * so the oldest goes first when MAX_ENTRIES are kept.
 */
function takeOnboardingCall(key, now) {
  const day = Math.floor(now / DAY_MS);
  const kept = onboardingCalls.get(key);
  if (kept?.day === day) {
    if (kept.calls >= ONBOARDING_DAILY_CALLS) return false;
    kept.calls += 1;
    return true;
  }
  onboardingCalls.delete(key);
  if (onboardingCalls.size >= MAX_ENTRIES) {
    onboardingCalls.delete(onboardingCalls.keys().next().value);
  }
  onboardingCalls.set(key, { day, calls: 1 });
  return true;
}

function isCachedActive(userId, now) {
  const until = activeUntil.get(userId);
  if (until === undefined) return false;
  if (until <= now) {
    activeUntil.delete(userId);
    return false;
  }
  return true;
}

function rememberActive(userId, now) {
  // Only a new person makes room: two requests of one person at once both
  // remember them.
  if (!activeUntil.has(userId) && activeUntil.size >= MAX_ENTRIES) {
    activeUntil.delete(activeUntil.keys().next().value);
  }
  activeUntil.set(userId, now + ACTIVE_CACHE_MS);
}

/**
 * Where a person's organization stands: 'active' (an active or trialing
 * subscription), 'never_subscribed' (no subscription yet: setting up, or
 * back from the plan step) or 'inactive' (its subscription ended, or no
 * profile to tell by).
 *
 * Never having had a subscription is the organization's Stripe subscription
 * id, which only the server writes, not the profile's onboarding flag, which
 * the person can set back themselves.
 *
 * @param {string} userId
 * @returns {Promise<'active' | 'never_subscribed' | 'inactive'>}
 */
export async function subscriptionAccess(userId) {
  return (await readAccess(userId)).access;
}

/** subscriptionAccess, with the organization it read (null without one). */
async function readAccess(userId) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`profiles read: ${error.message}`);
  if (!profile) return { access: 'inactive', orgId: null };
  // Onboarding creates the organization with the brand, before it asks for
  // anything here: without one, nothing was ever subscribed.
  const orgId = profile.organization_id;
  if (!orgId) return { access: 'never_subscribed', orgId: null };

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .select('subscription_status, stripe_subscription_id')
    .eq('id', orgId)
    .maybeSingle();
  if (orgError) throw new Error(`organizations read: ${orgError.message}`);
  if (!org) return { access: 'inactive', orgId };
  if (isSubscriptionActive(org.subscription_status)) return { access: 'active', orgId };
  return { access: org.stripe_subscription_id ? 'inactive' : 'never_subscribed', orgId };
}

/**
 * Express middleware: refuses a signed-in person's writes while their
 * organization has no active subscription. Runs after decodeToken.
 */
export async function requireActiveSubscription(req, res, next) {
  if (!isCloud() || READ_METHODS.has(req.method) || isOpen(req)) return next();
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized API Request' });

  const now = Date.now();
  if (isCachedActive(userId, now)) return next();
  try {
    const { access, orgId } = await readAccess(userId);
    if (access === 'active') {
      rememberActive(userId, now);
      return next();
    }
    if (access === 'never_subscribed' && matches(ONBOARDING_ROUTES, req)) {
      if (takeOnboardingCall(orgId ? `org:${orgId}` : `user:${userId}`, now)) return next();
      const tomorrow = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
      res.set('Retry-After', String(Math.ceil((tomorrow - now) / 1000)));
      return res.status(429).json(ONBOARDING_LIMIT_REACHED);
    }
    return res.status(402).json(SUBSCRIPTION_INACTIVE);
  } catch (err) {
    (req.log ?? logger).error({ err }, 'subscription check failed');
    return res.status(500).json({ message: 'Internal Error' });
  }
}

// Test hook — what passes depends on what is remembered and counted.
export function clearSubscriptionCache() {
  activeUntil.clear();
  onboardingCalls.clear();
}
