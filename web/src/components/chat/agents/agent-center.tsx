'use client';

import { useContext, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Plus, Sparkles } from 'lucide-react';
import { AskAdminButton } from '@/components/chat-access/ask-admin-button';
import { RoleContext } from '@/components/providers/role-provider';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import { track } from '@/lib/analytics';
import type { AgentPreset, PresetLock } from '@/lib/chat/agents/catalog';
import { writesAgents } from '@/lib/chat/agent-view';
import { composeHref } from '@/lib/chat/compose-param';
import { isDemoSelected } from '@/lib/demo/demo-brand';
import { useBrandStore } from '@/stores/use-brand-store';
import { AgentsList } from './agents-list';
import { ChatMadeAgents } from './chat-made-agents';
import { useAgentWords } from './agent-words';
import { ReadyAgents } from './ready-agents';

/**
 * Action Center › Agents (CHAT-21 §B; AGENTS plan §1; mockup Agents.dc.html),
 * under the Action Center's header and tabs: no title or tabs of its own.
 * **Your agents** first, the agents the person may see (agents-list.tsx),
 * with Mine · Workspace · Paused · Archived inside it and the count of
 * agents on, then the recurring work made in Chat under its agents
 * (chat-made-agents.tsx). **Ready to use** under it, the ready-to-use agents
 * (ready-agents.tsx). Ask Chat to make one opens Chat with its box filled
 * (the person reads it and sends it); New agent stays, beside it. Analysts
 * and Agency partners read, with a line that says so and Ask your Admin.
 */

export function AgentCenter({
  locks = {},
  workAreas = [],
  presets,
  now: nowProp,
  timeZone,
}: {
  /** Ready presets whose mode the workspace's plan or Settings › Chat keeps closed. */
  locks?: Record<string, PresetLock>;
  /** The person's work areas: Ready to use puts the agents made for them first. */
  workAreas?: readonly string[];
  /** The ready-to-use agents as this install offers them (presetOnInstall); the catalog's otherwise. */
  presets?: readonly AgentPreset[];
  now?: Date;
  timeZone?: string;
}) {
  const t = useTranslations('chatAgents.center');
  const tList = useTranslations('chatAgents.list');
  const tRoles = useTranslations('chatAccess.roleNames');
  const { role } = useContext(RoleContext);
  const writer = writesAgents(role);
  const [summary, setSummary] = useState<{ active: number; activeLimit: number | null } | null>(
    null,
  );
  // The demo brand's sample agents never count toward the plan (00475): beside
  // them its count would read 0, so on the demo brand there is none.
  const demoSelected = useBrandStore(isDemoSelected);
  // The cards' triggers read the same on any clock: one for the page.
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const words = useAgentWords(now, timeZone);

  const count = summary && !demoSelected && (
    <span
      data-slot="agents-count"
      title={tList('activeTip', {
        active: summary.active,
        limit: summary.activeLimit === null ? 'none' : String(summary.activeLimit),
      })}
      className="rounded-md bg-muted px-1.5 text-[11.5px] font-medium text-foreground/70 tabular-nums"
    >
      {summary.active}
    </span>
  );
  const readOnly = !writer && (
    <div
      role="note"
      data-slot="agents-read-only"
      className="mb-3 grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border bg-muted/50 px-3.5 py-2.5 text-[13px]"
    >
      <Lock className="size-4 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <b className="font-semibold">{tList('readOnly.title', { role: tRoles(role) })}</b>
        <em className="ml-1.5 text-muted-foreground not-italic">{tList('readOnly.detail')}</em>
      </div>
      <AskAdminButton asked={tList('readOnly.asked')} ruleKind="role" />
    </div>
  );
  const ready = (
    <ReadyAgents
      locks={locks}
      writer={writer}
      words={words}
      workAreas={workAreas}
      presets={presets}
    />
  );
  const yours = <AgentsList now={nowProp} timeZone={timeZone} onSummary={setSummary} />;

  return (
    <div className="max-w-[1100px]" data-layout="action-center">
      {writer && (
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <Link
            href="/dashboard/agents/new"
            data-action="agents.new"
            className={buttonVariants({ variant: 'ghost' })}
          >
            <Plus aria-hidden />
            {tList('newAgent')}
          </Link>
          <Link
            href={composeHref(t('askChatText'))}
            data-action="agents.askChat"
            title={t('askChatTip')}
            onClick={() => track('agents_ask_chat_clicked')}
            className={buttonVariants({ variant: 'outline' })}
          >
            <Sparkles aria-hidden />
            {t('askChat')}
          </Link>
        </div>
      )}
      {readOnly}
      <section
        aria-labelledby="agent-center-yours-title"
        data-slot="agent-center-yours"
        className="mb-8"
      >
        <h2
          id="agent-center-yours-title"
          className="flex items-center gap-2 text-[17px] font-semibold"
        >
          {t('tabs.yours')}
          {count}
        </h2>
        {yours}
        {/* Recurring work made in Chat, as agents of its own kind (owner's decision, option A). */}
        <ChatMadeAgents now={nowProp} />
      </section>
      <section aria-labelledby="agent-center-ready-title" data-slot="agent-center-ready">
        <h2 id="agent-center-ready-title" className="text-[17px] font-semibold">
          {t('tabs.ready')}
        </h2>
        {ready}
      </section>
    </div>
  );
}
