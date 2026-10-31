import { notFound } from 'next/navigation';
import { AgentForm } from '@/components/chat/agents/agent-form';
import { readAgentFormSetup } from '@/lib/chat/agent-form-setup';
import { chatPageOpen } from '../../_chat-page-access';

/**
 * Create an agent (CHAT-21 §D; governance mockup #g-agent-new): four steps
 * and Save as draft or Turn on. `?skill=winback` starts from a skill (a
 * skill's Create agent). Only with the new Chat on for the workspace
 * (CHAT_AGENTIC); otherwise not found. Analysts and Agency partners see a
 * read-only line instead of the form.
 */
export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string | string[] }>;
}) {
  if (!(await chatPageOpen())) notFound();
  const setup = await readAgentFormSetup();
  if (!setup) notFound();
  const { skill } = await searchParams;
  return <AgentForm setup={setup} initialSkill={typeof skill === 'string' ? skill : null} />;
}
