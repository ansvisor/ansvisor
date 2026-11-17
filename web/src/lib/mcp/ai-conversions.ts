import {
  getTrafficAiPipeline,
  getTrafficConversions,
  getTrafficLogs,
  type TrafficConversions,
} from '@/lib/actions/traffic';
import { expandDateToEndOfDay } from '@/lib/dates';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { platformName } from '@/lib/signals/names';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  CONVERSIONS_FALLBACK_DAYS,
  PROMPT_ASSOCIATION_LABEL,
  conversionRate,
} from '@/lib/traffic-conversions';
import { getPlatformName, isNamedPlatform } from '@/lib/traffic-platforms';
import { asService } from './chat-facts';
import { brandAllowed } from './data';
import { lastReportedDay, sourcesOf } from './google-reads';
import { pageMeta, pageOfList, pageWindow } from './list-page';
import {
  GA_STEP,
  conversionsOffStep,
  hubspotStateOf,
  hubspotStep,
  lastConversionAt,
} from './tracking-setup';

/**
 * Chat's reads of who and what bring customers from AI visits (the owner's
 * question, 2026-11-16): conversions from AI visits as the tracking
 * snippet records them (ai_traffic_events, 00286), and AI Traffic's
 * "Where AI visitors convert", AI-sourced pipeline and visit log through the
 * page's own reads (lib/actions/traffic.ts, with the service role once the
 * brand is the person's), so Chat's numbers are the page's for the same
 * period. Plus prompts whose answers cite the pages that converted: an
 * association, never measured attribution. A source that isn't set up says
 * so, with the step that sets it up (tracking-setup.ts), and no number.
 * Values are per currency and never added across currencies. Null for a
 * brand outside the person's scope.
 */

type Window = { dateFrom?: string; dateTo?: string };
type Paged = Window & { brandId: string; limit?: number; offset?: number };

/** A period's bounds as the reads compare them: the end day is whole; no end is now. */
function boundsOf(window: Window) {
  return {
    from: window.dateFrom ?? null,
    to: expandDateToEndOfDay(window.dateTo) ?? new Date().toISOString(),
  };
}

/** The UTC day `days` before today, as the page's 30-day fallback starts. */
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** An AI assistant by its name; a source no list names is "Other". */
const assistantOf = (source: string | null) =>
  source && isNamedPlatform(source) ? getPlatformName(source) : 'Other';

/** A page's path, from a full address or a path. */
function pathOf(page: string): string {
  try {
    return new URL(page).pathname;
  } catch {
    return page;
  }
}

/** A page's key as the snippet and the functions keep it: lower(normalize_page_path(url)). */
export function pageKeyOf(url: string): string {
  const path = url
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, '')
    .split('?')[0]
    .split('#')[0];
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A broken escape stays as it is, as url_decode_safe keeps it.
  }
  return (decoded.replace(/\/+$/, '') || '/').toLowerCase();
}

// ─── Conversions from AI visits (the snippet's) ─────────────────────────────

/** A conversion as the snippet stores it (00286). */
export interface ConversionEvent {
  goal: string;
  value: number | string | null;
  currency: string | null;
  units: number | null;
  label: string | null;
  first_source: string;
  first_key: string;
}

/** An amount in each currency, the most first: never one figure across currencies. */
export type PerCurrency = { currency: string; value: number }[];

/** Revenue adds up orders' and bookings' values per currency, as the Content Editor does. */
const REVENUE_GOALS = new Set(['order', 'booking']);

interface Tally {
  conversions: number;
  byType: Record<string, number>;
  revenue: Map<string, number>;
}

const newTally = (): Tally => ({ conversions: 0, byType: {}, revenue: new Map() });

/** An order's or booking's value with its currency; null for one without either. */
function revenueOf(event: ConversionEvent): number | null {
  if (!REVENUE_GOALS.has(event.goal) || event.value === null || !event.currency) return null;
  const value = Number(event.value);
  return Number.isFinite(value) ? value : null;
}

function add(tally: Tally, event: ConversionEvent) {
  tally.conversions += 1;
  tally.byType[event.goal] = (tally.byType[event.goal] ?? 0) + 1;
  const value = revenueOf(event);
  if (value !== null) {
    tally.revenue.set(event.currency!, (tally.revenue.get(event.currency!) ?? 0) + value);
  }
}

