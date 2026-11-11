import { notFound } from 'next/navigation';
import { AgentCenter } from '@/components/chat/agents/agent-center';
import { AGENT_PRESETS, presetOnInstall } from '@/lib/chat/agents/catalog';
import { readMyWorkAreas, readPresetLocks } from '@/lib/chat/agents/ready-setup';
import { chatPageOpen } from '../chat/_chat-page-access';

/**
 * Action Center › Agents (CHAT-21 §B; AGENTS plan §1): Your agents, the
 * agents the person may see with their AI use (CHAT-27 item 24), and Ready
 * to use, the ready-to-use agents with the plan locks of this workspace and
 * the person's work areas (theirs first). /dashboard/chat/agents redirects
 * here. Only with the new Chat on for the workspace (CHAT_AGENTIC), as
 * Chat's pages; otherwise not found.
 */
export default async function AgentCenterPage() {
  if (!(await chatPageOpen())) notFound();
  const [locks, workAreas] = await Promise.all([readPresetLocks(), readMyWorkAreas()]);
  return (
    <AgentCenter
      locks={locks}
      workAreas={workAreas}
      // As this install offers them: a skill behind a flag that is off is left out.
      presets={AGENT_PRESETS.map(presetOnInstall)}
    />
  );
}
