import type { ChatStartAudience } from '@/lib/chat/start-audience';

/**
 * Where a signed-in user starts (New Ansvisor, AC-ALT2 §3): the Action
 * Center's Actions, where Getting started and the actions live. The free
 * trial and the demo start on Chat Home instead (landingPageFor). /dashboard
 * sends each person to theirs, and sign-in, onboarding, payment and a new
 * brand land on /dashboard; /dashboard/action-center redirects here.
 */
export const DASHBOARD_HOME = '/dashboard/action-center/actions';

/** Chat Home: where the free trial and the demo start (owner decision 2026-11-06). */
export const CHAT_HOME = '/dashboard/chat';

/**
 * The page a person lands on: Chat Home for the free trial and the demo
 * (ChatStartAudience) while the new Chat is on for their workspace
 * (CHAT_AGENTIC), so they meet Chat and its tour first; the Action Center
 * for everyone else.
 */
export function landingPageFor({
  chatOn,
  audience,
}: {
  chatOn: boolean;
  audience: ChatStartAudience | null;
}): string {
  return chatOn && audience ? CHAT_HOME : DASHBOARD_HOME;
}

/** Whether a sidebar item leads to the home page (it or a parent of it). */
export function isDashboardHomeItem(href: string): boolean {
  return DASHBOARD_HOME === href || DASHBOARD_HOME.startsWith(`${href}/`);
}
