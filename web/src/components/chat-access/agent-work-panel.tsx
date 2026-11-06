'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { AGENT_WORK, type AgentWork, type AgentWorkView } from '@/lib/chat/agent-work';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * "Who starts agent work?" (AC-011, ROADMAP mockup screen 3): the two
 * choices, the last change and, for an Admin, Save. Everyone else reads it.
 * The gear on Action Center › Today and Settings › Chat show the same panel.
 */
export function AgentWorkPanel({
  view,
  saving,
  onSave,
}: {
  view: AgentWorkView;
  saving: boolean;
  onSave: (value: AgentWork) => void;
}) {
  const t = useTranslations('actionCenter.agentWork');
  const format = useFormatter();
  const [picked, setPicked] = useState<AgentWork>(view.value);

  const change = view.lastChange;
  const footer = change
    ? t('changedBy', {
        name: change.byName ?? t('someone'),
        date: format.dateTime(new Date(change.at), {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      })
    : t('neverChanged');

  return (
    <div className="grid gap-2 text-sm">
      <p className="font-medium">{t('question')}</p>
      <fieldset aria-label={t('question')} className="grid gap-2">
        {AGENT_WORK.map((choice) => {
          const on = picked === choice;
          return (
            <label
              key={choice}
              className={cn(
                'flex gap-2.5 rounded-xl border px-3 py-2.5',
                view.canChange ? 'cursor-pointer' : 'cursor-default',
                on && 'border-foreground ring-1 ring-foreground',
              )}
            >
              <input
                type="radio"
                name="agent-work"
                value={choice}
                checked={on}
                disabled={!view.canChange || saving}
                onChange={() => setPicked(choice)}
                className="mt-0.5 accent-foreground"
              />
              <span className="min-w-0">
                <span className="block font-medium">
                  {t(`choices.${choice}.label`)}
                  {choice === 'approve_first' && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {t('default')}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(`choices.${choice}.note`)}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="text-xs text-muted-foreground">{t('goLive')}</p>
      <p className="text-xs text-muted-foreground">{footer}</p>
      {view.canChange ? (
        <Button
          size="sm"
          className="justify-self-end"
          disabled={saving || picked === view.value}
          onClick={() => onSave(picked)}
        >
          {t('save')}
        </Button>
      ) : (
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden />
          {t('adminsOnly')}
        </p>
      )}
    </div>
  );
}
