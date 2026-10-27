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
 *   - billing (/billing/…): choosing, or cancelling, a plan;
 *   - COST_STOPPING: stopping work under way, and taking back the access to
 *     an outside account (Google, a CMS, a bot log) the person gave us;
 *   - ONBOARDING_ROUTES, for an organization that never had a subscription:
 *     setup suggests the brand's topics, prompts and competitors before the
 *     plan step, and again when the person comes back from it.
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

/** Paths, under /api, that stay open whatever the plan. */
const OPEN_PATHS = ['/billing'];

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

/** Person id → until when their organization is taken as active. */
const activeUntil = new Map();

function matches(routes, { method, path }) {
  return routes.some((route) => route.method === method && route.path.test(path));
}

function isOpen(req) {
  return (
    OPEN_PATHS.some((open) => req.path === open || req.path.startsWith(`${open}/`)) ||
    matches(COST_STOPPING, req)
  );
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
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`profiles read: ${error.message}`);
  if (!profile) return 'inactive';
  // Onboarding creates the organization with the brand, before it asks for
  // anything here: without one, nothing was ever subscribed.
  if (!profile.organization_id) return 'never_subscribed';

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .select('subscription_status, stripe_subscription_id')
    .eq('id', profile.organization_id)
    .maybeSingle();
  if (orgError) throw new Error(`organizations read: ${orgError.message}`);
  if (!org) return 'inactive';
  if (isSubscriptionActive(org.subscription_status)) return 'active';
  return org.stripe_subscription_id ? 'inactive' : 'never_subscribed';
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
    const access = await subscriptionAccess(userId);
    if (access === 'active') {
      rememberActive(userId, now);
      return next();
    }
    if (access === 'never_subscribed' && matches(ONBOARDING_ROUTES, req)) return next();
    return res.status(402).json(SUBSCRIPTION_INACTIVE);
  } catch (err) {
    (req.log ?? logger).error({ err }, 'subscription check failed');
    return res.status(500).json({ message: 'Internal Error' });
  }
}

// Test hook — what passes depends on what is remembered.
export function clearSubscriptionCache() {
  activeUntil.clear();
}
