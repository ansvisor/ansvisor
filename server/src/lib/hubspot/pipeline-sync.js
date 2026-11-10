import supabaseAdmin from '../../config/supabase.js';
import { getPlan, hasFeature } from '../../config/plans.js';
import { activeOrgFilter } from '../active-subscriptions.js';
import { classifyAiSource } from '../ai-sources.js';
import { connectedBrands } from '../brand-integrations.js';
import { selectInChunks } from '../chunked-in.js';
import { isHubspotConfigured } from '../composio.js';
import { logger } from '../logger.js';
import { applyPlanOverrides } from '../plan-guard.js';
import { eventUrl } from '../traffic-events.js';
import { HubspotError, hubspotClient } from './client.js';
import {
  HUBSPOT,
  brandHubspotSettings,
  markSignInRefused,
  writeHubspotSync,
} from './connection.js';

/**
 * The AI-sourced pipeline (#2140, 00520): once a day, and on Sync now, the
 * brand's HubSpot account is read into hubspot_ai_contacts and
 * hubspot_ai_deals for AI Traffic's "AI-sourced pipeline". Read-only on
 * HubSpot, and only with the brand's consent to mark contacts (which covers
 * reading them back) and the plan's crm_integrations.
 *
 *   1. The contacts Ansvisor marked for this brand (its hidden brand id
 *      property), with their AI source, landing page and dates.
 *   2. HubSpot's own "AI Referrals" contacts (original traffic source) whose
 *      first page is on one of the brand's domains and that Ansvisor didn't
 *      mark: a line of their own (owner, 2026-11-10). A HubSpot account that
 *      refuses that filter just has none.
 *   3. Those contacts' deals. A deal with several AI contacts counts once,
 *      in full, credited to its earliest contact marked by Ansvisor, else
 *      its earliest HubSpot AI Referrals contact (owner, 2026-11-10). Its
 *      amount is in the HubSpot account's own currency.
 *   4. The brand's rows replaced: what HubSpot no longer has goes.
 *
 * Contacts are read by HubSpot's search, ordered by their id and paged past
 * the last one read (search pages stop at 10,000), up to MAX_CONTACTS. No
 * name or email is ever read.
 */

/** Contacts read per brand at most, each kind. */
export const MAX_CONTACTS = 50_000;
/** HubSpot's search, batch read and association read page size. */
const PAGE = 100;
/** How far back HubSpot's own AI Referrals contacts are read. */
const NATIVE_DAYS = 400;
/** Rows written per insert. */
const WRITE_CHUNK = 500;

const STAMPED_PROPERTIES = [
  'ansvisor_ai_source',
  'ansvisor_ai_landing_page',
  'ansvisor_ai_first_visit_at',
  'ansvisor_ai_converted_at',
  'createdate',
];
const NATIVE_PROPERTIES = ['hs_analytics_source_data_1', 'hs_analytics_first_url', 'createdate'];
const DEAL_PROPERTIES = [
  'amount',
  'amount_in_home_currency',
  'hs_is_closed',
  'hs_is_closed_won',
  'closedate',
  'createdate',
];

/** A HubSpot datetime (ISO, or milliseconds) as ISO, or null. */
export function isoOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const at = /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(String(value));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** A HubSpot number as a number, or null. */
function amountOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** An AI source as the list keys it; one Ansvisor doesn't know reads as unknown. */
export function sourceKeyOf(value) {
  return (typeof value === 'string' && classifyAiSource(value)) || 'unknown';
}

/** Whether `url` is on one of `domains` (or a subdomain of one). */
export function onDomains(url, domains) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Every contact a search finds, ordered by id and paged past the last one
 * read, up to MAX_CONTACTS.
 */
