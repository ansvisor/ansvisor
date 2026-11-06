'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Eye } from 'lucide-react';
import { AskAdminButton, AskAdminDialog } from '@/components/chat-access/ask-admin-button';
import {
  UpgradeDialogContext,
  useUpgradeDialog,
  type UpgradeDialogState,
} from '@/components/providers/upgrade-gate';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserRole } from '@/hooks/use-user-role';
import { cn } from '@/lib/utils';

/**
 * The editor (~4.5k lines with its helpers) loads when a page first opens
 * beside a chat, not with the Chat page: a quiet outline of it shows meanwhile.
 */
const ContentEditorSurface = dynamic(
  () =>
    import('@/components/content-editor/editor-surface').then(
      (module) => module.ContentEditorSurface,
    ),
  { ssr: false, loading: () => <PagePaneSkeleton /> },
);

/** The editor's outline while its code loads: header, toolbar, a few lines. */
export function PagePaneSkeleton() {
  const t = useTranslations('chatPagePane');
  return (
    <div data-slot="page-pane-loading" aria-busy="true" className="flex h-full min-h-0 flex-col">
      <span className="sr-only">{t('loading')}</span>
      <div className="flex items-center gap-2.5 border-b px-4 py-3">
        <Skeleton className="size-7" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="ml-auto h-7 w-28" />
      </div>
      <div className="border-b px-3 py-2">
        <Skeleton className="h-6 w-2/3" />
      </div>
      <div className="flex flex-col gap-3 px-7 py-6">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

/**
 * A page Chat opened beside the conversation (Open here, CHAT-25 §4, W4-15):
 * the Content Editor, embedded, whose Close is `onClose`. Too narrow for
 * both side by side (Teknik T1), the shell shows one at a time and gives
 * the page `onBackToChat`, which shows the chat again with the page kept.
 *
 * Analysts and Agency partners see the page read-only (CHAT-25 §13): the
 * editor's own read-only mode, as for a workspace without a plan, so
 * nothing types, saves or runs, and what they click (Mark ready, the
 * agent's fixes and rewrites…) opens Ask your Admin instead of the plans.
 */
export function PagePane({
  draftId,
  onClose,
  onBackToChat,
  className,
  style,
  hidden = false,
}: {
  draftId: string;
  /** Close: the page goes, the chat takes the width again. */
  onClose: () => void;
  /** One at a time (a narrow window): Back to chat. */
  onBackToChat?: () => void;
  className?: string;
  style?: CSSProperties;
  /** Kept, unseen, while the chat shows in its place: its edits and scroll stay. */
  hidden?: boolean;
}) {
  const t = useTranslations('chatPagePane');
  const tAccess = useTranslations('chatAccess');
  const { role, canManage } = useUserRole();
  const roleName = tAccess(`roleNames.${role}`);
  return (
    <section
      data-slot="page-pane"
      aria-label={t('label')}
      inert={hidden || undefined}
      style={style}
      className={cn('flex min-h-0 min-w-0 flex-col bg-background', className)}
    >
      {onBackToChat && (
        <div className="flex shrink-0 items-center border-b px-3 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            data-action="pagePane.backToChat"
            title={t('backToChatTip')}
            onClick={onBackToChat}
          >
            {t('backToChat')}
          </Button>
        </div>
      )}
      {!canManage && (
        <div
          data-slot="page-pane-read-only"
          className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground"
        >
          <Eye className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{t('readOnly', { role: roleName })}</span>
          <AskAdminButton
            asked={tAccess('askAdmin.defaults.role')}
            ruleKind="role"
            ruleDetail={tAccess('askAdmin.roleDetail', { role: roleName })}
            className="h-7 text-xs"
          />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <ReadOnlyForRole on={!canManage} roleName={roleName}>
          <ContentEditorSurface draftId={draftId} embedded onClose={onClose} />
        </ReadOnlyForRole>
      </div>
    </section>
  );
}

/**
 * The editor's read-only mode for a role that can't change pages here: the
 * gate it already checks (useUpgradeGate) reads locked, and its "needs a
 * plan" dialog becomes Ask your Admin. A workspace that is read-only anyway
 * (no plan, the demo brand) keeps its own dialog: a plan comes first.
 */
function ReadOnlyForRole({
  on,
  roleName,
  children,
}: {
  on: boolean;
  roleName: string;
  children: ReactNode;
}) {
  const tAccess = useTranslations('chatAccess');
  const outer = useUpgradeDialog();
  const [asking, setAsking] = useState(false);
  const locked = on && !outer?.isLocked;
  const value = useMemo<UpgradeDialogState | null>(
    () =>
      locked
        ? {
            isLocked: true,
            isDemo: outer?.isDemo,
            reason: outer?.reason ?? 'ended',
            adminName: outer?.adminName ?? null,
            openUpgrade: () => setAsking(true),
          }
        : outer,
    [locked, outer],
  );
  return (
    <UpgradeDialogContext.Provider value={value}>
      {children}
      {locked && (
        <AskAdminDialog
          open={asking}
          onOpenChange={setAsking}
          asked={tAccess('askAdmin.defaults.role')}
          ruleKind="role"
          ruleDetail={tAccess('askAdmin.roleDetail', { role: roleName })}
        />
      )}
    </UpgradeDialogContext.Provider>
  );
}
