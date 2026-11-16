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
/** An export reads each prompt it holds first: past the proxy's 60s, whose 504 comes first. */
const EXPORT_TIMEOUT_MS = 90_000;

/** A call to /api/ads/… answered with anything but a 2xx: its status and the body's code. */
export class AdsApiError extends Error {
  status: number;
  /** The answer's `code` (facts_needed, gate_failed, ai_budget, …); null without one. */
  code: string | null;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.name = 'AdsApiError';
    this.status = status;
    this.code = typeof body.code === 'string' ? body.code : null;
    this.body = body;
  }
}

/** The JSON answer to a call to /api/ads/…; anything but a 2xx throws an AdsApiError. */
async function call<T>(
  path: string,
  init?: { method: 'PATCH' | 'POST'; body: unknown },
  timeout = READ_TIMEOUT_MS,
): Promise<T> {
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
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    throw new AdsApiError(
      `Ads ${path.split('?')[0]}: ${res.status}`,
      res.status,
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {},
    );
  }
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
/** A row that moved since the last week compared, by the rule's decision. */
export interface AdsWeekChange {
  promptId: string;
  text: string;
  decision: AdsDecision;
}

/** What moved in the rows shown since the last week compared (server lib/ads/week-changes.js). */
export interface AdsSinceLastWeek {
  /** The ISO week compared with, as 2026-W46. */
  since: string;
  newPrompts: AdsWeekChange[];
  moved: (AdsWeekChange & { from: AdsDecision })[];
  rivalPays: (AdsWeekChange & { rule: string | null })[];
}

export interface AdsOpportunities {
  period: AdsPeriod;
  rows: AdsOpportunity[];
  total: number;
  /** Rows past the plan's (Starter, the trial), decided on the server. */
  locked: number;
  notAnalysed: number;
  /** At 30 days; null with no earlier week, or another period. */
  sinceLastWeek?: AdsSinceLastWeek | null;
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
  /** The Earn card's: the prompt's target page, and the active action covering it. */
  earn: { page: string | null; action: AdsActionRef | null };
  /** The Pay card's: the prompt's latest saved draft of each channel, ChatGPT first. */
  drafts: AdsAdDraft[];
  /** The approved brand facts those drafts rest on (words and source page), for the brief. */
  facts: { id: string; quote: string; sourceUrl: string }[];
}

/** A saved ad draft (server lib/ads/draft-rows.js), past the claims gate: the model's words. */
export interface AdsAdDraft {
  id: string;
  channel: AdsChannel;
  headlines: string[];
  descriptions: string[];
  /** ChatGPT's: when the ad fits the conversation. */
  contextHint: string | null;
  /** `limits` stays 'unconfirmed' until each channel's are confirmed (config/ad-limits.js). */
  gate: { limits?: 'confirmed' | 'unconfirmed' };
}

/**
 * An Action Center action, as AC-{no} names it: its old global number, and
 * its number in its brand once the brand is numbered (00534), which its code
 * shows (actionCodeNo).
 */
export interface AdsActionRef {
  id: string;
  no: number;
  brandNo?: number | null;
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

/**
 * The Earn card's fix sent to the Action Center (Admin, Manager): the action
 * made (`created`; the same key again answers it), or the active one that
 * already covers the prompt (`covered`).
 */
export function sendAdsEarn(brandId: string, promptId: string, idempotencyKey: string) {
  return call<{ action: AdsActionRef; created: boolean; covered: boolean }>(
    `opportunities/${encodeURIComponent(promptId)}/earn`,
    { method: 'POST', body: { brandId, idempotencyKey } },
  );
}

/**
 * The Pay card's ad drafts written and saved (Admin, Manager): those that
 * pass the claims gate; the same key again answers them. Refused with 409
 * facts_needed (`why`: 'none' approved, or 'off' here), 422 gate_failed or
 * 429 ai_budget.
 */
export function createAdsDrafts(brandId: string, promptId: string, idempotencyKey: string) {
  return call<{ promptId: string; created: boolean; drafts: AdsAdDraft[] }>(
    `opportunities/${encodeURIComponent(promptId)}/drafts`,
    { method: 'POST', body: { brandId, idempotencyKey } },
  );
}

/**
 * A Google Ads Editor CSV (server lib/ads/export.js), as JSON: the proxy
 * passes on no Content-Disposition. `droppedUrls`: final URLs off the
 * brand's domains, replaced with its home page.
 */
export interface AdsExportFile {
  fileName: string;
  csv: string;
  rowCount: number;
  prompts: number;
  droppedUrls: number;
}

/** Opportunities' filters: every row, or a decision's. */
export type AdsFilter = 'all' | AdsChosenDecision;

/** The rows under a filter, for Google Ads Editor (Admin, Manager; Growth and up; not the demo brand). */
export function exportAdsEditor(brandId: string, decision: AdsFilter, period: AdsPeriod) {
  const query = new URLSearchParams({ brandId, decision, period });
  return call<AdsExportFile>(`export/editor?${query}`, undefined, EXPORT_TIMEOUT_MS);
}

/** One prompt, for Google Ads Editor, as above. */
export function exportAdsOpportunity(brandId: string, promptId: string, period: AdsPeriod) {
  const path = `export/opportunity/${encodeURIComponent(promptId)}`;
  const query = new URLSearchParams({ brandId, period });
  return call<AdsExportFile>(`${path}?${query}`, undefined, EXPORT_TIMEOUT_MS);
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

/** The ad platforms that come later (ADS-01 §3.5), each with Notify me. */
export type AdsLaterPlatform = 'meta' | 'linkedin';

/** Notify me (`conn.notify`): logged once per person and platform; again, `logged` is false. */
export function notifyAdsPlatform(brandId: string, platform: AdsLaterPlatform) {
  return call<{ platform: AdsLaterPlatform; logged: boolean }>('connections/notify', {
    method: 'POST',
    body: { brandId, platform },
  });
}

/** Google Analytics as Chat's Connections has it. */
export interface AdsAnalytics {
  status: 'connected' | 'failing' | 'not_connected';
}

/** Read by the web (app/api/ads/connections), from its one read of a brand's connections. */
export async function readAdsAnalytics(brandId: string): Promise<AdsAnalytics> {
  const res = await fetch(`/api/ads/connections?${new URLSearchParams({ brandId })}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!res.ok) throw new AdsApiError(`Ads connections: ${res.status}`, res.status, {});
  return ((await res.json()) as { analytics: AdsAnalytics }).analytics;
}
