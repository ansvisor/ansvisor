import { PLANS } from '@/config/plans';
import { getTrafficAiPipeline } from '@/lib/actions/traffic';
import { planGateLock } from '@/lib/chat/plan-facts';
import { siteTypeOf } from '@/lib/content/page-types';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readSnippet } from '@/lib/traffic-snippet';
import {
  HUBSPOT_SETTINGS_PATH,
  INTEGRATIONS_SETTINGS_PATH,
  snippetState,
  type SnippetState,
} from '@/lib/traffic-sources';
import { asService, planFactsOf } from './chat-facts';
import { brandAllowed } from './data';
import { lastReportedDay, sourcesOf } from './google-reads';

/**
 * What a brand has set up to measure customers and revenue from AI visits
 * (get_tracking_setup), each item with its state and, when something is
 * missing, the plain next step and the page it is done on: the tracking
 * snippet (AI Traffic's Data sources), conversions from AI visits and their
 * consent mode (Brand settings › Tracking), whether conversions arrive (a
 * form, a conversion call, the Shopify pixel), Google Analytics and what it
 * reports, and HubSpot's AI-sourced pipeline. The other reads of this area
 * (ai-conversions.ts) give the same steps when their own source is missing.
 * Every state is read as AI Traffic and Brand settings read it. Null for a
 * brand outside the person's scope.
 */

const DAY_MS = 86_400_000;
/** How far back "does Analytics report key events or revenue" looks. */
const GA_LOOKBACK_DAYS = 90;
const BILLING_PATH = '/dashboard/settings/billing';

/** Brand settings › Tracking: the tag, conversions, consent and the Shopify pixel. */
export const trackingSettingsPath = (brandId: string) =>
  `/dashboard/brands/${brandId}/settings?tab=tracking`;

export interface SetupStep {
  next_step: string;
  /** The app page it is done on. */
  where: string;
}

export const SNIPPET_STEP: SetupStep = {
  next_step:
    "Add the tracking snippet to the head of every page: AI Traffic › Data sources › Install shows it with the brand's own code. Until it is seen, 0 AI visits means nothing is measured yet.",
  where: '/dashboard/traffic',
};

export const conversionsOffStep = (brandId: string): SetupStep => ({
  next_step:
    'Turn on Track conversions from AI visits in Brand settings › Tracking and choose Consent, then put the tag shown under Use this tag on every page in place of the old one. Forms with an email field then count as sign-ups by themselves.',
  where: trackingSettingsPath(brandId),
});

const noConversionsStep = (brandId: string, consent: Consent): SetupStep => ({
  next_step: [
    'No conversion has arrived yet. Check that the tag with conversions is on every page.',
    consent === 'wait'
      ? "With Wait for the visitor's consent, the cookie banner must tell the snippet: ansvisor('consent', 'granted') when a visitor agrees (Google Consent Mode needs nothing more; a Tag Manager banner needs a tag for it)."
      : '',
    "Forms with an email field count by themselves; anything else needs ansvisor('conversion', { type: … }) from the site's code.",
  ]
    .filter(Boolean)
    .join(' '),
  where: trackingSettingsPath(brandId),
});

const ordersStep = (brandId: string): SetupStep => ({
  next_step:
    "Orders, bookings and subscriptions need a conversion call with their value on the confirmation page: ansvisor('conversion', { type: 'order', value, currency, order }). On a Shopify store, add the Customer events pixel from Brand settings › Tracking › Shopify store instead.",
  where: trackingSettingsPath(brandId),
});

const shopifyStep = (brandId: string): SetupStep => ({
  next_step:
    'On a Shopify store: copy the pixel under Shopify store in Brand settings › Tracking and add it in Shopify admin › Settings › Customer events as a custom pixel, with the tag in theme.liquid.',
  where: trackingSettingsPath(brandId),
});

export const GA_STEP: SetupStep = {
  next_step:
    "Connect Google Analytics and pick the brand's property in Settings › Integrations. Its key events and revenue from AI sessions then show on AI Traffic.",
  where: INTEGRATIONS_SETTINGS_PATH,
};

export type HubspotState =
  | 'not_on_plan'
  | 'not_connected'
  | 'marking_off'
  | 'first_sync'
  | 'connected'
  | 'unknown';