const perCurrency = (sums: Map<string, number>): PerCurrency =>
  [...sums]
    .map(([currency, value]) => ({ currency, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value || a.currency.localeCompare(b.currency));

const rowOf = (tally: Tally) => ({
  conversions: tally.conversions,
  by_type: tally.byType,
  revenue: perCurrency(tally.revenue),
});

const byConversions = <T extends { conversions: number }>(
  rows: T[],
  name: (row: T) => string,
): T[] => rows.sort((a, b) => b.conversions - a.conversions || name(a).localeCompare(name(b)));

/**
 * A period's conversions, every way the question asks: by type (its units
 * and value), revenue per currency, by the assistant that first sent the
 * visitor, by the page that visit landed on, and by the site's own labels.
 * Pure.
 */
export function tallyConversions(events: readonly ConversionEvent[]) {
  const all = newTally();
  const types = new Map<
    string,
    { conversions: number; units: number; revenue: Map<string, number> }
  >();
  const assistants = new Map<string, Tally>();
  const pages = new Map<string, Tally & { from: Map<string, number> }>();
  const labels = new Map<string, { type: string; label: string; conversions: number }>();
  let unvalued = 0;
  for (const event of events) {
    add(all, event);
    const type = types.get(event.goal) ?? { conversions: 0, units: 0, revenue: new Map() };
    type.conversions += 1;
    type.units += event.goal === 'order' ? Number(event.units) || 0 : 0;
    const value = revenueOf(event);
    if (value !== null) {
      type.revenue.set(event.currency!, (type.revenue.get(event.currency!) ?? 0) + value);
    } else if (REVENUE_GOALS.has(event.goal)) {
      unvalued += 1;
    }
    types.set(event.goal, type);
    const assistant = assistantOf(event.first_source);
    const byAssistant = assistants.get(assistant) ?? newTally();
    add(byAssistant, event);
    assistants.set(assistant, byAssistant);
    const page = pages.get(event.first_key) ?? { ...newTally(), from: new Map() };
    add(page, event);
    page.from.set(assistant, (page.from.get(assistant) ?? 0) + 1);
    pages.set(event.first_key, page);
    if (event.label) {
      const key = `${event.goal}|${event.label}`;
      const row = labels.get(key) ?? { type: event.goal, label: event.label, conversions: 0 };
      row.conversions += 1;
      labels.set(key, row);
    }
  }
  return {
    conversions: all.conversions,
    by_type: byConversions(
      [...types].map(([type, t]) => ({
        type,
        conversions: t.conversions,
        ...(type === 'order' ? { units: t.units } : {}),
        ...(REVENUE_GOALS.has(type) ? { value: perCurrency(t.revenue) } : {}),
      })),
      (row) => row.type,
    ),
    revenue: perCurrency(all.revenue),
    orders_without_value: unvalued,
    // Named assistants first, Other last, as the Live page tab lists them.
    by_assistant: byConversions(
      [...assistants].map(([assistant, t]) => ({ assistant, ...rowOf(t) })),
      (row) => row.assistant,
    ).sort((a, b) => Number(a.assistant === 'Other') - Number(b.assistant === 'Other')),
    labels: byConversions([...labels.values()], (row) => row.label),
    landing_pages: byConversions(
      [...pages].map(([page, t]) => ({
        page,
        ...rowOf(t),
        top_assistant: [...t.from].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      })),
      (row) => row.page,
    ),
  };
}

const EVENT_PAGE = 1000;
/** The most conversions one read adds up: a bigger period says it was cut (`capped`). */
const EVENT_MAX = 50_000;

/** The brand's conversions in a period, newest first, read by its brand and organization. */
async function readConversions(brandId: string, organizationId: string, window: Window) {
  const { from, to } = boundsOf(window);
  const events: ConversionEvent[] = [];
  for (let start = 0; start < EVENT_MAX; start += EVENT_PAGE) {
    let query = supabaseAdmin
      .from('ai_traffic_events')
      .select(
        'goal, value, currency, units, label, first_source, first_key, brands!inner(organization_id)',
      )
      .eq('brand_id', brandId)
      .eq('brands.organization_id', organizationId)
      .eq('kind', 'conversion')
      .lte('occurred_at', to);
    if (from) query = query.gte('occurred_at', from);
    const { data, error } = await query
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + EVENT_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as ConversionEvent[];
    events.push(...rows);
    if (rows.length < EVENT_PAGE) return { events, capped: false };
  }
  return { events, capped: true };
}

async function conversionsSetting(brandId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('conversions_enabled, conversions_consent')
    .eq('id', brandId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    enabled: data?.conversions_enabled === true,
    consent: data?.conversions_consent === 'always' ? 'always' : 'wait',
  };
}

const ATTRIBUTION =
  'From the tracking snippet with conversions on: each conversion is credited to the AI assistant that first sent the visitor and to the page that visit landed on (first touch, within 30 days). by_type counts each goal (signup, demo, order, booking, newsletter, custom); revenue is orders and bookings, per currency.';

const CONVERSIONS_OFF =
  'Not measured: conversions from AI visits are off for this brand, so no sign-up, form or order is linked to an AI visit.';

export async function getAiConversionsFor(auth: McpAuthContext, params: Paged) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const org = auth.organizationId!;
  const [setting, read, last] = await Promise.all([
    conversionsSetting(params.brandId, org),
    readConversions(params.brandId, org, params),
    lastConversionAt(params.brandId, org),
  ]);
  const period = boundsOf(params);
  if (!setting.enabled && read.events.length === 0) {
    return {
      measured: false,
      enabled: false,
      period,
      not_measured: CONVERSIONS_OFF,
      ...conversionsOffStep(params.brandId),
    };
  }
  const { landing_pages, ...tally } = tallyConversions(read.events);
  const { rows, ...page } = pageOfList(landing_pages, params, {
    what: 'landing pages with a conversion',
    order: 'most conversions first',
  });
  return {
    measured: true,
    enabled: setting.enabled,
    consent: setting.consent,
    period,
    attribution: ATTRIBUTION,
    ...(setting.enabled
      ? {}
      : {
          note: 'Conversions are off now: these are what was counted while they were on.',
          ...conversionsOffStep(params.brandId),
        }),
    ...tally,
    last_conversion_at: last,
    ...(read.capped
      ? { capped: `Only the newest ${EVENT_MAX} conversions of the period were added up.` }
      : {}),
    ...page,
    landing_pages: rows,
  };
}

// ─── Where AI visitors convert (Google Analytics, AI Traffic's section) ─────

const GA_OFF =
  "Not measured: Google Analytics isn't connected for this brand, so key events and revenue from AI sessions aren't read.";
/** "Which answers bring buyers": the page's card shows ten. */
const BUYER_ANSWERS_SHOWN = 10;

/** A row's rate as the page shows it: a percent from 30 AI visits, else why there is none. */
function rateOf(row: { aiVisits: number; keyEvents: number; keyEventSessions: number }) {
  const rate = conversionRate(row);
  if (rate.kind === 'rate') return { rate_pct: rate.pct };
  return {
    rate_pct: null,
    rate_note: rate.kind === 'low' ? 'Low sample: fewer than 30 AI visits' : 'Not reported yet',
  };
}

/** The page's read, as many pages as this page of Chat's ends at, with the service role. */
const conversionsRead = (brandId: string, window: Window, limit: number) =>
  asService(() =>
    getTrafficConversions(brandId, { dateFrom: window.dateFrom, dateTo: window.dateTo }, { limit }),
  );

export async function getAiConvertingPagesFor(auth: McpAuthContext, params: Paged) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  if (!(await sourcesOf(params.brandId)).ga) {
    return { measured: false, connected: false, not_measured: GA_OFF, ...GA_STEP };
  }
  const { limit, offset } = pageWindow(params);
  const [result, asOf] = await Promise.all([
    conversionsRead(params.brandId, params, offset + limit),
    lastReportedDay('ga_ai_traffic_stats', params.brandId),
  ]);
  const money = result.hasRevenue;
  const pages = result.pages.slice(offset, offset + limit).map((row) => ({
    page: row.page,
    ai_visits: row.aiVisits,
    key_events: row.keyEvents,
    ...(money ? { revenue: Math.round(row.revenue) } : {}),
    ...rateOf(row),
    best_assistant: row.bestPlatform ? getPlatformName(row.bestPlatform) : null,
  }));
  return {
    measured: true,
    connected: true,
    period: result.widened
      ? boundsOf({ dateFrom: daysAgo(CONVERSIONS_FALLBACK_DAYS) })
      : boundsOf(params),
    ...(result.widened
      ? {
          widened: `The period had fewer than 30 AI visits, so this reads the last ${CONVERSIONS_FALLBACK_DAYS} days, as the page does.`,
        }
      : {}),
    ranked_by: money ? 'revenue from AI visits' : 'key events from AI visits',
    ai_visits: result.aiVisits,
    ...(money
      ? {
          revenue_currency:
            "The Google Analytics property's own currency, which Ansvisor isn't told.",
        }
      : {}),
    rate_rule:
      'Rate: the share of AI sessions with a key event, as Google Analytics counts them, shown from 30 AI visits.',
    ...pageMeta(
      {
        what: 'converting landing pages',
        order: money ? 'most revenue first' : 'most key events first',
      },
      result.pageCount,
      offset,
      pages.length,
    ),
    pages,
    ...(offset === 0 ? buyerAnswers(result, money) : {}),
    data_as_of: asOf,
    source_lag: '1 day',
  };
}

