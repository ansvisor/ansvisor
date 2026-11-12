import { DOT_PRIORITY, type DotColour } from '@/lib/menu-dots';
import type { NavArea } from '@/lib/user-brand-state';

/**
 * Settings' dots (the account menu, its Settings tabs, the footer's avatar
 * and gear), in the menu's dot language: green, new info; yellow, needs you;
 * red "!", broke and stays until fixed. For admins and managers only.
 *
 *   Members & invites   green   people joined since the person last opened Members
 *                       yellow  an invite expired without being accepted; the seat limit is reached
 *   Integrations        red     a sign-in or CMS site stopped working (disconnected, auth_failed)
 *                       green   a teammate connected one since the last visit
 *   API & MCP           green   an MCP client the person connected since the last visit
 *   Plans & billing     red     a payment failed (past_due, unpaid)
 *                       yellow  the trial ends in 3 days or less
 *
 * The pure half: what lights a dot from one read (getSettingsState) and the
 * plan the dashboard already has. The visits are user_brand_state.nav_seen
 * keys on the brand open now (nav_seen is per brand; these places are the
 * workspace's).
 */

export type SettingsDotPlace = 'members' | 'integrations' | 'api' | 'billing';

/** The places whose green opening them clears, and their nav_seen key. */
export const SETTINGS_SEEN_KEYS = {
  members: 'settings/members',
  integrations: 'settings/integrations',
  api: 'settings/api',
} as const satisfies Partial<Record<SettingsDotPlace, NavArea>>;

export type SettingsSeenPlace = keyof typeof SETTINGS_SEEN_KEYS;

/** A place never opened counts what happened in the last week as new. */
export const FIRST_VISIT_WINDOW_MS = 7 * 86_400_000;

/** Plans & billing turns yellow this many days before the trial ends. */
export const TRIAL_ENDING_DAYS = 3;

/** One read of what the dots compare (getSettingsState); null parts weren't read. */
export interface SettingsState {
  /** People who joined since the last visit to Members: how many, the newest names, the newest time. */
  joined: { count: number; names: string[]; at: string } | null;
  /** Pending invites past their expiry. */
  expiredInvites: number;
  /** Members and pending invites fill the plan's seats. */
  seatsFull: boolean;
  /** A sign-in or CMS site that stopped working. */
  brokenIntegration: { provider: string; label: string | null } | null;
  /** The newest connection a teammate made since the last visit to Integrations. */
  newIntegration: { provider: string; label: string | null; by: string | null; at: string } | null;
  /** The newest MCP client the person connected since the last visit to API & MCP. */
  newClient: { name: string; at: string } | null;
}

export type SettingsDotReason =
  | { kind: 'joined'; count: number; names: string[] }
  | { kind: 'inviteExpired'; count: number }
  | { kind: 'seatsFull' }
  | { kind: 'integrationBroken'; provider: string }
  | { kind: 'integrationNew'; provider: string; by: string | null }
  | { kind: 'clientNew'; name: string }
  | { kind: 'trialEnding'; days: number }
  | { kind: 'paymentFailed' };

export interface SettingsDot {
  place: SettingsDotPlace;
  colour: DotColour;
  reason: SettingsDotReason;
}

export type SettingsDots = Partial<Record<SettingsDotPlace, SettingsDot>>;

/** The plan, as the dashboard has it (usePlanContext). */
export interface BillingFacts {
  isCloud: boolean;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
}

/** Whole days left until `end`, rounded up; 0 once it passed. */
export function daysUntil(end: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(end) - now.getTime()) / 86_400_000));
}

/** A connection's name: the CMS site's label, else the provider's. */
export function integrationName(provider: string, label: string | null): string {
  const known: Record<string, string> = {
    'google-search-console': 'Search Console',
    'google-analytics': 'Google Analytics',
    'google-merchant-center': 'Merchant Center',
    slack: 'Slack',
    hubspot: 'HubSpot',
    wordpress: 'WordPress',
    webflow: 'Webflow',
    wix: 'Wix',
    framer: 'Framer',
  };
  if (known[provider]) return known[provider];
  return label?.trim() || provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Opened here after `at`: its green is gone before the next read says so. */
const openedSince = (opened: string | undefined, at: string) =>
  opened !== undefined && Date.parse(opened) >= Date.parse(at);

/**
 * The dots, for an admin or manager: one per place, the strongest of its
 * own (red, yellow, green). `opened` is when each place was opened on this
 * device since the read.
 */
export function settingsDots(
  state: SettingsState | null,
  opened: Partial<Record<SettingsSeenPlace, string>>,
  billing: BillingFacts,
  now: Date,
): SettingsDots {
  const dots: SettingsDots = {};
  if (state) {
    if (state.expiredInvites > 0) {
      dots.members = {
        place: 'members',
        colour: 'yellow',
        reason: { kind: 'inviteExpired', count: state.expiredInvites },
      };
    } else if (state.seatsFull) {
      dots.members = { place: 'members', colour: 'yellow', reason: { kind: 'seatsFull' } };
    } else if (state.joined && !openedSince(opened.members, state.joined.at)) {
      const { count, names } = state.joined;
      dots.members = {
        place: 'members',
        colour: 'green',
        reason: { kind: 'joined', count, names },
      };
    }
    if (state.brokenIntegration) {
      const { provider, label } = state.brokenIntegration;
      dots.integrations = {
        place: 'integrations',
        colour: 'red',
        reason: { kind: 'integrationBroken', provider: integrationName(provider, label) },
      };
    } else if (state.newIntegration && !openedSince(opened.integrations, state.newIntegration.at)) {
      const { provider, label, by } = state.newIntegration;
      dots.integrations = {
        place: 'integrations',
        colour: 'green',
        reason: { kind: 'integrationNew', provider: integrationName(provider, label), by },
      };
    }
    if (state.newClient && !openedSince(opened.api, state.newClient.at)) {
      dots.api = {
        place: 'api',
        colour: 'green',
        reason: { kind: 'clientNew', name: state.newClient.name },
      };
    }
  }
  if (billing.isCloud) {
    const status = billing.subscriptionStatus;
    if (status === 'past_due' || status === 'unpaid') {
      dots.billing = { place: 'billing', colour: 'red', reason: { kind: 'paymentFailed' } };
    } else if (status === 'trialing' && billing.trialEndsAt) {
      const days = daysUntil(billing.trialEndsAt, now);
      if (days <= TRIAL_ENDING_DAYS) {
        dots.billing = {
          place: 'billing',
          colour: 'yellow',
          reason: { kind: 'trialEnding', days },
        };
      }
    }
  }
  return dots;
}

/** The one dot the footer's avatar and gear show: red, then yellow, green, grey. */
export function strongestSettingsDot(dots: SettingsDots): SettingsDot | null {
  const all = Object.values(dots).filter((dot): dot is SettingsDot => !!dot);
  for (const colour of DOT_PRIORITY) {
    const found = all.find((dot) => dot.colour === colour);
    if (found) return found;
  }
  return null;
}