/** HubSpot's step for a state that isn't connected; `plan` names the plan it comes with. */
export function hubspotStep(state: HubspotState, plan: string | null = null): SetupStep | null {
  switch (state) {
    case 'not_on_plan':
      return {
        next_step: `The AI-sourced pipeline from HubSpot comes with the ${plan ?? 'Growth'} plan: an admin upgrades in Settings › Billing.`,
        where: BILLING_PATH,
      };
    case 'not_connected':
      return {
        next_step:
          'Connect HubSpot on its card in Settings › Integrations to see the contacts, deals and revenue AI answers bring.',
        where: HUBSPOT_SETTINGS_PATH,
      };
    case 'marking_off':
      return {
        next_step: 'Turn on marking contacts on the HubSpot card in Settings › Integrations.',
        where: HUBSPOT_SETTINGS_PATH,
      };
    case 'first_sync':
      return {
        next_step:
          'The first read of HubSpot runs within a day; Sync now on the HubSpot card starts it at once.',
        where: HUBSPOT_SETTINGS_PATH,
      };
    default:
      return null;
  }
}

/** What the pipeline's read says of the connection, as the page's section shows it. */
export function hubspotStateOf(pipeline: {
  connected: boolean;
  contactsConsent: boolean;
  syncedAt: string | null;
}): HubspotState {
  if (!pipeline.connected) return 'not_connected';
  if (!pipeline.contactsConsent) return 'marking_off';
  return pipeline.syncedAt ? 'connected' : 'first_sync';
}

type Consent = 'wait' | 'always';
export type GaState = 'not_connected' | 'syncing' | 'connected';

/** What the setup read gathers, before it says anything. */
export interface SetupFacts {
  brandId: string;
  snippet: SnippetState;
  snippetLastVisitAt: string | null;
  conversionsOn: boolean;
  consent: Consent;
  /** The newest conversion from a form, a conversion call and the Shopify pixel, ever. */
  lastConversion: { form: string | null; call: string | null; shopify: string | null };
  /** The newest order or booking with a value and a currency, ever. */
  lastValuedOrderAt: string | null;
  /** Orders and bookings are what the site sells: an e-commerce or B2C site. */
  sells: boolean;
  ecommerce: boolean;
  ga: GaState;
  /** What Analytics reported for AI sessions in the last 90 days; null unless connected. */
  gaReports: { keyEvents: boolean; revenue: boolean } | null;
  hubspot: HubspotState;
  /** The plan HubSpot's pipeline comes with, when not on this one. */
  hubspotPlan: string | null;
}

export interface SetupItem {
  item:
    | 'snippet'
    | 'conversions'
    | 'conversion_events'
    | 'orders'
    | 'shopify_pixel'
    | 'google_analytics'
    | 'hubspot';
  state: string;
  ok: boolean;
  /** Not needed to answer who brings customers: it adds to the answer. */
  optional?: true;
  /** What it measures. */
  measures: string;
  detail: string;
  next_step?: string;
  where?: string;
}

const day = (at: string | null) => (at ? at.slice(0, 10) : null);
const newest = (...values: (string | null)[]) =>
  values.reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null);

