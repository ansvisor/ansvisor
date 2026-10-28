'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LocationPicker } from '@/components/dashboard/location-picker';
import {
  bulkUpdatePromptLocations,
  getLocationQuota,
  type LocationQuota,
} from '@/lib/actions/prompt';
import { planBulkLocationChange } from '@/lib/prompt-locations';
import { cn } from '@/lib/utils';
import type { Prompt } from '@/types';
import { PromptLimitActions } from './_prompt-limit-actions';

type Scope = 'one' | 'selected' | 'topic' | 'all';

export interface AddLocationsPreset {
  /** One prompt, from a Locations view cell's + Track. */
  promptId?: string;
  locations?: string[];
}

/**
 * Track in more locations (PROMPT-015c): the locations to add, the prompts
 * to add them to (one, the selected, a topic, or all shown), and what it
 * does to the plan's tracked locations before anything is saved. Past the
 * limit it says what the choice needs and what is left, with the plan's
 * way out, and saves nothing. The preview and the save run the same
 * arithmetic (planBulkLocationChange), and the save checks the limit again.
 */
export function AddLocationsDialog({
  open,
  onOpenChange,
  brandId,
  prompts,
  selectedIds,
  preset,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  /** The rows the table shows. */
  prompts: Prompt[];
  selectedIds: ReadonlySet<string>;
  preset: AddLocationsPreset | null;
  onDone: () => void;
}) {
  const t = useTranslations('prompts.addLocations');
  const [locations, setLocations] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>('all');
  const [topic, setTopic] = useState('');
  const [quota, setQuota] = useState<LocationQuota | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const topics = useMemo(
    () => [...new Set(prompts.map((p) => p.category?.trim()).filter(Boolean))].sort() as string[],
    [prompts],
  );
  const selected = prompts.filter((p) => selectedIds.has(p.id));
  const one = preset?.promptId ? prompts.find((p) => p.id === preset.promptId) : undefined;

  // Each opening starts from what opened it.
  useEffect(() => {
    if (!open) return;
    setLocations(preset?.locations ?? []);
    setScope(preset?.promptId ? 'one' : selectedIds.size ? 'selected' : 'all');
    setTopic('');
    setError(null);
    let cancelled = false;
    getLocationQuota(brandId)
      .then((q) => {
        if (!cancelled) setQuota(q);
      })
      .catch((err) => console.error('Failed to read the plan usage:', err));
    return () => {
      cancelled = true;
    };
    // Read when it opens; the preset and selection are what opened it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, brandId]);

  const chosenTopic = topic || topics[0] || '';
  // A cell's prompt the rows no longer show is no prompt, never every prompt.
  const targets =
    scope === 'one'
      ? one
        ? [one]
        : []
      : scope === 'selected'
        ? selected
        : scope === 'topic'
          ? prompts.filter((p) => p.category?.trim() === chosenTopic)
          : prompts;
  const change = planBulkLocationChange(
    targets.map((p) => ({ id: p.id, regions: p.regions, isActive: p.isActive })),
    'add',
    locations,
  );
  const unlimited = quota === null || quota.maxPrompts === -1;
  const after = (quota?.used ?? 0) + change.delta;
  const over = !unlimited && quota !== null && after > quota.maxPrompts;
  const left = quota ? Math.max(0, quota.maxPrompts - quota.used) : 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await bulkUpdatePromptLocations(
      targets.map((p) => p.id),
      'add',
      locations,
    );
    setSaving(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    toast.success(t('done', { count: result.updated }));
    onOpenChange(false);
    onDone();
  };

  const scopes: { id: Scope; label: string; count: number }[] = [
    ...(one ? [{ id: 'one' as const, label: one.text, count: 1 }] : []),
    ...(selected.length
      ? [
          {
            id: 'selected' as const,
            label: t('selected', { count: selected.length }),
            count: selected.length,
          },
        ]
      : []),
    ...(topics.length
      ? [
          {
            id: 'topic' as const,
            label: t('topic'),
            count: prompts.filter((p) => p.category?.trim() === chosenTopic).length,
          },
        ]
      : []),
    { id: 'all', label: t('allShown', { count: prompts.length }), count: prompts.length },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('lead')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <LocationPicker
            value={locations}
            onChange={setLocations}
            maxSelectable={null}
            label={t('locations')}
            countNoun={t('picked')}
            allowEmpty
          />

          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">{t('scope')}</legend>
            {scopes.map((s) => (
              <label
                key={s.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                  scope === s.id && 'border-foreground',
                )}
              >
                <input
                  type="radio"
                  name="add-locations-scope"
                  checked={scope === s.id}
                  onChange={() => setScope(s.id)}
                />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {s.id === 'topic' && (
                  <select
                    aria-label={t('topic')}
                    value={chosenTopic}
                    onChange={(e) => {
                      setTopic(e.target.value);
                      setScope('topic');
                    }}
                    className="h-7 max-w-[160px] rounded-md border bg-background px-1.5 text-xs"
                  >
                    {topics.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t('promptsCount', { count: s.count })}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{t('usage')}</span>
              <span className="tabular-nums">
                {quota === null
                  ? '…'
                  : unlimited
                    ? t('unlimited', { used: quota.used, after })
                    : t('usageLine', { used: quota.used, after, max: quota.maxPrompts })}
              </span>
            </div>
            {!unlimited && quota && (
              <div aria-hidden className="flex h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className="bg-foreground"
                  style={{ width: `${Math.min(100, (quota.used / quota.maxPrompts) * 100)}%` }}
                />
                <span
                  className={over ? 'bg-amber-500' : 'bg-foreground/40'}
                  style={{
                    width: `${Math.max(0, Math.min(100 - (quota.used / quota.maxPrompts) * 100, (change.delta / quota.maxPrompts) * 100))}%`,
                  }}
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t('usageHint')}</p>
          </div>

          {over && quota && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <p className="font-medium">
                {t('over', { adding: change.delta, left, plan: quota.planName })}
              </p>
              <p className="text-xs">{t('overHint', { plan: quota.planId })}</p>
              <div className="flex flex-wrap gap-2">
                <PromptLimitActions planId={quota.planId} />
              </div>
            </div>
          )}
          {targets.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('noPrompts')}</p>
          ) : (
            locations.length > 0 &&
            change.changes.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('nothing')}</p>
            )
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || over || targets.length === 0 || change.changes.length === 0}
          >
            {saving && <Loader2 className="animate-spin" />}
            {t('submit', { count: locations.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