async function searchAll(request, filters, properties) {
  const found = [];
  let last = '0';
  for (;;) {
    const { data } = await request({
      method: 'POST',
      path: '/crm/v3/objects/contacts/search',
      body: {
        filterGroups: [
          {
            filters: [...filters, { propertyName: 'hs_object_id', operator: 'GT', value: last }],
          },
        ],
        sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
        properties,
        limit: PAGE,
      },
    });
    const results = Array.isArray(data?.results) ? data.results : [];
    for (const row of results) {
      if (typeof row?.id === 'string' || typeof row?.id === 'number') found.push(row);
    }
    if (results.length < PAGE || found.length >= MAX_CONTACTS) break;
    last = String(results.at(-1).id);
  }
  return found.slice(0, MAX_CONTACTS);
}

/** The contacts Ansvisor marked for the brand. */
async function stampedContacts(request, brandId) {
  const rows = await searchAll(
    request,
    [{ propertyName: 'ansvisor_brand_id', operator: 'EQ', value: brandId }],
    STAMPED_PROPERTIES,
  );
  return rows.map((row) => {
    const p = row.properties ?? {};
    return {
      contact_id: String(row.id),
      origin: 'ansvisor',
      ai_source: sourceKeyOf(p.ansvisor_ai_source),
      landing_url: p.ansvisor_ai_landing_page ? eventUrl(p.ansvisor_ai_landing_page) : null,
      first_at: isoOf(p.ansvisor_ai_first_visit_at),
      converted_at: isoOf(p.ansvisor_ai_converted_at),
      hs_created_at: isoOf(p.createdate),
    };
  });
}

/**
 * HubSpot's own AI Referrals contacts on the brand's domains, or none when
 * the account refuses the filter (an older HubSpot without that source).
 */
async function nativeContacts(request, { brandId, domains, now }) {
  if (domains.length === 0) return [];
  const since = String(now - NATIVE_DAYS * 24 * 60 * 60 * 1000);
  let rows;
  try {
    rows = await searchAll(
      request,
      [
        { propertyName: 'hs_analytics_source', operator: 'EQ', value: 'AI_REFERRALS' },
        { propertyName: 'createdate', operator: 'GTE', value: since },
      ],
      NATIVE_PROPERTIES,
    );
  } catch (err) {
    if (!(err instanceof HubspotError) || err.code !== 'invalid') throw err;
    logger.warn({ brandId, code: err.code }, '[hubspot] AI Referrals filter refused');
    return [];
  }
  return rows
    .filter((row) => onDomains(row.properties?.hs_analytics_first_url ?? '', domains))
    .map((row) => {
      const p = row.properties ?? {};
      return {
        contact_id: String(row.id),
        origin: 'hubspot',
        ai_source: sourceKeyOf(p.hs_analytics_source_data_1),
        landing_url: eventUrl(p.hs_analytics_first_url),
        first_at: null,
        converted_at: null,
        hs_created_at: isoOf(p.createdate),
      };
    });
}

/** Each contact's deal ids, in batches. */
async function dealIdsOf(request, contactIds) {
  const byContact = new Map();
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const { data } = await request({
      method: 'POST',
      path: '/crm/v4/associations/contacts/deals/batch/read',
      body: { inputs: contactIds.slice(i, i + PAGE).map((id) => ({ id })) },
    });
    for (const result of Array.isArray(data?.results) ? data.results : []) {
      const from = String(result?.from?.id ?? '');
      const to = (Array.isArray(result?.to) ? result.to : [])
        .map((t) => String(t?.toObjectId ?? ''))
        .filter((id) => /^\d+$/.test(id));
      if (from) byContact.set(from, to);
    }
  }
  return byContact;
}

/** The deals' amounts, stages and dates, in batches. */
async function readDeals(request, dealIds) {
  const deals = new Map();
  for (let i = 0; i < dealIds.length; i += PAGE) {
    const { data } = await request({
      method: 'POST',
      path: '/crm/v3/objects/deals/batch/read',
      body: {
        properties: DEAL_PROPERTIES,
        inputs: dealIds.slice(i, i + PAGE).map((id) => ({ id })),
      },
    });
    for (const row of Array.isArray(data?.results) ? data.results : []) {
      if (row?.id !== undefined) deals.set(String(row.id), row.properties ?? {});
    }
  }
  return deals;
}

