import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { brandReaders } from '../access.js';
import { isSubscriptionActive } from '../../config/plans.js';

/**
 * Who gets a notification e-mail of a brand, and how often (Settings ›
 * Notifications, "Your e-mails", 00554): everyone who may see the brand
 * (brand access), each with their own choice for it: the brand's row, else
 * their All my brands row, else the kind's default, the choice the page shows
 * a person who hasn't saved. The Daily Pulse and the AI Traffic digest keep
 * their own rule (pulse/audience.js), carried over from pulse_settings.
 */

/**
 * Each kind's default, as web/src/lib/notification-preferences.ts gives it
 * (NOTIFICATION_KIND_SPECS' fallback); choices.test.js checks they agree.
 */
export const KIND_DEFAULTS = Object.freeze({
  critical_action: 'off',
  due_actions: 'weekly',
  weekly_actions: 'weekly',
  run_finished: 'off',
  audit_finished: 'off',
  score_dropped: 'off',
  drafts_review: 'weekly',
  ai_usage: 'on',
});

/** A database without 00554 yet: nobody has saved, everyone has the default. */
const MISSING_TABLE = new Set(['42P01', 'PGRST205']);

/**
 * @param {string} organizationId
 * @param {string} brandId
 * @param {keyof typeof KIND_DEFAULTS} kind
 * @returns {Promise<Map<string, string>>} person id → their choice ('off' included)
 */
export async function brandAudience(organizationId, brandId, kind) {
  const readers = await brandReaders(organizationId, [brandId]);
  const choices = new Map([...readers.keys()].map((id) => [id, KIND_DEFAULTS[kind]]));
  if (choices.size === 0) return choices;
  const { data, error } = await supabaseAdmin
    .from('notification_preferences')
    .select('user_id, brand_id, frequency')
    .eq('organization_id', organizationId)
    .eq('kind', kind);
  if (error) {
    if (MISSING_TABLE.has(error.code)) {
      logger.warn({ code: error.code }, '[notifications] no notification_preferences table yet');
      return choices;
    }
    throw new Error(`notification_preferences: ${error.message}`);
  }
  const own = new Map();
  const all = new Map();
  for (const row of data ?? []) {
    if (row.brand_id === null) all.set(row.user_id, row.frequency);
    else if (row.brand_id === brandId) own.set(row.user_id, row.frequency);
  }
  for (const id of choices.keys()) {
    const choice = own.get(id) ?? all.get(id);
    if (choice) choices.set(id, choice);
  }
  return choices;
}

/**
 * Of `orgIds`, the workspaces whose plan is active or trialing, as the Pulse
 * checks (self-hosted, every one): a canceled workspace is mailed nothing.
 * @param {Iterable<string>} orgIds
 * @returns {Promise<Set<string>>}
 */
export async function activeOrgIds(orgIds) {
  const ids = [...new Set(orgIds)];
  if (ids.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, subscription_status')
    .in('id', ids);
  if (error) throw new Error(`organizations: ${error.message}`);
  return new Set(
    (data ?? [])
      .filter((org) => isSubscriptionActive(org.subscription_status))
      .map((org) => org.id),
  );
}

/** `groups` (each with its organizationId) of workspaces that are active. */
export async function ofActiveWorkspaces(groups) {
  const active = await activeOrgIds(groups.map((group) => group.organizationId));
  return groups.filter((group) => active.has(group.organizationId));
}

/** The ids of the people whose choice is `frequency`. */
export function choosing(audience, frequency) {
  return [...audience].filter(([, choice]) => choice === frequency).map(([id]) => id);
}