/** The page's "Which answers bring buyers" card: platform and topic. */
function buyerAnswers(result: TrafficConversions, money: boolean) {
  return {
    buyer_answers_note:
      'Topics of the tracked prompts whose answers cite the converting pages, by the assistant the visitors came from: an association, not which prompt brought a buyer.',
    buyer_answers_total: result.answerCount,
    buyer_answers: result.answers.slice(0, BUYER_ANSWERS_SHOWN).map((row) => ({
      assistant: getPlatformName(row.platform),
      topic: row.topic,
      pages: row.pages,
      key_events: row.keyEvents,
      ...(money ? { revenue: Math.round(row.revenue) } : {}),
      ...rateOf(row),
    })),
  };
}

// ─── AI-sourced pipeline (HubSpot, AI Traffic's section) ────────────────────

export async function getAiPipelineFor(auth: McpAuthContext, params: Window & { brandId: string }) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const window = { dateFrom: params.dateFrom, dateTo: params.dateTo };
  const result = await asService(() => getTrafficAiPipeline(params.brandId, window));
  if (!result) return null;
  const state = hubspotStateOf(result);
  if (state !== 'connected') {
    return {
      measured: false,
      connected: result.connected,
      state,
      not_measured: "Not measured: HubSpot's AI-sourced pipeline isn't set up for this brand.",
      ...hubspotStep(state),
    };
  }
  return {
    measured: true,
    connected: true,
    state,
    period: boundsOf(params),
    currency: result.currency,
    amounts:
      "In the HubSpot account's currency. A deal counts once, in full, credited to its earliest AI contact; won revenue by close date, open pipeline now, unweighted.",
    synced_at: result.syncedAt,
    ...(result.syncError
      ? { sync_failed: "HubSpot's last read failed: the figures are older." }
      : {}),
    totals: {
      contacts: result.totals.contacts,
      contacts_before: result.totals.contactsPrev,
      deals: result.totals.deals,
      won_deals: result.totals.wonDeals,
      won_revenue: result.totals.wonRevenue,
      won_revenue_before: result.totals.wonRevenuePrev,
      open_deals: result.totals.openDeals,
      open_pipeline: result.totals.openPipeline,
    },
    by_assistant: result.byEngine.map((row) => ({
      assistant: assistantOf(row.source),
      contacts: row.contacts,
      deals: row.deals,
      won_deals: row.wonDeals,
      won_revenue: row.wonRevenue,
      open_pipeline: row.openPipeline,
    })),
    by_page: result.byPage.map((row) => ({
      page: pathOf(row.page),
      contacts: row.contacts,
      deals: row.deals,
      won_revenue: row.wonRevenue,
      top_assistant: row.topSource ? assistantOf(row.topSource) : null,
    })),
    hubspot_own_ai_referrals: {
      note: "HubSpot's own AI Referrals contacts on the brand's domains that Ansvisor didn't mark: apart, never added to the totals.",
      ...result.hubspotNative,
    },
  };
}

