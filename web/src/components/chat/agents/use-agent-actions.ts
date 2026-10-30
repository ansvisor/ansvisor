import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import type { AgentDetail } from '@/lib/chat/agents';
import type { ChatDenialCard } from '@/lib/chat/events';
import { nextRunOf } from '@/lib/chat/agent-view';
import {
  changeAgent,
  duplicateAgent,
  runAgentNow,
  type AgentChange,
  type AgentRefused,
} from './agent-requests';
import type { AgentWords } from './agent-words';

/** What a button does to an agent. */
export type AgentButton = AgentChange | 'run' | 'duplicate';

const CHANGE_TOAST: Record<Exclude<AgentChange, 'activate'>, string> = {
  pause: 'toast.paused',
  resume: 'toast.resumed',
  archive: 'toast.archived',
  restore: 'toast.restored',
  'take-over': 'toast.tookOver',
};

/** What the read-only workspace's upgrade dialog names: the server's words for the ask. */
const ASKED: Record<AgentButton, string> = {
  activate: 'activate',
  pause: 'pause',
  resume: 'resume',
  archive: 'archive',
  restore: 'restore',
  'take-over': 'takeOver',
  run: 'run',
  duplicate: 'duplicate',
};

/**
 * The agents' buttons (CHAT-21 §B item 7, §C item 9, §G): one call each,
 * a toast when it's done, and when the server refuses, its answer —
 * the out-of-permission card (CHAT-20 §4c) for a role, the plan or a
 * Settings › Chat switch, the upgrade dialog for a read-only workspace,
 * or its words in a toast. A read-only workspace gets the dialog before
 * anything is sent. One button at a time per agent.
 */
export function useAgentActions(
  words: AgentWords,
  handlers: {
    /** The agent's detail after a change of state. */
    onChanged?: (agent: AgentDetail) => void;
    /** Runs were queued. */
    onRan?: (agentId: string) => void;
    /** The copy, a draft. */
    onDuplicated?: (copy: AgentDetail) => void;
  } = {},
) {
  const t = useTranslations('chatAgents');
  const { isLocked, openUpgrade } = useUpgradeGate();
  const [busy, setBusy] = useState<{ id: string; button: AgentButton } | null>(null);
  const [denial, setDenial] = useState<ChatDenialCard | null>(null);
  const { onChanged, onRan, onDuplicated } = handlers;

  const refused = useCallback(
    (button: AgentButton, answer: AgentRefused) => {
      if (answer.denial) setDenial(answer.denial);
      else if (answer.failure === 'subscription') openUpgrade(t(`asked.${ASKED[button]}`));
      else toast.error(answer.message ?? t('toast.failed'));
    },
    [openUpgrade, t],
  );

  const act = useCallback(
    async (agent: { id: string; name: string }, button: AgentButton) => {
      if (busy) return;
      setDenial(null);
      if (isLocked) {
        openUpgrade(t(`asked.${ASKED[button]}`));
        return;
      }
      setBusy({ id: agent.id, button });
      try {
        if (button === 'run') {
          const answer = await runAgentNow(agent.id);
          if (!answer.ok) return refused(button, answer);
          const fresh = answer.runs.filter((run) => !run.repeated);
          if (fresh.length === 0) toast(t('toast.ranAgain'));
          else toast(t('toast.ran', { count: fresh.length, brand: fresh[0].brand }));
          onRan?.(agent.id);
          return;
        }
        if (button === 'duplicate') {
          const answer = await duplicateAgent(agent.id);
          if (!answer.ok) return refused(button, answer);
          toast(t('toast.duplicated', { name: answer.agent.name }));
          onDuplicated?.(answer.agent);
          return;
        }
        const answer = await changeAgent(agent.id, button);
        if (!answer.ok) return refused(button, answer);
        if (button === 'activate') {
          const next = nextRunOf(answer.agent.triggers);
          toast(
            next.kind === 'at'
              ? t('toast.activated', { when: words.when(next.at) })
              : next.kind === 'event'
                ? t('toast.activatedEvent')
                : t('toast.activatedManual'),
          );
        } else {
          toast(t(CHANGE_TOAST[button], { name: answer.agent.name }));
        }
        onChanged?.(answer.agent);
      } finally {
        setBusy(null);
      }
    },
    [busy, isLocked, openUpgrade, refused, t, words, onChanged, onRan, onDuplicated],
  );

  const isBusy = (id: string, button?: AgentButton) =>
    !!busy && busy.id === id && (!button || busy.button === button);

  return { act, isBusy, denial, clearDenial: () => setDenial(null) };
}
