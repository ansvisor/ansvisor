import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { brandReaders } from '../access.js';

/**
 * Who chose what for a brand's e-mails (Settings › Notifications, "Your
 * e-mails", 00554). Each person saves their own choices; until they do, the
 * brand's Pulse settings (pulse_settings) decide for them as before, so the
 * senders mail them exactly what they got before 00554.
 *
 *   * savers: everyone in the workspace who saved a choice for the kind,
 *     whether or not they can see the brand. The brand's list no longer
 *     speaks for them (withoutSavers).
 *   * people: those of them who can see the brand (brand access), each with
 *     their choice for it: the brand's own row, else All my brands.
 */

/** A database without 00554 yet: nobody has saved, everyone is carried over. */
const MISSING_TABLE = new Set(['42P01', 'PGRST205']);

/**
 * @param {string} organizationId
 * @param {string} brandId
 * @param {'daily_pulse'|'traffic_digest'} kind
 * @returns {Promise<{ savers: Set<string>, people: Map<string, string> }>}
 */
export async function brandChoices(organizationId, brandId, kind) {
  const { data, error } = await supabaseAdmin
    .from('notification_preferences')
    .select('user_id, brand_id, frequency')
    .eq('organization_id', organizationId)
    .eq('kind', kind);
  if (error) {
    if (MISSING_TABLE.has(error.code)) {
      logger.warn({ code: error.code }, '[notifications] no notification_preferences table yet');
      return { savers: new Set(), people: new Map() };
    }
    throw new Error(`notification_preferences: ${error.message}`);
  }
  const rows = data ?? [];
  if (rows.length === 0) return { savers: new Set(), people: new Map() };

  const all = new Map();
  const own = new Map();
  for (const row of rows) {
    if (row.brand_id === null) all.set(row.user_id, row.frequency);
    else if (row.brand_id === brandId) own.set(row.user_id, row.frequency);
  }
  const savers = new Set(rows.map((row) => row.user_id));
  const readers = await brandReaders(organizationId, [brandId]);
  const people = new Map();
  for (const id of savers) {
    if (!readers.has(id)) continue;
    const choice = own.get(id) ?? all.get(id);
    if (choice) people.set(id, choice);
  }
  return { savers, people };
}

/**
 * Sign-in e-mails read lately, by user id (null: none). A sweep asks for the
 * same people once per brand and frequency; they are read once per
 * EMAIL_TTL_MS instead, LOOKUPS at a time.
 */
const EMAIL_TTL_MS = 10 * 60 * 1000;
const LOOKUPS = 5;
const emailCache = new Map();

/** Forgets the e-mails read so far (tests, and a sweep that must read afresh). */
export function forgetEmails() {
  emailCache.clear();
}

async function emailOf(id, now) {
  const cached = emailCache.get(id);
  if (cached && cached.until > now) return cached.email;
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(id);
  const email = authUser?.user?.email ?? null;
  emailCache.set(id, { email, until: now + EMAIL_TTL_MS });
  return email;
}

/** The sign-in e-mail of each of `ids` that has one, in their order. */
export async function emailsOf(ids) {
  const now = Date.now();
  const unique = [...new Set(ids)];
  const found = new Map();
  for (let i = 0; i < unique.length; i += LOOKUPS) {
    const batch = unique.slice(i, i + LOOKUPS);
    const emails = await Promise.all(batch.map((id) => emailOf(id, now)));
    batch.forEach((id, j) => found.set(id, emails[j]));
  }
  return ids.map((id) => found.get(id)).filter(Boolean);
}

export const sameAddress = (address) => String(address).trim().toLowerCase();

/** `addresses` less the savers' own: their choices speak for them now. */
export async function withoutSavers(addresses, savers) {
  if (!savers?.size || addresses.length === 0) return addresses;
  const theirs = new Set((await emailsOf([...savers])).map(sameAddress));
  return addresses.filter((address) => !theirs.has(sameAddress(address)));
}

/** The ids of the people whose choice is `frequency`. */
export function chose(people, frequency) {
  return [...people].filter(([, choice]) => choice === frequency).map(([id]) => id);
}

/** Addresses once each, whatever their case, in their first spelling. */
export function uniqueAddresses(addresses) {
  const seen = new Set();
  return addresses.filter((address) => {
    const key = sameAddress(address);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