// ─── The visit log ──────────────────────────────────────────────────────────

export async function listAiVisitsFor(
  auth: McpAuthContext,
  params: Paged & { assistant?: string; search?: string },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const { limit, offset } = pageWindow(params);
  const read = await asService(() =>
    getTrafficLogs(params.brandId, {
      limit,
      offset,
      platform: params.assistant,
      search: params.search,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    }),
  );
  const visits = read.logs.map((log) => ({
    at: log.createdAt,
    page: pathOf(log.url),
    assistant: assistantOf(log.sourcePlatform),
    source: log.sourcePlatform,
    country: log.country,
    language: log.language,
    pageviews: log.pageviews,
    referrer: log.referrer,
  }));
  return {
    ...pageMeta({ what: 'AI visits', order: 'newest first' }, read.total, offset, visits.length),
    pageviews: read.pageviews,
    visits,
  };
}

// ─── Prompts and the pages that converted: an association ──────────────────

/** A converting page, as the association joins it: its conversions, or Analytics' key events. */
interface ConvertingPage {
  page: string;
  conversions: number;
  revenue: PerCurrency;
}

/** What Analytics' revenue is in: its property's currency, which it doesn't tell Ansvisor. */
const GA_CURRENCY = 'Analytics property currency';
/** The pages the association joins at most: the most converting first. */
const PAGES_JOINED = 50;
const URL_MAX = 20_000;
const CITATION_MAX = 20_000;
const ID_CHUNK = 100;
/** Pages listed under one prompt. */
const PAGES_PER_PROMPT = 5;

