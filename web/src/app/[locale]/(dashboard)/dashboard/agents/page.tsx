import { notFound } from 'next/navigation';
import { AgentsList } from '@/components/chat/agents/agents-list';
import { chatPageOpen } from '../chat/_chat-page-access';

/**
 * Agent Center (CHAT-21 §B; governance mockup #g-agents): the agents the
 * person may see, by tab, with their AI use (CHAT-27 item 24). Its own item
 * under Chat on the menu, no longer inside Chat; /dashboard/chat/agents
 * redirects here. Only with the new Chat on for the workspace
 * (CHAT_AGENTIC), as Chat's pages; otherwise not found.
 */
export default async function AgentCenterPage() {
  if (!(await chatPageOpen())) notFound();
  return <AgentsList />;
}
