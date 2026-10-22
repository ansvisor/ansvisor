'use client';

import { useTranslations } from 'next-intl';
import {
  Check,
  CheckCheck,
  Copy,
  ExternalLink,
  FilePen,
  FileText,
  ListChecks,
  ListPlus,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The opportunity panel's actions (the user's spec): three in front, in this
 * order: Send to Actions, Generate Brief, Send to Editor. Each turns into
 * its state in place once done (Open in Actions, Brief generated, Open
 * draft). The rest sit in the "…" menu on the right.
 */
export function OpportunityActions({
  actionId,
  sendToActions,
  brief,
  content,
  plan,
  alternative,
  workflow,
  onCopy,
  onReviewed,
  onRestore,
  onDismiss,
}: {
  /** The Action Center action it was sent to: Open in Actions takes Send's place. */
  actionId: string | null;
  /** Send to Actions, when the opportunity can still go there; `sending` while it does. */
  sendToActions: { sending: boolean; disabled: boolean; onSend: () => void } | null;
  brief: {
    generated: boolean;
    generating: boolean;
    /** Why it can't be generated now (the month's briefs are used up). */
    blockedReason: string | null;
    onGenerate: () => void;
  };
  /**
   * The Content Editor: the draft written for this opportunity (undefined
   * while looked up), or Start for one when `canStart` (earned work lives on
   * other sites; a closed opportunity has nothing to write). A lookup that
   * failed offers to check again instead of Start, so it never turns into a
   * second draft.
   */
  content: {
    draftId: string | null | undefined;
    lookupFailed?: boolean;
    onRetry?: () => void;
    canStart: boolean;
    onStart: () => void;
    onOpenDraft: (draftId: string) => void;
  };
  /** Its Plan row's priority mark (undefined while looked up); null when not offered. */
  plan: { prioritized: boolean | undefined; onSend: () => void; onOpen: () => void } | null;
  /** Another angle (CONTENT-006); null when it isn't offered. */
  alternative: { running: boolean; onOpen: () => void } | null;
  /** The CMS webhook; null when it isn't offered. */
  workflow: { sending: boolean; sentBefore: boolean; onSend: () => void } | null;
  onCopy: () => void;
  onReviewed?: () => void;
  onRestore?: () => void;
  onDismiss?: () => void;
}) {
  const t = useTranslations('content');
  const draftId = content.draftId;
  const showContent = !!draftId || content.canStart || !!content.lookupFailed;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actionId ? (
        <Link href={`/dashboard/action-center/actions?action=${actionId}`}>
          <Button variant="outline" size="sm" className="gap-2">
            <ExternalLink className="h-4 w-4" />
            {t('openInActions')}
          </Button>
        </Link>
      ) : (
        sendToActions && (
          <Button
            variant="outline"
            size="sm"
            onClick={sendToActions.onSend}
            disabled={sendToActions.disabled}
            className="gap-2"
          >
            {sendToActions.sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Target className="h-4 w-4" />
            )}
            {t('sendToActions')}
          </Button>
        )
      )}
      {brief.generated ? (
        <Button variant="outline" size="sm" disabled className="gap-2 disabled:opacity-100">
          <Check className="h-4 w-4" />
          {t('briefGenerated')}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={brief.onGenerate}
          disabled={brief.generating || brief.blockedReason !== null}
          title={brief.blockedReason ?? undefined}
          className="gap-2"
        >
          {brief.generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {brief.generating ? t('generatingBrief') : t('generateBrief')}
        </Button>
      )}
      {showContent &&
        (content.lookupFailed ? (
          <Button size="sm" variant="outline" className="gap-2" onClick={content.onRetry}>
            <RotateCcw className="h-4 w-4" />
            {t('draftCheckFailed')}
          </Button>
        ) : draftId ? (
          <Button size="sm" className="gap-2" onClick={() => content.onOpenDraft(draftId)}>
            <FileText className="h-4 w-4" />
            {t('openDraft')}
          </Button>
        ) : (
          <Button
            size="sm"
            className="gap-2"
            onClick={content.onStart}
            disabled={draftId === undefined}
          >
            {draftId === undefined ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePen className="h-4 w-4" />
            )}
            {t('sendToEditor')}
          </Button>
        ))}

      <DropdownMenu>
        <DropdownMenuTrigger
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={t('moreActions')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {plan && (
            <DropdownMenuItem
              className="gap-2"
              onClick={plan.prioritized ? plan.onOpen : plan.onSend}
              disabled={plan.prioritized === undefined}
            >
              {plan.prioritized === undefined ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : plan.prioritized ? (
                <ListChecks className="h-3.5 w-3.5" />
              ) : (
                <ListPlus className="h-3.5 w-3.5" />
              )}
              {plan.prioritized ? t('openInPlan') : t('sendToPlan')}
            </DropdownMenuItem>
          )}
          {alternative && (
            <DropdownMenuItem
              className="gap-2"
              onClick={alternative.onOpen}
              disabled={alternative.running}
              title={t('alternative.hint')}
            >
              {alternative.running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {alternative.running ? t('alternative.running') : t('alternative.button')}
            </DropdownMenuItem>
          )}
          {workflow && (
            <DropdownMenuItem
              className="gap-2"
              onClick={workflow.onSend}
              disabled={workflow.sending}
            >
              {workflow.sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {workflow.sending
                ? t('sending')
                : workflow.sentBefore
                  ? t('sendAgain')
                  : t('sendToWorkflow')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="gap-2" onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" />
            {t('copyAllData')}
          </DropdownMenuItem>
          {onReviewed && (
            <DropdownMenuItem className="gap-2" onClick={onReviewed}>
              <CheckCheck className="h-3.5 w-3.5" />
              {t('markReviewed')}
            </DropdownMenuItem>
          )}
          {onRestore && (
            <DropdownMenuItem className="gap-2" onClick={onRestore}>
              <RotateCcw className="h-3.5 w-3.5" />
              {t('restore')}
            </DropdownMenuItem>
          )}
          {onDismiss && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" variant="destructive" onClick={onDismiss}>
                <X className="h-3.5 w-3.5" />
                {t('dismiss')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
