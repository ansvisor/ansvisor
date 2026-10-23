'use client';

import { useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { History, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LoadingDots } from '@/components/ui/loading-dots';
import { getDraftVersions } from '@/lib/actions/content-drafts';
import { HISTORY_DAYS, type DraftVersion } from '@/lib/content/history';

/**
 * History in the editor's header (CE-018): the draft now, then its earlier
 * versions with their time and origin, read each time the menu opens. Picking
 * one restores it; the page it replaces is kept as a version too.
 */
export function HistoryMenu({
  draftId,
  disabled,
  onRestore,
}: {
  draftId: string;
  /** Why it can't open now (the HTML view is open), or null. */
  disabled: string | null;
  onRestore: (version: DraftVersion, label: string) => void;
}) {
  const t = useTranslations('contentEditor.editor.history');
  const format = useFormatter();
  const now = useNow();
  const [versions, setVersions] = useState<DraftVersion[] | 'loading' | 'failed'>('loading');

  const load = () => {
    setVersions('loading');
    getDraftVersions(draftId)
      .then(setVersions)
      .catch((err) => {
        console.error('Failed to read the draft history:', err);
        setVersions('failed');
      });
  };

  /** "Today 10:42", or "Oct 12, 10:42". */
  const when = (iso: string) => {
    const date = new Date(iso);
    const time = format.dateTime(date, { hour: 'numeric', minute: '2-digit' });
    return date.toDateString() === now.toDateString()
      ? t('today', { time })
      : format.dateTime(date, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
  };

  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" />}
        disabled={disabled !== null}
        title={disabled ?? t('hint')}
        aria-label={t('button')}
      >
        <History className="h-3.5 w-3.5" />
        <span className="hidden xl:inline">{t('button')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t('title')}{' '}
            <span className="font-normal text-muted-foreground">
              · {t('kept', { days: HISTORY_DAYS })}
            </span>
          </DropdownMenuLabel>
          <div className="rounded-md bg-muted/60 px-1.5 py-1.5">
            <p className="text-sm font-medium">{t('now')}</p>
            <p className="text-xs text-muted-foreground">{t('nowNote')}</p>
          </div>
          {versions === 'loading' ? (
            <p className="flex items-center gap-2 px-1.5 py-2 text-xs text-muted-foreground">
              <LoadingDots />
              {t('loading')}
            </p>
          ) : versions === 'failed' ? (
            <p className="px-1.5 py-2 text-xs text-destructive">{t('failed')}</p>
          ) : versions.length === 0 ? (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">{t('empty')}</p>
          ) : (
            versions.map((version) => {
              const label = t(`origin.${version.origin}`);
              return (
                <DropdownMenuItem
                  key={version.id}
                  onClick={() => onRestore(version, label)}
                  aria-label={t('restoreLabel', { version: label, when: when(version.createdAt) })}
                  className="items-start"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {when(version.createdAt)} · {t(`note.${version.origin}`)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <RotateCcw className="h-3 w-3" />
                    {t('restore')}
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-1.5 py-1 text-xs text-muted-foreground">{t('footer')}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
