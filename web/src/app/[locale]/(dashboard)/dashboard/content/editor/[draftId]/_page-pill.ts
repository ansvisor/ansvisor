import type { StatusPillState } from '@/components/agentic/status-pill';
import type { DraftStatus } from '@/lib/content/drafts';

/**
 * The page's pill beside its title, with the new Chat on (Chat agentic plan
 * §2): as a chat's own. Working while the agent works on it, Needs you while
 * its suggestions wait, Done once published, Ready once marked, else Draft.
 */
export function pagePillOf(page: {
  working: boolean;
  openSuggestions: number;
  status: DraftStatus;
}): StatusPillState {
  if (page.working) return 'working';
  if (page.openSuggestions > 0) return 'needsYou';
  if (page.status === 'published') return 'done';
  if (page.status === 'ready') return 'ready';
  return 'draft';
}
