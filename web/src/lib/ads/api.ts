import { BROWSER_API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/client';
import type { AdsPeriod } from './tabs';

/**
 * Ads' reads and writes on the API server (server/src/routes/ads.js), with
 * the person's session as a bearer token, through the same-origin proxy, as
 * the AI usage meter reads (lib/billing/ai-usage-client.ts): never a server
 * action, which Next runs one at a time behind the page's others.
 */

/** A read that hangs gives up after this, so the page can say so. */
const READ_TIMEOUT_MS = 30_000;

/** The JSON answer to a call to /api/ads/…; anything but a 2xx throws. */
async function call<T>(path: string, init?: { method: 'PATCH'; body: unknown }): Promise<T> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(`${BROWSER_API_BASE_URL}/api/ads/${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(init && { 'Content-Type': 'application/json' }),
    },
    body: init && JSON.stringify(init.body),
    cache: 'no-store',
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Ads ${path.split('?')[0]}: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The Overview (GET /api/ads/overview, server lib/ads/overview.js), over
 * every buying-intent prompt, for every plan. Null is "not measured", never 0.
 */
export interface AdsOverview {
  period: AdsPeriod;
  /** Buying-intent prompts: the bar's parts add up to it. */
  total: number;
  /** Prompts whose intent isn't analysed yet, so not counted either way. */
  notAnalysed: number;
  /** Opportunities' rows past the plan's (Starter, the trial), from the server. */
  locked: number;
  /** Our sponsored ads are measured: until then the paid parts are null. */
  paidMeasured: boolean;
  bar: {
    earned: number;
    earnedPaid: number | null;
    paidOnly: number | null;
    neither: number;
  };
  paidSov: number | null;
  /** The period's AI-assisted signups; null with conversions off or unread. */
  signups: number | null;
}

export function readAdsOverview(brandId: string, period: AdsPeriod): Promise<AdsOverview> {
  return call(`overview?${new URLSearchParams({ brandId, period })}`);
}

export type AdsDecision = 'earn' | 'pay' | 'earn_pay' | 'overlap';
/** A decision a person can set (overlap is only ever the rule's). */
export type AdsChosenDecision = Exclude<AdsDecision, 'overlap'>;
export type AdsChannel = 'chatgpt' | 'google' | 'microsoft';

/** One buying-intent prompt's row (server lib/ads/opportunities.js). */
export interface AdsOpportunity {
  promptId: string;
  text: string;
  topic: { id: string; name: string | null } | null;
  /** In force: a person's, else the rule's (`recommended`). */
  decision: AdsDecision;
  recommended: AdsDecision;
  override: { decision: AdsChosenDecision; setBy: string; setAt: string } | null;
  /** Who AI picks first: 'us', a competitor's id, or 'none'. */
  leader: string;
  leaderName: string | null;
  /** Where AI names us when a competitor is level or ahead; null elsewhere. */
  ourPosition: number | null;
  weNamed: boolean;
  weCited: boolean;
  /** Google searches a month (total_google_volume); null when not measured. */
  volume: number | null;
  /** AI prompts a month, estimated from it (est_ai_volume). */
  estAiVolume: number | null;
  /** Where ads can show beside the prompt's answers. */
  adChannels: AdsChannel[];
  paidMeasured: boolean;
  /** Why the rule decided `recommended` (server lib/ads/decision.js). */
  reasons: AdsReason[];
}

export interface AdsReason {
  code: string;
  [key: string]: unknown;
}

/** Opportunities (GET /api/ads/opportunities): Starter's rows end where `locked` starts. */
export interface AdsOpportunities {
  period: AdsPeriod;
  rows: AdsOpportunity[];
  total: number;
  /** Rows past the plan's (Starter, the trial), decided on the server. */
  locked: number;
  notAnalysed: number;
}

export function readAdsOpportunities(brandId: string, period: AdsPeriod) {
  return call<AdsOpportunities>(`opportunities?${new URLSearchParams({ brandId, period })}`);
}

/** One platform's latest answer in the period (server lib/ads/opportunity.js). */
export interface AdsAnswer {
  platform: string;
  region: string | null;
  at: string;
  /** Plain text cut from the answer: data, never markup. */
  excerpt: string;
  /** Where the answer names us, 1 = first; null when it doesn't. */
  mentionPosition: number | null;
  competitors: { name: string; position: number | null }[];
  /** The domains it cites most. */
  domains: string[];
}

/** An opportunity's drawer (GET /api/ads/opportunities/:promptId). */
export interface AdsOpportunityDetail {
  promptId: string;
  answers: AdsAnswer[];
  fanOuts: { query: string; platform: string }[];
  /** The prompt's keyword seeds (prompt_volumes.keywords). */
  keywords: string[];
}

export function readAdsOpportunity(brandId: string, promptId: string, period: AdsPeriod) {
  return call<AdsOpportunityDetail>(
    `opportunities/${encodeURIComponent(promptId)}?${new URLSearchParams({ brandId, period })}`,
  );
}

/** A person's decision for a prompt (Admin, Manager), or null back to the rule's. */
export function setAdsDecision(
  brandId: string,
  promptId: string,
  decision: AdsChosenDecision | null,
) {
  return call<{ promptId: string; override: AdsOpportunity['override'] }>(
    `opportunities/${encodeURIComponent(promptId)}/decision`,
    { method: 'PATCH', body: { brandId, decision } },
  );
}

/** The earn-or-pay thresholds (server config/ads.js). */
export interface AdsThresholds {
  minIntentWeight: number;
  leadPosition: number;
  minPaidVolume: number;
}
/** The workspace's own (`saved`), what applies, and the defaults (Admins). */
export interface AdsSettings {
  saved: Partial<AdsThresholds>;
  thresholds: AdsThresholds;
  defaults: AdsThresholds;
}

export function readAdsSettings() {
  return call<AdsSettings>('settings');
}

/** Each threshold given, or null back to its default (Admins). */
export function saveAdsSettings(thresholds: { [K in keyof AdsThresholds]?: number | null }) {
  return call<AdsSettings>('settings', { method: 'PATCH', body: { thresholds } });
}
