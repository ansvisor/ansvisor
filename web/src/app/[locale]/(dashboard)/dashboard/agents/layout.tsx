import type { ReactNode } from 'react';
import { AgentsSeen } from '@/components/chat/agents/agents-seen';
import { AgentsTabFrame } from '@/components/action-center/agents-tab-frame';

/**
 * Action Center › Agents' pages, under the Action Center's header and tabs
 * (AgentsTabFrame). Opening any of them counts as having seen it, so the
 * chat menu's "New" beside Agents goes, whichever way it was opened.
 */
export default function AgentCenterLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AgentsSeen />
      <AgentsTabFrame>{children}</AgentsTabFrame>
    </>
  );
}
