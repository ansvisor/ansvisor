'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Link } from '@/i18n/navigation';
import { ADD_ONS_HREF } from '@/lib/billing/add-on-links';
import { bulkUpdatePromptPlatforms } from '@/lib/actions/prompt';
import { planBulkPlatformChange } from '@/lib/prompt-platform-change';
import type { SlotMeter } from '@/lib/prompt-usage-summary';
import { cn } from '@/lib/utils';
import type { Prompt } from '@/types';

type Mode = 'add' | 'remove';

export interface BulkPlatformsPreset {
  /** Add (the default) or remove. */
  mode?: Mode;
}

/**
 * Add or remove platforms on the selected prompts (00564): how a prompt
 * gets a platform the workspace bought tracking slots for, and how a
 * platform a prompt waits on runs again. Adding shows each picked
 * platform's free slots against what the selection needs, and is refused
 * by the server when one has too few. Removing offers the platforms the
 * selection runs on; a prompt it would leave with nothing to run is
 * skipped and said.
 */
export function BulkPlatformsDialog({
  open,
  onOpenChange,
  prompts,
  selectedIds,
  preset,
  platforms,
  slots,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompts: Prompt[];
  selectedIds: ReadonlySet<string>;
  preset: BulkPlatformsPreset | null;
  /** The platforms a prompt may be set to here, with their names. */
  platforms: readonly { id: string; label: string }[];
  /** Slots per platform, when the plan has them. */
  slots: readonly SlotMeter[] | undefined;
  onDone: () => void;
}) {
  const t = useTranslations('prompts.bulkPlatforms');
  const format = useFormatter();
  const [mode, setMode] = useState<Mode>('add');
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = useMemo(
    () => prompts.filter((p) => selectedIds.has(p.id)),
    [prompts, selectedIds],
  );

  // Each opening starts from what opened it.
  useEffect(() => {
    if (!open) return;
    setMode(preset?.mode ?? 'add');
    setPicked([]);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const removing = mode === 'remove';
  // Removing offers what the selection runs on; ChatGPT Shopping stays per brand.
  const offered = useMemo(() => {
    const choices = platforms.filter((p) => p.id !== 'chatgpt-shopping');
    if (!removing) return choices;
    const carried = new Set(targets.flatMap((p) => p.platforms as string[]));
    return choices.filter((p) => carried.has(p.id));
  }, [platforms, removing, targets]);

  const change = planBulkPlatformChange(
    targets.map((p) => ({
      id: p.id,
      platforms: p.platforms,
      models: p.models,
      regions: p.regions,
      is_active: p.isActive,
    })),
    mode,
    picked,
  );
  const free = (platform: string) => {
    const meter = slots?.find((m) => m.platform === platform);
    if (!slots) return Infinity;
    if (!meter) return 0;
    return meter.limit === null ? Infinity : Math.max(0, meter.limit - meter.used);
  };
  const short = removing
    ? []
    : [...change.needed].filter(([platform, needed]) => needed > free(platform));

  const toggle = (id: string) =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await bulkUpdatePromptPlatforms(
        targets.map((p) => p.id),
        mode,
        picked,
      );
      if ('error' in result) {
        setError(result.error);
        return;
      }
      toast.success(t(removing ? 'removed' : 'done', { count: result.updated }));
      onOpenChange(false);
      onDone();
    } catch {
      setError(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(removing ? 'removeTitle' : 'title')}</DialogTitle>
          <DialogDescription>
            {t(removing ? 'removeLead' : 'lead', { count: targets.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div
            role="group"
            aria-label={t('modes')}
            className="inline-flex gap-0.5 rounded-full border bg-background p-0.5"
          >
            {(['add', 'remove'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  setPicked([]);
                  setError(null);
                }}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium',
                  mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {t(m === 'add' ? 'modeAdd' : 'modeRemove')}
              </button>
            ))}
          </div>

          {offered.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t(removing ? 'removeNone' : 'none')}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('platforms')}>
              {offered.map((p) => {
                const left = free(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    disabled={saving}
                    aria-pressed={picked.includes(p.id)}
                  >
                    <Badge
                      variant={picked.includes(p.id) ? 'default' : 'outline'}
                      className="cursor-pointer gap-1"
                    >
                      {p.label}
                      {!removing && slots && Number.isFinite(left) && (
                        <span
                          className={cn(
                            picked.includes(p.id)
                              ? 'text-primary-foreground/80'
                              : 'text-muted-foreground',
                          )}
                        >
                          {t('free', { count: format.number(left) })}
                        </span>
                      )}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}

          {picked.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t(removing ? 'previewRemove' : 'previewAdd', {
                count: change.changes.length,
                unchanged: change.unchanged,
                blocked: change.blocked,
              })}
            </p>
          )}

          {short.length > 0 && (
            <p
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
              data-slot="slots-short"
            >
              {short
                .map(([platform, needed]) =>
                  t('short', {
                    platform: platforms.find((p) => p.id === platform)?.label ?? platform,
                    needed: format.number(needed),
                    free: format.number(free(platform)),
                  }),
                )
                .join(' ')}{' '}
              <Link href={ADD_ONS_HREF} className="font-medium underline underline-offset-2">
                {t('addSlots')}
              </Link>
            </p>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={
              saving || picked.length === 0 || change.changes.length === 0 || short.length > 0
            }
          >
            {saving && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
            {t(removing ? 'removeSave' : 'save', { count: change.changes.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
