/** Tool policy in Chat: the same rules as Settings › Chat (/dashboard/settings/chat), which stays. */
export const CHAT_POLICY_HREF = '/dashboard/chat/policy';

/**
 * Chat's Settings tabs (owner request, 16 Nov 2026): General, then Activity,
 * What Chat can do and Tool policy, in the chat menu's order and with its
 * labels (chatShell.menu.{id}). The chat menu's Settings list and the
 * Settings page's own left navigation both draw this list, so they can't
 * drift apart. Each tab is its own route under the Settings frame (the
 * chat/(settings) route group's layout), so its address opens it there from
 * a deep link, the chat menu or Help.
 *
 * Who sees a tab: everyone who can open its page. All four open for every
 * role while the new Chat is on for the workspace (CHAT_AGENTIC), and none
 * while it is off, when the frame isn't drawn. What a role may do on a tab
 * stays the page's own: Activity shows a person their own changes and an
 * Admin the workspace's; Tool policy is read by everyone and changed only
 * by Admins (the server actions check it).
 */
export const CHAT_SETTINGS_TABS = [
  { id: 'general', href: '/dashboard/chat/settings', menuAction: 'chatMenu.openSettings' },
  { id: 'activity', href: '/dashboard/chat/activity', menuAction: 'chatMenu.openActivity' },
  {
    id: 'capabilities',
    href: '/dashboard/chat/capabilities',
    menuAction: 'chatMenu.openCapabilities',
  },
  { id: 'policy', href: CHAT_POLICY_HREF, menuAction: 'chatMenu.openPolicy' },
] as const;

export type ChatSettingsTab = (typeof CHAT_SETTINGS_TABS)[number]['id'];

/** The Settings tab an address opens, without its query or a trailing slash; null for none. */
export function chatSettingsTabOf(pathname: string): ChatSettingsTab | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  return CHAT_SETTINGS_TABS.find((tab) => tab.href === path)?.id ?? null;
}
