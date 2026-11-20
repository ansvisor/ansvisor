'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useUserRole } from '@/hooks/use-user-role';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { removedTargets } from '@/lib/action-center/entity-counts';
import { shouldReplan, type RemovedTarget } from '@/lib/action-center/removed-list';
import { getRemovedTargets } from '@/lib/actions/action-removed';
import { regenerateActionTasks } from '@/lib/actions/action-task-writer';
import { KNOWN_ERRORS, taskWriterEnabled } from './regenerate-tasks';

/**
 * "(1 prompt removed since this action was created)" beside an action's
 * count (AC-009): prompts deleted or paused, or competitors deleted, since
 * the action kept its list. A click opens them, each with why (AC-13); with
 * more than half of its prompts gone, it offers to re-plan the tasks on the
 * ones left (Regenerate tasks, which leaves the removed ones out). Nothing
 * when none were. A click on it stays on it: in a table row, it doesn't
 * open the drawer.
 */
export function RemovedNote({
  action,
  onReplanned,
}: {
  action: { id: string; kind: string; status: string; payload: Record<string, unknown> };
  /** Called once the tasks are written again, to reload them. */
  onReplanned?: () => void | Promise<void>;
}) {
  const t = useTranslations('actionCenter.actionsPage');
  const tRegenerate = useTranslations('actionCenter.actionsPage.drawer.regenerate');
  const tActions = useTranslations('readOnly.actions');
  const { canManage } = useUserRole();
  const { guard } = useUpgradeGate();
  // Read when first opened: null until then, or when it can't be read.
  const [list, setList] = useState<RemovedTarget[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const payload = action.payload;
  const removed = removedTargets(payload);
  if (!removed) return null;
  const entity = typeof payload.targetEntity === 'string' ? payload.targetEntity : null;
  const note = t('removed.note', {
    items: entity ? t(`tags.${entity}`, { count: removed.count }) : String(removed.count),
  });
  const replan = shouldReplan(action) && taskWriterEnabled() && canManage;
  // The names the count already has, until (or unless) the reasons are read.
  const rows: RemovedTarget[] = list ?? removed.labels.map((label) => ({ label, reason: null }));
  const more = removed.count - rows.length;

  const open = async (next: boolean) => {
    if (!next) setConfirming(false);
    if (!next || list || loading) return;
    setLoading(true);
    try {
      setList(await getRemovedTargets(action.id));
    } catch {
      // The names it has stay, without reasons.
    } finally {
      setLoading(false);
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      const result = await regenerateActionTasks(action.id);
      if ('written' in result) {
        toast.success(
          result.reviews > 0
            ? tRegenerate('doneWithReviews', { count: result.written, reviews: result.reviews })
            : tRegenerate('done', { count: result.written }),
        );
        await onReplanned?.();
      } else {
        toast.error(
          result.error !== 'server'
            ? tRegenerate(result.error)
            : result.code && KNOWN_ERRORS.includes(result.code)
              ? tRegenerate(`errors.${result.code}`)
              : result.message,
        );
      }
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Popover onOpenChange={(next) => void open(next)}>
      <PopoverTrigger
        onClick={(event) => event.stopPropagation()}
        className="self-center rounded-sm text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {note}
      </PopoverTrigger>
      {/* Clicks inside reach the row through the portal: they stay here. */}
      <PopoverContent className="w-80 space-y-2 p-3" onClick={(event) => event.stopPropagation()}>
        <p className="text-xs font-medium">{t('removed.title')}</p>
        <ul className="max-h-60 space-y-1 overflow-y-auto">
          {rows.map((row, i) => (
            <li key={`${row.label}-${i}`} className="flex items-start gap-2 text-xs">
              <span className="min-w-0 flex-1 break-words">{row.label}</span>
              {row.reason && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {t(`removed.reasons.${row.reason}`)}
                </Badge>
              )}
            </li>
          ))}
        </ul>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {more > 0 && (
          <p className="text-xs text-muted-foreground">{t('removed.more', { count: more })}</p>
        )}
        {replan && (
          <div className="space-y-2 border-t pt-2">
            <p className="text-xs text-muted-foreground">
              {t('removed.replanHint', { count: Number(payload.targetCount ?? 0) })}
            </p>
            {busy ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {tRegenerate('busy')}
              </p>
            ) : confirming ? (
              <div className="space-y-2">
                <p className="text-xs">{t('removed.replanConfirm')}</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void run()}
                    className="h-7 text-xs"
                  >
                    {tRegenerate('confirmButton')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirming(false)}
                    className="h-7 text-xs"
                  >
                    {tRegenerate('cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={guard(() => setConfirming(true), {
                  action: tActions('regenerateTasks'),
                })}
                className="h-8 w-full text-xs"
              >
                <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                {t('removed.replan')}
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