/**
 * The pages that converted in the period, by key: the snippet's landing
 * pages when it counted any, else Analytics' converting pages; null when
 * neither is set up. `window` is the period their citations are read over:
 * the last 30 days where the page widened a thin one.
 */
async function convertingPages(auth: McpAuthContext, params: Paged) {
  const org = auth.organizationId!;
  const setting = await conversionsSetting(params.brandId, org);
  const pages = new Map<string, ConvertingPage>();
  const snippet = {
    counted_as: 'conversions from AI visits (the tracking snippet)',
    pages,
    window: params as Window,
  };
  if (setting.enabled) {
    const read = await readConversions(params.brandId, org, params);
    for (const row of tallyConversions(read.events).landing_pages.slice(0, PAGES_JOINED)) {
      pages.set(row.page, { page: row.page, conversions: row.conversions, revenue: row.revenue });
    }
    if (pages.size > 0) return snippet;
  }
  if (!(await sourcesOf(params.brandId)).ga) return setting.enabled ? snippet : null;
  const result = await conversionsRead(params.brandId, params, PAGES_JOINED);
  for (const row of result.pages) {
    pages.set(row.page.toLowerCase(), {
      page: row.page,
      conversions: row.keyEvents,
      revenue: result.hasRevenue ? [{ currency: GA_CURRENCY, value: Math.round(row.revenue) }] : [],
    });
  }
  return {
    counted_as: 'key events in AI sessions (Google Analytics)',
    pages,
    window: result.widened ? { dateFrom: daysAgo(CONVERSIONS_FALLBACK_DAYS) } : params,
  };
}

const chunks = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, i * size + size),
  );