/** When a contact first came from AI, as deals compare them: Ansvisor's first visit, else HubSpot's create date. */
const firstOf = (contact) =>
  contact.first_at ?? contact.converted_at ?? contact.hs_created_at ?? '9999';

/**
 * The contact a deal is credited to: its earliest contact marked by
 * Ansvisor, else its earliest HubSpot AI Referrals contact; ties by id.
 */
export function creditedContact(contacts) {
  const rank = (c) => [c.origin === 'ansvisor' ? 0 : 1, firstOf(c), Number(c.contact_id)];
  return [...contacts].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] < rb[i]) return -1;
      if (ra[i] > rb[i]) return 1;
    }
    return 0;
  })[0];
}

/**
 * Reads one brand's AI-sourced contacts and deals from HubSpot. Pure but for
 * `request` (client.js): answers the rows to write.
 */
export async function readPipeline(request, { brandId, domains, currency, now = Date.now() }) {
  const stamped = await stampedContacts(request, brandId);
  const marked = new Set(stamped.map((c) => c.contact_id));
  const native = (await nativeContacts(request, { brandId, domains, now })).filter(
    (c) => !marked.has(c.contact_id),
  );
  const contacts = [...stamped, ...native];
  const byId = new Map(contacts.map((c) => [c.contact_id, c]));

  const dealsByContact = await dealIdsOf(request, [...byId.keys()]);
  const contactsByDeal = new Map();
  for (const [contactId, dealIds] of dealsByContact) {
    for (const dealId of dealIds) {
      contactsByDeal.set(dealId, [...(contactsByDeal.get(dealId) ?? []), byId.get(contactId)]);
    }
  }
  const dealProps = await readDeals(request, [...contactsByDeal.keys()]);

  const deals = [];
  for (const [dealId, dealContacts] of contactsByDeal) {
    const p = dealProps.get(dealId);
    if (!p) continue;
    const credited = creditedContact(dealContacts.filter(Boolean));
    if (!credited) continue;
    deals.push({
      deal_id: dealId,
      contact_id: credited.contact_id,
      origin: credited.origin,
      ai_source: credited.ai_source,
      landing_url: credited.landing_url,
      amount: amountOf(p.amount_in_home_currency) ?? amountOf(p.amount),
      currency: typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : null,
      is_closed: String(p.hs_is_closed) === 'true',
      is_won: String(p.hs_is_closed_won) === 'true',
      close_date: isoOf(p.closedate),
      hs_created_at: isoOf(p.createdate),
    });
  }
  return { contacts, deals };
}

/** Replaces the brand's rows in `table` with `rows`: upserted, then the older ones removed. */
async function replaceRows(table, brandId, rows, syncedAt) {
  const keyed = rows.map((row) => ({ ...row, brand_id: brandId, synced_at: syncedAt }));
  const conflict = table === 'hubspot_ai_contacts' ? 'brand_id,contact_id' : 'brand_id,deal_id';
  for (let i = 0; i < keyed.length; i += WRITE_CHUNK) {
    const { error } = await supabaseAdmin
      .from(table)
      .upsert(keyed.slice(i, i + WRITE_CHUNK), { onConflict: conflict });
    if (error) throw new Error(`${table} write: ${error.message}`);
  }
  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .eq('brand_id', brandId)
    .lt('synced_at', syncedAt);
  if (error) throw new Error(`${table} prune: ${error.message}`);
}

