'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FormSwitch } from '@/components/chat/agents/agent-form-triggers';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Link } from '@/i18n/navigation';

/**
 * Settings › Chat's Memory switch (CHAT-14 item 24; W3-12b): the
 * workspace's, an Admin's. Off, no one's notes are used and Memory is
 * hidden; each person's own "Use memory" is on the Memory page. Anyone else
 * sees whether it is on. Read and kept through /api/chat/memory.
 */
export function MemorySwitchRow() {
  const t = useTranslations('chatMemory.page');
  const tSwitches = useTranslations('chatAccess.settings.switches');
  const tActions = useTranslations('readOnly.actions');
  const { guard } = useUpgradeGate();
  const [state, setState] = useState<{ on: boolean; admin: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void fetch('/api/chat/memory')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { switches?: { workspace: boolean }; canSwitchWorkspace?: boolean } | null) => {
        if (live && body?.switches) {
          setState({ on: body.switches.workspace, admin: body.canSwitchWorkspace === true });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const change = guard(
    async (next: boolean) => {
      setState((was) => (was ? { ...was, on: next } : was));
      const res = await fetch('/api/chat/memory/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: next }),
      }).catch(() => null);
      if (res?.ok) return;
      setState((was) => (was ? { ...was, on: !next } : was));
      toast.error(t('failed'));
    },
    { action: tActions('changeChatSettings') },
  );

  if (!state) return null;
  return (
    <li data-slot="memory-switch" className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t('switchLabel')}</span>
        <span className="block text-xs text-muted-foreground">
          {t('switchNote')}{' '}
          <Link
            href="/dashboard/chat/memory"
            data-action="memory.open"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {t('title')}
          </Link>
        </span>
      </span>
      {state.admin ? (
        <FormSwitch
          checked={state.on}
          label={t('switchLabel')}
          action="chatSettings.memory"
          onChange={(next) => void change(next)}
        />
      ) : (
        <span className="text-xs font-medium">{state.on ? tSwitches('on') : tSwitches('off')}</span>
      )}
    </li>
  );
}
