import { notFound } from 'next/navigation';
import { AgentForm } from '@/components/chat/agents/agent-form';
import { readAgentFormSetup } from '@/lib/chat/agent-form-setup';
import { presetOnInstall, readyPreset } from '@/lib/chat/agents/catalog';
import { chatPageOpen } from '../../chat/_chat-page-access';

/**
 * Create an agent (CHAT-21 §D; governance mockup #g-agent-new): four steps
 * and Save as draft or Turn on. `?skill=winback` starts from a skill (a
 * skill's Create agent); `?preset=weekly-report` from a ready-to-use agent
 * (Agent Center › Ready to use), filled in and saved only by the person.
 * Only with the new Chat on for the workspace (CHAT_AGENTIC); otherwise not
 * found. Analysts and Agency partners see a read-only line instead of the
 * form.
 */
export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string | string[]; preset?: string | string[] }>;
}) {
  if (!(await chatPageOpen())) notFound();
  const setup = await readAgentFormSetup();
  if (!setup) notFound();
  const { skill, preset } = await searchParams;
  const ready = readyPreset(typeof preset === 'string' ? preset : null);
  // A preset whose primary skill is off for this workspace (the AEO Operator without
  // CHAT_OPERATOR for it) opens nothing: the setup lists the skills that are off for it.
  const offered = ready && !(setup.offSkills ?? []).includes(ready.skills[0] ?? '') ? ready : null;
  return (
    <AgentForm
      setup={setup}
      initialSkill={typeof skill === 'string' ? skill : null}
      preset={offered && presetOnInstall(offered)}
    />
  );
}