/** The brand's domains, as hosts without www. */
async function brandDomains(brandId) {
  const { data, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);
  if (error) throw new Error(`brand_domains read: ${error.message}`);
  return (data ?? [])
    .map((d) =>
      String(d.domain ?? '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, ''),
    )
    .filter(Boolean);
}

/**
 * Syncs one brand's pipeline on its connection, and keeps how it went on
 * the brand's HubSpot settings (`sync`). HubSpot refusing the sign-in marks
 * it for reconnecting. Answers the counts, or the refusal's code.
 */
export async function syncBrandPipeline(connection, { settings, now = Date.now() } = {}) {
  const syncedAt = new Date(now).toISOString();
  const request = hubspotClient(connection.composioAccountId);
  try {
    const domains = await brandDomains(connection.brandId);
    const { contacts, deals } = await readPipeline(request, {
      brandId: connection.brandId,
      domains,
      currency: settings?.portal?.currency ?? null,
      now,
    });
    await replaceRows('hubspot_ai_contacts', connection.brandId, contacts, syncedAt);
    await replaceRows('hubspot_ai_deals', connection.brandId, deals, syncedAt);
    const sync = { at: syncedAt, contacts: contacts.length, deals: deals.length, error: null };
    await writeHubspotSync(connection.brandId, sync);
    return sync;
  } catch (err) {
    if (!(err instanceof HubspotError)) throw err;
    if (err.code === 'auth' && connection.accountId) await markSignInRefused(connection.accountId);
    const sync = { at: syncedAt, contacts: null, deals: null, error: err.code };
    await writeHubspotSync(connection.brandId, sync);
    return sync;
  }
}

/** The organizations among `orgIds` whose plan has HubSpot. */
async function planFilter(orgIds) {
  const { data, error } = await selectInChunks(orgIds, (ids) =>
    supabaseAdmin.from('organizations').select('id, plan, plan_overrides').in('id', ids),
  );
  if (error) throw new Error(`organizations read: ${error.message}`);
  const allowed = new Set(
    (data ?? [])
      .filter((org) => hasFeature(applyPlanOverrides(getPlan(org.plan), org), 'crm_integrations'))
      .map((org) => org.id),
  );
  return (orgId) => allowed.has(orgId);
}

/**
 * Syncs every eligible brand, or one (Sync now): its HubSpot sign-in live,
 * its organization on an active plan with HubSpot, the brand active and not
 * the demo, and the person's consent to mark contacts. Answers per brand.
 */
export async function runHubspotPipelineSync({ brandId, now = Date.now() } = {}) {
  if (!isHubspotConfigured()) return { synced: 0, skipped: 0, results: [] };
  const connections = await connectedBrands(HUBSPOT, brandId ? { brandId } : {});
  const orgIds = [...new Set(connections.map((c) => c.organizationId))];
  if (orgIds.length === 0) return { synced: 0, skipped: 0, results: [] };
  const [isActive, hasHubspot] = await Promise.all([activeOrgFilter(orgIds), planFilter(orgIds)]);
  const eligible = connections.filter(
    (c) => isActive(c.organizationId) && hasHubspot(c.organizationId),
  );
  const { data: brands, error } = await selectInChunks(
    eligible.map((c) => c.brandId),
    (ids) =>
      supabaseAdmin
        .from('brands')
        .select('id')
        .eq('is_active', true)
        .eq('is_demo', false)
        .in('id', ids),
  );
  if (error) throw new Error(`brands read: ${error.message}`);
  const live = new Set((brands ?? []).map((b) => b.id));

  const results = [];
  let synced = 0;
  let skipped = 0;
  for (const connection of eligible) {
    if (!live.has(connection.brandId)) continue;
    try {
      const settings = await brandHubspotSettings(connection.brandId);
      if (!settings.consent.contacts) {
        skipped++;
        continue;
      }
      const sync = await syncBrandPipeline(connection, { settings, now });
      results.push({ brandId: connection.brandId, ...sync });
      if (sync.error) skipped++;
      else synced++;
    } catch (err) {
      logger.error({ err, brandId: connection.brandId }, '[hubspot] pipeline sync failed');
      results.push({ brandId: connection.brandId, error: 'failed' });
      skipped++;
    }
  }
  return { synced, skipped, results };
}
