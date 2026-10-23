'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Minus, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox';
import { Textarea } from '@/components/ui/textarea';
import { LoadingDots } from '@/components/ui/loading-dots';
import { cn } from '@/lib/utils';
import { getTopics } from '@/lib/actions/topic';
import { getBrandPrompts } from '@/lib/actions/tracking';

export type NewOpportunitiesFocus = 'auto' | 'topic' | 'prompt';

export interface NewOpportunitiesInput {
  count: number;
  topicId: string | null;
  promptId: string | null;
  idea: string | null;
}

/** Longest idea the server accepts (IDEA_MAX_LENGTH in opportunity-generator.js). */
const IDEA_MAX_LENGTH = 500;

const DEFAULT_COUNT = 3;

interface Option {
  value: string;
  label: string;
}

/**
 * "+ New" (CONTENT-003): generate opportunities now, optionally around a
 * topic, a prompt or a free-text idea. The count is capped by `max` — the
 * plan's per-request limit, never more than what is left of the month — and
 * the dialog says what the request will use before it is sent.
 */
export function NewOpportunitiesDialog({
  open,
  onOpenChange,
  ...form
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  /** Most this request may ask for. */
  max: number;
  /** What is left of the month; -1 when unlimited. */
  remaining: number;
  onSubmit: (input: NewOpportunitiesInput) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted per opening, so every opening starts from a fresh form. */}
        {open && <NewOpportunitiesForm {...form} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NewOpportunitiesForm({
  brandId,
  max,
  remaining,
  onSubmit,
  onClose,
}: {
  brandId: string;
  max: number;
  remaining: number;
  onSubmit: (input: NewOpportunitiesInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations('content.newDialog');
  const tCommon = useTranslations('common');
  const [focus, setFocus] = useState<NewOpportunitiesFocus>('auto');
  const [topicId, setTopicId] = useState('');
  const [prompt, setPrompt] = useState<Option | null>(null);
  const [idea, setIdea] = useState('');
  const [count, setCount] = useState(() => Math.max(1, Math.min(DEFAULT_COUNT, max)));
  const [submitting, setSubmitting] = useState(false);
  const [topics, setTopics] = useState<Option[]>([]);
  const [prompts, setPrompts] = useState<Option[]>([]);

  // The brand's topics and prompts, not only the ones that already have
  // opportunities.
  useEffect(() => {
    let cancelled = false;
    Promise.all([getTopics(brandId), getBrandPrompts(brandId)]).then(
      ([topicRows, promptRows]) => {
        if (cancelled) return;
        setTopics(
          topicRows.filter((tp) => tp.isActive).map((tp) => ({ value: tp.id, label: tp.name })),
        );
        setPrompts(promptRows.map((p) => ({ value: p.id, label: p.text })));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const focusReady =
    focus === 'auto' || (focus === 'topic' && !!topicId) || (focus === 'prompt' && !!prompt);
  const canSubmit = max > 0 && count >= 1 && count <= max && focusReady && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const ok = await onSubmit({
      count,
      topicId: focus === 'topic' ? topicId : null,
      promptId: focus === 'prompt' ? (prompt?.value ?? null) : null,
      idea: idea.trim() || null,
    });
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('focus')}</p>
          <div className="flex flex-wrap gap-1.5">
            {(['auto', 'topic', 'prompt'] as const).map((f) => (
              <Button
                key={f}
                type="button"
                size="sm"
                variant={focus === f ? 'default' : 'outline'}
                className="h-7 text-xs"
                aria-pressed={focus === f}
                onClick={() => setFocus(f)}
              >
                {t(`focusOptions.${f}`)}
              </Button>
            ))}
          </div>
          {focus === 'topic' && (
            <Select value={topicId} onValueChange={(v) => setTopicId((v as string) ?? '')}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder={t('pickTopic')}>
                  {(value) => topics.find((tp) => tp.value === value)?.label ?? t('pickTopic')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {topics.map((tp) => (
                  <SelectItem key={tp.value} value={tp.value}>
                    {tp.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {focus === 'prompt' && (
            <Combobox
              items={prompts}
              value={prompt}
              onValueChange={(item: Option | null) => setPrompt(item)}
            >
              <ComboboxTrigger className="h-8 w-full text-xs" title={prompt?.label}>
                <ComboboxValue placeholder={t('pickPrompt')} />
              </ComboboxTrigger>
              <ComboboxContent>
                <ComboboxInput placeholder={tCommon('searchPrompts')} />
                <ComboboxList>
                  <ComboboxEmpty>{tCommon('noPromptsMatch')}</ComboboxEmpty>
                  <ComboboxCollection>
                    {(item: Option) => (
                      <ComboboxItem key={item.value} value={item} title={item.label}>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          )}
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="new-opportunities-idea"
            className="text-xs font-medium text-muted-foreground"
          >
            {t('idea')}
          </label>
          <Textarea
            id="new-opportunities-idea"
            value={idea}
            onChange={(e) => setIdea(e.target.value.slice(0, IDEA_MAX_LENGTH))}
            placeholder={t('ideaPlaceholder')}
            rows={2}
            className="text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('count')}</p>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center rounded-md border">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('fewer')}
                disabled={count <= 1}
                onClick={() => setCount((n) => Math.max(1, n - 1))}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-8 text-center text-sm font-semibold tabular-nums">{count}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('more')}
                disabled={count >= max}
                onClick={() => setCount((n) => Math.min(max, n + 1))}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">{t('max', { max })}</span>
          </div>
        </div>

        <p
          className={cn(
            'rounded-md border bg-muted/40 px-3 py-2 text-xs',
            max === 0 && 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
          )}
        >
          {max === 0
            ? t('noneLeft')
            : remaining === -1
              ? t('usesUnlimited', { count })
              : t('uses', { count, remaining, after: Math.max(0, remaining - count) })}
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          {tCommon('cancel')}
        </Button>
        <Button onClick={submit} disabled={!canSubmit} className="gap-2">
          {submitting ? <LoadingDots /> : <Sparkles className="h-4 w-4" />}
          {t('generate', { count })}
        </Button>
      </DialogFooter>
    </>
  );
}