/** The brand's own cited URLs that are one of `keys`' pages, by id. */
async function ownUrlsOf(brandId: string, organizationId: string, keys: ReadonlySet<string>) {
  const { data, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain, brands!inner(organization_id)')
    .eq('brand_id', brandId)
    .eq('brands.organization_id', organizationId);
  if (error) throw new Error(error.message);
  const domains = [
    ...new Set((data ?? []).map((row) => row.domain.toLowerCase().replace(/^www\./, ''))),
  ];
  const urls = new Map<number, string>();
  if (domains.length === 0 || keys.size === 0) return urls;
  for (let start = 0; start < URL_MAX; start += EVENT_PAGE) {
    const read = await supabaseAdmin
      .from('citation_urls')
      .select('id, url')
      .in('domain', domains)
      .order('id')
      .range(start, start + EVENT_PAGE - 1);
    if (read.error) throw new Error(read.error.message);
    for (const row of read.data ?? []) {
      const key = pageKeyOf(row.url);
      if (keys.has(key)) urls.set(row.id, key);
    }
    if ((read.data ?? []).length < EVENT_PAGE) break;
  }
  return urls;
}

interface CitingPrompt {
  prompt: string;
  answers: Set<string>;
  platforms: Set<string>;
  pages: Set<string>;
}

interface CitationRow {
  url_id: number;
  prompt_result_id: string;
  prompt_results: {
    prompt_id: string;
    platform: string | null;
    prompts: { text: string } | null;
  };
}

/** The brand's tracked answers in the period that cite those URLs, by prompt. */
async function citingPrompts(
  brandId: string,
  organizationId: string,
  urls: Map<number, string>,
  window: Window,
) {
  const { from, to } = boundsOf(window);
  const prompts = new Map<string, CitingPrompt>();
  let read = 0;
  for (const ids of chunks([...urls.keys()], ID_CHUNK)) {
    for (let start = 0; read < CITATION_MAX; start += EVENT_PAGE) {
      let query = supabaseAdmin
        .from('prompt_result_citations')
        .select(
          'url_id, prompt_result_id, prompt_results!inner(prompt_id, platform, prompts(text)), brands!inner(organization_id)',
        )
        .eq('brand_id', brandId)
        .eq('brands.organization_id', organizationId)
        .in('url_id', ids)
        .lte('created_at', to);
      if (from) query = query.gte('created_at', from);
      const { data, error } = await query
        .order('prompt_result_id')
        .order('url_id')
        .range(start, start + EVENT_PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as CitationRow[];
      read += rows.length;
      for (const row of rows) {
        const result = row.prompt_results;
        const entry = prompts.get(result.prompt_id) ?? {
          prompt: result.prompts?.text ?? '(deleted prompt)',
          answers: new Set<string>(),
          platforms: new Set<string>(),
          pages: new Set<string>(),
        };
        entry.answers.add(row.prompt_result_id);
        if (result.platform) entry.platforms.add(platformName(result.platform));
        entry.pages.add(urls.get(row.url_id)!);
        prompts.set(result.prompt_id, entry);
      }
      if (rows.length < EVENT_PAGE) break;
    }
  }
  return { prompts, capped: read >= CITATION_MAX };
}

/** Each currency's sum over some pages; Analytics' "property" stays its own currency. */
function sumPerCurrency(pages: ConvertingPage[]): PerCurrency {
  const sums = new Map<string, number>();
  for (const page of pages) {
    for (const { currency, value } of page.revenue)
      sums.set(currency, (sums.get(currency) ?? 0) + value);
  }
  return perCurrency(sums);
}

export async function getPromptConversionsFor(auth: McpAuthContext, params: Paged) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const converting = await convertingPages(auth, params);
  if (!converting) {
    return {
      label: PROMPT_ASSOCIATION_LABEL,
      measured: false,
      not_measured:
        'Not measured: neither conversions from AI visits nor Google Analytics is set up, so no page is known to convert.',
      next_steps: [conversionsOffStep(params.brandId), GA_STEP],
    };
  }
  const org = auth.organizationId!;
  const urls = await ownUrlsOf(params.brandId, org, new Set(converting.pages.keys()));
  const { prompts, capped } = await citingPrompts(params.brandId, org, urls, converting.window);
  const rows = [...prompts.values()]
    .map((entry) => {
      const pages = [...entry.pages]
        .map((key) => converting.pages.get(key)!)
        .sort((a, b) => b.conversions - a.conversions || a.page.localeCompare(b.page));
      return {
        prompt: entry.prompt,
        answers_citing: entry.answers.size,
        assistants: [...entry.platforms].sort(),
        conversions_on_cited_pages: pages.reduce((sum, page) => sum + page.conversions, 0),
        revenue_on_cited_pages: sumPerCurrency(pages),
        cited_pages: pages.slice(0, PAGES_PER_PROMPT),
        ...(pages.length > PAGES_PER_PROMPT
          ? { cited_pages_more: pages.length - PAGES_PER_PROMPT }
          : {}),
      };
    })
    .sort(
      (a, b) =>
        b.conversions_on_cited_pages - a.conversions_on_cited_pages ||
        b.answers_citing - a.answers_citing ||
        a.prompt.localeCompare(b.prompt),
    );
  const { rows: shown, ...page } = pageOfList(rows, params, {
    what: 'prompts whose answers cite a page that converted',
    order: 'most conversions on their cited pages first',
  });
  return {
    label: PROMPT_ASSOCIATION_LABEL,
    measured: true,
    counted_as: converting.counted_as,
    period: boundsOf(converting.window),
    how_to_read:
      "A page's conversions show under every prompt whose answers cite it: never add them up across prompts, and never say a prompt brought them.",
    ...(capped ? { capped: `Only the first ${CITATION_MAX} citations were read.` } : {}),
    ...page,
    prompts: shown,
  };
}
