'use client';

import { useTranslations } from 'next-intl';
import { Bot, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { suggestionCounts, type DraftSuggestion } from '@/lib/content/suggestions';

/**
 * The agent bar over the page (CE-018): while an agent's suggestions are
 * open, who left how many and from which action, with Reject all and Accept
 * all (open ones only); once all are decided, how many were accepted and
 * rejected and how many rules are still open. Undo all brings every decided
 * one back to review.
 */
export function AgentBar({
  suggestions,
  rulesOpen,
  busy,
  onAcceptAll,
  onRejectAll,
  onUndoAll,
  onClose,
}: {
  suggestions: DraftSuggestion[];
  rulesOpen: number;
  busy: boolean;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onUndoAll: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('contentEditor.editor.suggestions');
  const { open, accepted, rejected } = suggestionCounts(suggestions);
  const action = suggestions.find((s) => s.actionId && s.actionNo !== null);

  return (
    <div
      role="region"
      aria-label={t('bar')}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-muted/40 px-4 py-1.5 text-[13px]"
    >
      <Bot aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      {open > 0 ? (
        <span className="min-w-0">
          <span className="font-medium">{t('agent')}</span> {t('suggested', { count: open })}
          {action && (
            <>
              {' · '}
              <Link
                href={`/dashboard/action-center/actions?action=${action.actionId}`}
                className="underline underline-offset-2 hover:no-underline"
              >
                {t('fromAction', { no: action.actionNo! })}
              </Link>
            </>
          )}
        </span>
      ) : (
        <span className="min-w-0">
          <span className="font-medium">{t('decided', { accepted, rejected })}</span>
          {rulesOpen > 0 && (
            <span className="text-muted-foreground">
              {' · '}
              {t('rulesOpen', { count: rulesOpen })}
            </span>
          )}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {accepted + rejected > 0 && (
          <Button variant="ghost" size="sm" className="h-7" disabled={busy} onClick={onUndoAll}>
            {t('undoAll')}
          </Button>
        )}
        {open > 0 ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={busy}
              onClick={onRejectAll}
            >
              {t('rejectAll')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={busy}
              onClick={onAcceptAll}
            >
              {t('acceptAll')}
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('close')}
            title={t('close')}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </span>
    </div>
  );
}
