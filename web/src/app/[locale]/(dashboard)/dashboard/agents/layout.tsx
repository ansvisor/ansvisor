import type { ReactNode } from 'react';
import { AgentsSeen } from '@/components/chat/agents/agents-seen';
import { AgentsTabFrame } from '@/components/action-center/agents-tab-frame';
import { simpleNavEnabled } from '@/lib/simple-nav/flag';

/**
 * Agent Center's pages: opening any of them counts as having seen it, so the
 * chat menu's "New" beside Agent Center goes, whichever way it was opened.
 * With the simplified layout on (SIMPLE_NAV) they are Action Center › Agents,
 * under the Action Center's header and tabs (AgentsTabFrame).
 */
export default function AgentCenterLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AgentsSeen />
      {simpleNavEnabled() ? <AgentsTabFrame>{children}</AgentsTabFrame> : children}
    </>
  );
}
