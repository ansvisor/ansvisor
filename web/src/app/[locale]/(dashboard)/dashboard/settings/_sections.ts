import { qualityPhase } from '@/lib/content/quality';
import { whiteLabelOffered } from '@/lib/white-label/kit';

/**
 * Settings' sections, each with its own address (/dashboard/settings/<id>),
 * so a page or an e-mail can link straight to one: the Chat page links to AI
 * Providers when no key is set.
 */
export const SETTINGS_SECTIONS = [
  // Yours (owner, 2026-11-09: personal, then the workspace and its bill, then
  // people and access, Chat, connections and keys, then brand and content).
  'account',
  'notifications',
  // The workspace and its plan.
  'organization',
  'billing',
  // People and access. Team: its own section while the new Chat is off. With
  // it on, Team is in Team, roles & access (owner, 2026-11-09), and /team
  // opens that.
  'team',
  // Roles & access (CHAT-20 §4a): listed only while the new Chat is on, as
  // Team, roles & access: the team, its invitations, the roles and access.
  'roles-access',
  'menu-access',
  // Settings › Chat (CHAT-20 §5): listed only while the new Chat is on.
  'chat',
  // Connections and keys.
  'integrations',
  'ai-providers',
  'api-keys',
  // Brand and content. White label (00429): where a plan can have it (whiteLabelOffered).
  'white-label',
  'content',
  'authors',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Sections only Ansvisor Cloud has: self-host sets its AI key in env, and has no billing. */
const CLOUD_ONLY: readonly SettingsSection[] = ['ai-providers', 'billing'];

/** Content Editor Quality's Authors (CE-037): only while its phase is live. */
const hasAuthors = () => qualityPhase() >= 1;
/** Content's settings (Quality's hand-off, CE-051): with Quality's phase 2. */
const hasContent = () => qualityPhase() >= 2;

/** Older names an address may still carry: ?tab=project, ?tab=agent. */
const RENAMED: Record<string, SettingsSection> = {
  project: 'organization',
  agent: 'ai-providers',
};

/**
 * The section an address names (the path's last part, or the older ?tab=),
 * or Account for none, an unknown one, or one this install doesn't have.
 */
export function resolveSettingsSection(
  value: string | null | undefined,
  { isCloud }: { isCloud: boolean },
): SettingsSection {
  const name = value ? (RENAMED[value] ?? value) : null;
  const section = SETTINGS_SECTIONS.find((s) => s === name);
  if (!section || !hasSettingsSection(section, { isCloud })) return 'account';
  return section;
}

/** Whether this install shows the section. */
export function hasSettingsSection(section: SettingsSection, { isCloud }: { isCloud: boolean }) {
  if (section === 'authors' && !hasAuthors()) return false;
  if (section === 'content' && !hasContent()) return false;
  if (section === 'white-label' && !whiteLabelOffered({ isCloud })) return false;
  return isCloud || !CLOUD_ONLY.includes(section);
}

/**
 * The address of a section, from the current path: the locale prefix it may
 * carry is kept.
 */
export function settingsSectionPath(pathname: string, section: SettingsSection): string {
  const base = pathname.replace(/\/dashboard\/settings(\/.*)?$/, '/dashboard/settings');
  return `${base}/${section}`;
}

/**
 * Where the team is managed (owner, 2026-11-09): Team, roles & access with
 * the new Chat on, else Team. /dashboard/settings/team opens it either way.
 */
export function teamSection(chatAgentic: boolean): SettingsSection {
  return chatAgentic ? 'roles-access' : 'team';
}