/** Each item's state, in the order a person sets them up, with the step a missing one takes. */
export function setupItems(f: SetupFacts): SetupItem[] {
  const items: SetupItem[] = [];
  items.push(
    f.snippet === 'not_detected'
      ? {
          item: 'snippet',
          state: 'not_detected',
          ok: false,
          measures: 'AI visits, and every conversion that follows one',
          detail: 'Not seen on the site yet.',
          ...SNIPPET_STEP,
        }
      : {
          item: 'snippet',
          state: f.snippet,
          ok: true,
          measures: 'AI visits, and every conversion that follows one',
          detail:
            f.snippet === 'active'
              ? `Active: last AI visit on ${day(f.snippetLastVisitAt)}.`
              : 'Installed; no AI visit in the last 7 days.',
        },
  );
  const conversions = 'sign-ups, forms, orders and bookings by assistant and landing page';
  if (!f.conversionsOn) {
    items.push({
      item: 'conversions',
      state: 'off',
      ok: false,
      measures: conversions,
      detail: 'Off: no conversion is linked to an AI visit.',
      ...conversionsOffStep(f.brandId),
    });
  } else {
    items.push({
      item: 'conversions',
      state: 'on',
      ok: true,
      measures: conversions,
      detail:
        f.consent === 'wait'
          ? "On, waiting for the visitor's consent: the cookie banner tells the snippet."
          : "On, without waiting for consent (the site's own banner covers it).",
    });
    const { form, call, shopify } = f.lastConversion;
    const last = newest(form, call, shopify);
    items.push(
      last
        ? {
            item: 'conversion_events',
            state: 'arriving',
            ok: true,
            measures: 'that the tag, consent and forms work',
            detail: `Last conversion on ${day(last)}: from a form ${day(form) ?? 'never'}, a conversion call ${day(call) ?? 'never'}, the Shopify pixel ${day(shopify) ?? 'never'}.`,
          }
        : {
            item: 'conversion_events',
            state: 'none_yet',
            ok: false,
            measures: 'that the tag, consent and forms work',
            detail: 'Conversions are on, and none has arrived yet.',
            ...noConversionsStep(f.brandId, f.consent),
          },
    );
    items.push(
      f.lastValuedOrderAt
        ? {
            item: 'orders',
            state: 'arriving',
            ok: true,
            measures: 'orders, bookings and subscriptions with their value',
            detail: `Last order or booking with a value on ${day(f.lastValuedOrderAt)}.`,
          }
        : {
            item: 'orders',
            state: 'none_yet',
            ok: false,
            ...(f.sells ? {} : { optional: true as const }),
            measures: 'orders, bookings and subscriptions with their value',
            detail: 'No order or booking with a value has arrived.',
            ...ordersStep(f.brandId),
          },
    );
    if (f.ecommerce) {
      items.push(
        f.lastConversion.shopify
          ? {
              item: 'shopify_pixel',
              state: 'seen',
              ok: true,
              optional: true,
              measures: 'orders from a Shopify checkout',
              detail: `Seen: last order on ${day(f.lastConversion.shopify)}.`,
            }
          : {
              item: 'shopify_pixel',
              state: 'not_seen',
              ok: false,
              optional: true,
              measures: 'orders from a Shopify checkout',
              detail: 'No order from the Shopify pixel yet.',
              ...shopifyStep(f.brandId),
            },
      );
    }
  }
  const ga = 'key events and revenue in AI sessions: AI Traffic › Where AI visitors convert';
  if (f.ga === 'connected') {
    const reports = f.gaReports ?? { keyEvents: false, revenue: false };
    items.push({
      item: 'google_analytics',
      state: 'connected',
      ok: true,
      optional: true,
      measures: ga,
      detail: [
        reports.keyEvents
          ? 'Reports key events in AI sessions.'
          : 'No key event in AI sessions in the last 90 days: mark sign-ups or forms as key events in Google Analytics.',
        reports.revenue
          ? 'Reports purchases or revenue.'
          : 'No purchase or revenue in AI sessions in the last 90 days: revenue there needs GA4 purchase events.',
      ].join(' '),
    });
  } else {
    items.push({
      item: 'google_analytics',
      state: f.ga,
      ok: false,
      optional: true,
      measures: ga,
      ...(f.ga === 'syncing'
        ? { detail: 'Connected; its first data hasn’t arrived yet (Analytics reports a day late).' }
        : { detail: 'Not connected for this brand.', ...GA_STEP }),
    });
  }
  const hubspot = hubspotStep(f.hubspot, f.hubspotPlan);
  items.push({
    item: 'hubspot',
    state: f.hubspot,
    ok: f.hubspot === 'connected',
    optional: true,
    measures: 'contacts, deals and revenue from AI: AI Traffic › AI-sourced pipeline',
    detail:
      f.hubspot === 'connected'
        ? 'Connected and read.'
        : f.hubspot === 'unknown'
          ? "HubSpot's state couldn't be read."
          : 'Not set up.',
    ...(hubspot ?? {}),
  });
  return items;
}

