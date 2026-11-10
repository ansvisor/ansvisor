import supabaseAdmin from '../../config/supabase.js';
import { AI_SOURCES_VERSION } from '../ai-sources.js';
import { brandConnection } from '../brand-integrations.js';
import { PROPERTIES_VERSION } from './properties.js';

/**
 * A brand's HubSpot connection (#2140). HubSpot is per brand, as every
 * integration is since brand access (00470): the sign-in lives in the
 * Account's pool (integration_accounts, provider 'hubspot') and the brand
 * names the one it uses (brand_integrations). Several brands may share one
 * HubSpot account ("Use the same HubSpot account as…").
 *
 * The brand's own choices on it are its brand_integrations.settings:
 *   - consent: what the person allowed Ansvisor to write in HubSpot, given
 *     when connecting and changed on the card: `contacts` (make the
 *     "Ansvisor" properties and fill them on contacts who came from an AI
 *     answer) and `pages` (Send to CMS makes draft pages), with who last
 *     allowed one and when. Nothing is written without it;
 *   - portal: the HubSpot account (Hub ID, currency, time zone, address);
 *   - properties: the definitions made in HubSpot (their version and the AI
 *     source list's), or why the last try failed;
 *   - sync: the AI-sourced pipeline's last read of HubSpot (pipeline-sync.js,
 *     00520): when, how many contacts and deals, or why it failed.
 * Consent is per brand: a brand that starts using another brand's HubSpot
 * account is asked again.
 */

export const HUBSPOT = 'hubspot';

const bool = (value) => value === true;
const text = (value, max) => (typeof value === 'string' && value ? value.slice(0, max) : null);

/** The settings as stored, read safely: anything missing or malformed reads as off or none. */
export function readSettings(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const consent = s.consent && typeof s.consent === 'object' ? s.consent : {};
  const portal = s.portal && typeof s.portal === 'object' ? s.portal : null;
  const properties = s.properties && typeof s.properties === 'object' ? s.properties : null;
  const sync = s.sync && typeof s.sync === 'object' ? s.sync : null;
  const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
  return {
    consent: {
      contacts: bool(consent.contacts),
      pages: bool(consent.pages),
      by: text(consent.by, 64),
      at: text(consent.at, 40),
    },
    portal:
      portal && Number.isInteger(portal.id)
        ? {
            id: portal.id,
            currency: text(portal.currency, 10),
            timeZone: text(portal.timeZone, 64),
            uiDomain: text(portal.uiDomain, 100),
          }
        : null,
    properties: properties
      ? {
          version: Number.isInteger(properties.version) ? properties.version : null,
          sourcesVersion: Number.isInteger(properties.sourcesVersion)
            ? properties.sourcesVersion
            : null,
          at: text(properties.at, 40),
          error: text(properties.error, 40),
        }
      : null,
    sync: sync
      ? {
          at: text(sync.at, 40),
          contacts: count(sync.contacts),
          deals: count(sync.deals),
          error: text(sync.error, 40),
        }
      : null,
  };
}

/**
 * Consent after a change: who allowed and when is the person who turned one
 * on, now; turning them off keeps the last allowing.
 */
export function nextConsent(previous, wanted, userId, now = new Date()) {
  const before = previous ?? { contacts: false, pages: false, by: null, at: null };
  const contacts = bool(wanted?.contacts);
  const pages = bool(wanted?.pages);
  const allowedMore = (contacts && !before.contacts) || (pages && !before.pages);
  return {
    contacts,
    pages,
    by: allowedMore ? userId : before.by,
    at: allowedMore ? now.toISOString() : before.at,
  };
}

/** Whether the properties in HubSpot are the current definitions, for the current AI source list. */
export function propertiesReady(settings) {
  const p = settings?.properties;
  return Boolean(
    p &&
    !p.error &&
    p.version === PROPERTIES_VERSION &&
    p.sourcesVersion === AI_SOURCES_VERSION &&
    p.at,
  );
}

/** The brand's stored settings for HubSpot, read safely; empty when the brand has none. */
export async function brandHubspotSettings(brandId) {
  const { data, error } = await supabaseAdmin
    .from('brand_integrations')
    .select('settings')
    .eq('brand_id', brandId)
    .eq('provider', HUBSPOT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return readSettings(data?.settings);
}

/**
 * The brand's HubSpot connection, whatever its status, with its settings;
 * null when the brand uses none. The caller checks the brand's access first.
 */
export async function hubspotConnection(brandId) {
  const connection = await brandConnection(brandId, HUBSPOT);
  if (!connection) return null;
  return { ...connection, settings: await brandHubspotSettings(brandId) };
}

/** Writes the brand's settings (its brand_integrations row must exist). */
export async function writeHubspotSettings(brandId, settings) {
  const { error } = await supabaseAdmin
    .from('brand_integrations')
    .update({ settings, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('provider', HUBSPOT);
  if (error) throw new Error(error.message);
}

/**
 * Keeps how the pipeline's last read of HubSpot went (pipeline-sync.js) on
 * the brand's settings, leaving the rest as it is. Nothing when the brand no
 * longer uses HubSpot (disconnected meanwhile).
 */
export async function writeHubspotSync(brandId, sync) {
  const { data, error } = await supabaseAdmin
    .from('brand_integrations')
    .select('settings')
    .eq('brand_id', brandId)
    .eq('provider', HUBSPOT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  const raw = data.settings && typeof data.settings === 'object' ? data.settings : {};
  await writeHubspotSettings(brandId, { ...raw, sync });
}

/** Names the sign-in on cards: its Hub ID. */
export async function labelSignIn(accountId, label) {
  const { error } = await supabaseAdmin
    .from('integration_accounts')
    .update({ label, updated_at: new Date().toISOString() })
    .eq('id', accountId)
    .eq('provider', HUBSPOT);
  if (error) throw new Error(error.message);
}

/**
 * Marks the sign-in as refused (HubSpot's 401, or Composio says it's gone):
 * the card asks to connect again, and nothing calls it until then.
 */
export async function markSignInRefused(accountId) {
  const { error } = await supabaseAdmin
    .from('integration_accounts')
    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('id', accountId)
    .eq('provider', HUBSPOT);
  if (error) throw new Error(error.message);
}
