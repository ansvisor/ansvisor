'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { bulkUpdatePromptTags } from '@/lib/actions/prompt';
import { MAX_PROMPT_TAGS, planBulkTagChange } from '@/lib/prompt-tags';
import { cn } from '@/lib/utils';
import type { Prompt } from '@/types';

type Mode = 'add' | 'remove';

export interface BulkTagsPreset {
  /** Add (the default) or remove. */
  mode?: Mode;
}

/** Each tag the prompts carry, the most carried first, with how many carry it. */
function carriedTags(prompts: readonly Prompt[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of prompts) {
    for (const tag of new Set(p.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
}

/**
 * Add or remove custom tags on the selected prompts (#2378). Adding takes
 * the tag editor the prompt's own dialog has; removing offers the tags the
 * selection carries, each with how many carry it. The preview and the save
 * run the same arithmetic (planBulkTagChange): a prompt at 10 tags is
 * skipped and said, never silently trimmed.
 */
export function BulkTagsDialog({
  open,
  onOpenChange,
  prompts,
  selectedIds,
  preset,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The rows the table shows; the selection acts on those it includes. */
  prompts: Prompt[];
  selectedIds: ReadonlySet<string>;
  preset: BulkTagsPreset | null;
  onDone: () => void;
}) {
  const t = useTranslations('prompts.bulkTags');
  const tTags = useTranslations('prompts.tags');
  const [mode, setMode] = useState<Mode>('add');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
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
    setTags([]);
    setTagDraft('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const removing = mode === 'remove';
  const carried = useMemo(() => carriedTags(targets), [targets]);
  const change = planBulkTagChange(
    targets.map((p) => ({ id: p.id, tags: p.tags })),
    mode,
    tags,
  );

  const toggle = (tag: string) =>
    setTags(tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await bulkUpdatePromptTags(
        targets.map((p) => p.id),
        mode,
        tags,
      );
      if ('error' in result) {
        setError(result.error);
        return;
      }
      toast.success(t(removing ? 'removed' : 'done', { count: result.updated }));
      onOpenChange(false);
      onDone();
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
                  setTags([]);
                  setTagDraft('');
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

          {removing ? (
            <div className="space-y-1.5">
              <Label>{t('removeTags')}</Label>
              {carried.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('removeNone')}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {carried.map(({ tag, count }) => (
                    <button key={tag} type="button" onClick={() => toggle(tag)} disabled={saving}>
                      <Badge
                        variant={tags.includes(tag) ? 'default' : 'outline'}
                        className="cursor-pointer gap-1"
                      >
                        {tag}
                        <span className="text-muted-foreground">{count}</span>
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-prompt-tags">{tTags('label')}</Label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1 pr-1.5">
                      {tag}
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={tTags('removeTag', { tag })}
                        disabled={saving}
                        onClick={() => toggle(tag)}
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Input
                id="bulk-prompt-tags"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                maxLength={50}
                placeholder={tTags('placeholder')}
                disabled={saving || tags.length >= MAX_PROMPT_TAGS}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const tag = tagDraft.trim().slice(0, 50);
                  if (tag && tags.length < MAX_PROMPT_TAGS && !tags.includes(tag)) {
                    setTags([...tags, tag]);
                  }
                  setTagDraft('');
                }}
              />
              <p className="text-xs text-muted-foreground">{tTags('hint')}</p>
            </div>
          )}

          {tags.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t(removing ? 'previewRemove' : 'previewAdd', {
                count: change.changes.length,
                unchanged: change.unchanged,
                blocked: change.blocked,
              })}
            </p>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || tags.length === 0 || change.changes.length === 0}
          >
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {t(removing ? 'removeSave' : 'save', { count: change.changes.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
