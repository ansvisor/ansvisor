'use client';

import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, X } from 'lucide-react';
import { AskAdminButton } from '@/components/chat-access/ask-admin-button';
import { Link } from '@/i18n/navigation';
import { track } from '@/lib/analytics';
import { presetCardHref } from '@/lib/chat/agents/catalog';
import type { AgentForYou } from '@/lib/chat/agents-for-you';

/**
 * "Agents for you" on Chat Home (AGENTS plan §8 and #11, its new member
 * half), in New for you's pattern (CHAT-24 §4f, mockup `.nfy`): the 3 to 5
 * ready-to-use agents for the brand's site type and the person's work
 * areas, each with what it does and why it fits. Admins and Managers open
 * its card in Agent Center › Ready to use, where Use this agent and Turn on
 * stay their clicks; everyone else (CHAT-21 §K item 51) sees the cards with
 * Ask your Admin. Hide keeps it hidden on every device. Nothing runs here.
 */
export function AgentsForYou({
  agents,
  canTurnOn,
  onHide,
}: {
  agents: readonly AgentForYou[];
  canTurnOn: boolean;
  onHide: () => void;
}) {
  const t = useTranslations('chatShell.home.agentsForYou');
  const tAgents = useTranslations('chatAgents');
  const titleId = useId();
  if (agents.length === 0) return null;

  const body = (agent: AgentForYou, name: string): ReactNode => (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="rounded-md border px-1.5 py-px text-[10.5px] tracking-[.05em] text-muted-foreground uppercase">
          {t('agent')}
        </span>
        <b className="truncate text-[13px] font-semibold">{name}</b>
      </span>
      <span className="text-[12.5px] leading-[1.4] text-muted-foreground">
        {tAgents(`presets.${agent.id}.description`)}
      </span>
      <span data-slot="agent-for-you-fit" className="text-[11.5px] text-muted-foreground">
        {agent.fit ? tAgents(`ready.fit.${agent.fit}`) : t('everyBrand')}
      </span>
    </>
  );

  return (
    <section data-slot="agents-for-you" aria-labelledby={titleId} className="@container mb-4">
      <div className="mx-0.5 mb-1 flex items-center gap-2">
        <h2
          id={titleId}
          className="text-[11px] font-normal tracking-[.4px] text-muted-foreground uppercase"
        >
          {t('title')}
        </h2>
        <button
          type="button"
          data-action="agentsForYou.hide"
          aria-label={t('hide')}
          title={t('hide')}
          onClick={() => {
            track('chat_agents_for_you_hidden', { count: agents.length });
            onHide();
          }}
          className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <p className="mx-0.5 mb-2 text-[12.5px] text-muted-foreground">
        {t(canTurnOn ? 'note' : 'noteAsk')}
      </p>
      <ul className="grid gap-2 @lg:grid-cols-2">
        {agents.map((agent) => {
          const name = tAgents(`presets.${agent.id}.name`);
          return (
            <li key={agent.id} data-slot="agent-for-you" data-preset={agent.id} className="flex">
              {canTurnOn ? (
                <Link
                  href={presetCardHref(agent.id)}
                  data-action="agentsForYou.open"
                  aria-label={t('openLabel', { name })}
                  onClick={() =>
                    track('chat_agents_for_you_opened', { preset: agent.id, fit: agent.fit })
                  }
                  className="flex w-full flex-col gap-1 rounded-xl border bg-card px-3 py-2.5 text-left outline-none hover:border-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {body(agent, name)}
                  <span className="mt-0.5 inline-flex items-center gap-0.5 text-[12px] font-medium text-foreground">
                    {t('open')}
                    <ChevronRight className="size-3.5" aria-hidden />
                  </span>
                </Link>
              ) : (
                <div className="flex w-full flex-col items-start gap-1 rounded-xl border bg-card px-3 py-2.5">
                  {body(agent, name)}
                  <AskAdminButton asked={t('asked', { name })} ruleKind="role" className="mt-1" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
