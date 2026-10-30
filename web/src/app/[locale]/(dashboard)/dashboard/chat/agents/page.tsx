import { notFound } from 'next/navigation';
import { AgentsList } from '@/components/chat/agents/agents-list';
import { chatPageOpen } from '../_chat-page-access';

/**
 * Chat › Agents (CHAT-21 §B; governance mockup #g-agents): the agents the
 * person may see, by tab, with their AI use (CHAT-27 item 24). Only with
 * the new Chat on for the workspace (CHAT_AGENTIC); otherwise not found.
 */
export default async function ChatAgentsPage() {
  if (!(await chatPageOpen())) notFound();
  return <AgentsList />;
}