/** The newest conversion of the brand, ever, from one origin or with a value. */
export async function lastConversionAt(
  brandId: string,
  organizationId: string,
  only: { origin?: 'form' | 'call' | 'shopify'; valued?: true } = {},
): Promise<string | null> {
  let query = supabaseAdmin
    .from('ai_traffic_events')
    .select('occurred_at, brands!inner(organization_id)')
    .eq('brand_id', brandId)
    .eq('brands.organization_id', organizationId)
    .eq('kind', 'conversion');
  if (only.origin) query = query.eq('origin', only.origin);
  if (only.valued) {
    query = query
      .in('goal', ['order', 'booking'])
      .not('value', 'is', null)
      .not('currency', 'is', null);
  }
  const { data, error } = await query
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { occurred_at?: string } | null)?.occurred_at ?? null;
}

/** Whether Analytics reported key events, and purchases or revenue, in AI sessions lately. */
async function gaReportsOf(brandId: string) {
  const since = new Date(Date.now() - GA_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
  const any = async (filter: string) => {
    const { data, error } = await supabaseAdmin
      .from('ga_ai_traffic_stats')
      .select('date')
      .eq('brand_id', brandId)
      .gte('date', since)
      .or(filter)
      .limit(1);
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  };
  const [keyEvents, revenue] = await Promise.all([
    any('key_events.gt.0'),
    any('purchase_revenue.gt.0,transactions.gt.0'),
  ]);
  return { keyEvents, revenue };
}

/** HubSpot's state, as the AI-sourced pipeline section reads it, behind its plan gate. */
async function hubspotOf(auth: McpAuthContext, brandId: string) {
  const locked = planGateLock(await planFactsOf(auth.organizationId!), {
    feature: 'crm_integrations',
  });
  if (locked) return { state: 'not_on_plan' as const, plan: PLANS[locked].name };
  try {
    const since = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);
    const pipeline = await asService(() => getTrafficAiPipeline(brandId, { dateFrom: since }));
    return { state: pipeline ? hubspotStateOf(pipeline) : ('unknown' as const), plan: null };
  } catch (err) {
    console.error('[chat/tracking-setup] HubSpot state:', err);
    return { state: 'unknown' as const, plan: null };
  }
}

export async function getTrackingSetupFor(auth: McpAuthContext, params: { brandId: string }) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const { brandId } = params;
  const org = auth.organizationId!;
  const [brand, snippet, form, call, shopify, valued, google, hubspot] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select(
        'name, conversions_enabled, conversions_consent, site_type, industry, shopping_mode_enabled',
      )
      .eq('id', brandId)
      .eq('organization_id', org)
      .maybeSingle(),
    readSnippet(supabaseAdmin, brandId),
    lastConversionAt(brandId, org, { origin: 'form' }),
    lastConversionAt(brandId, org, { origin: 'call' }),
    lastConversionAt(brandId, org, { origin: 'shopify' }),
    lastConversionAt(brandId, org, { valued: true }),
    sourcesOf(brandId),
    hubspotOf(auth, brandId),
  ]);
  if (brand.error) throw new Error(brand.error.message);
  const row = brand.data;
  if (!row) return null;
  const gaDay = google.ga ? await lastReportedDay('ga_ai_traffic_stats', brandId) : null;
  const site = siteTypeOf({
    siteType: row.site_type,
    industry: row.industry,
    shoppingModeEnabled: row.shopping_mode_enabled,
  });
  const items = setupItems({
    brandId,
    snippet: snippetState(snippet),
    snippetLastVisitAt: snippet.lastVisitAt,
    conversionsOn: row.conversions_enabled === true,
    consent: row.conversions_consent === 'always' ? 'always' : 'wait',
    lastConversion: { form, call, shopify },
    lastValuedOrderAt: valued,
    sells: site === 'ecommerce' || site === 'b2c',
    ecommerce: site === 'ecommerce',
    ga: !google.ga ? 'not_connected' : gaDay ? 'connected' : 'syncing',
    gaReports: gaDay ? await gaReportsOf(brandId) : null,
    hubspot: hubspot.state,
    hubspotPlan: hubspot.plan,
  });
  const canChange = auth.role === 'admin' || auth.role === 'manager';
  return {
    brand: row.name,
    site_type: site,
    missing: items.filter((item) => !item.ok && !item.optional).length,
    items,
    who_can_change: `Admins and managers change these settings and connections${
      canChange ? ': the person asking is one.' : ': the person asking is not one, so they ask one.'
    } Anyone can copy the tag.`,
  };
}
