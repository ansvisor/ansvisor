'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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
import { saveBusinessHubSnapshot } from '@/lib/actions/business-hub';
import {
  MAX_TOPICS,
  PERIOD_DAYS,
  TOPIC_CHARS,
  checkDraft,
  draftOf,
  type BusinessHubEntry,
  type DraftField,
  type DraftProblem,
  type EntryDraft,
} from '@/lib/business-hub/numbers';
import { cn } from '@/lib/utils';

type Problems = Partial<Record<DraftField | 'entry', DraftProblem>>;

/** A problem's words, by field. */
function problemKey(field: DraftField | 'entry', problem: DraftProblem): string {
  if (field === 'entry') return 'errors.empty';
  if (field === 'periodEnd') {
    return problem === 'future'
      ? 'errors.future'
      : problem === 'too_old'
        ? 'errors.tooOld'
        : 'errors.date';
  }
  if (field === 'topics') return problem === 'too_long' ? 'errors.topicTooLong' : 'errors.topics';
  return 'errors.count';
}

const COUNTS = ['mentions', 'websiteClicks', 'profileViews'] as const;

/**
 * Enter numbers (Visibility's ChatGPT Business Hub card): one entry, as
 * Business Hub's Insights shows it: 7 or 28 days, the last day (yesterday
 * unless changed), Mentions, Website clicks and Profile views (empty: not
 * shown there) and the top five discovery topics. Checked here as the API
 * checks it, so a mistake is said beside its field; an empty entry is
 * refused. Saving the same days again replaces the entry, as it says.
 * Every member may enter numbers.
 */
export function BusinessHubDialog({
  brandId,
  open,
  onOpenChange,
  entry,
  entries,
  onSaved,
  footer,
}: {
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The entry being edited; null for a new one. */
  entry: BusinessHubEntry | null;
  /** The brand's entries, to say when a save replaces one. */
  entries: BusinessHubEntry[];
  onSaved: () => void;
  /** More ways in, under the fields (the CSV import). */
  footer?: React.ReactNode;
}) {
  const t = useTranslations('insights.businessHub');
  const [draft, setDraft] = useState<EntryDraft>(() => draftOf(entry));
  const [problems, setProblems] = useState<Problems>({});
  const [saving, setSaving] = useState(false);

  // A fresh draft each time it opens: the entry to edit, or yesterday's blank one.
  useEffect(() => {
    if (!open) return;
    setDraft(draftOf(entry));
    setProblems({});
  }, [open, entry]);

  const set = (patch: Partial<EntryDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const replaces =
    !entry &&
    entries.some((e) => e.periodDays === draft.periodDays && e.periodEnd === draft.periodEnd);

  const save = async () => {
    const checked = checkDraft(draft);
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    setProblems({});
    setSaving(true);
    try {
      const result = await saveBusinessHubSnapshot(brandId, checked.entry);
      if ('error' in result) {
        if (result.error === 'invalid' && result.field) {
          const field = (['periodEnd', 'topics', ...COUNTS] as string[]).includes(result.field)
            ? (result.field as DraftField)
            : 'entry';
          setProblems({ [field]: (result.reason as DraftProblem) ?? 'invalid' });
          return;
        }
        toast.error(
          result.error === 'demo' ? t('demo') : result.error === 'off' ? t('off') : t('saveFailed'),
        );
        return;
      }
      toast.success(t('saved'));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const error = (field: DraftField | 'entry') =>
    problems[field] ? (
      <p className="text-xs text-red-600 dark:text-red-400" role="alert">
        {t(`dialog.${problemKey(field, problems[field])}`)}
      </p>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? t('dialog.editTitle') : t('dialog.title')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-medium">{t('dialog.days')}</legend>
              <div className="flex gap-1.5">
                {PERIOD_DAYS.map((days) => (
                  <Button
                    key={days}
                    type="button"
                    size="sm"
                    variant={draft.periodDays === days ? 'default' : 'outline'}
                    aria-pressed={draft.periodDays === days}
                    disabled={Boolean(entry)}
                    onClick={() => set({ periodDays: days })}
                  >
                    {t(days === 7 ? 'dialog.days7' : 'dialog.days28')}
                  </Button>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="bh-last-day">{t('dialog.lastDay')}</Label>
              <Input
                id="bh-last-day"
                type="date"
                value={draft.periodEnd}
                disabled={Boolean(entry)}
                aria-invalid={Boolean(problems.periodEnd)}
                onChange={(event) => set({ periodEnd: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">{t('dialog.lastDayHint')}</p>
              {error('periodEnd')}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {COUNTS.map((field) => (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={`bh-${field}`}>{t(`dialog.${field}`)}</Label>
                <Input
                  id={`bh-${field}`}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={t('dialog.emptyPlaceholder')}
                  value={draft[field]}
                  aria-invalid={Boolean(problems[field])}
                  onChange={(event) => set({ [field]: event.target.value })}
                />
                {error(field)}
              </div>
            ))}
          </div>
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-sm font-medium">{t('dialog.topics')}</legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {draft.topics.slice(0, MAX_TOPICS).map((topic, i) => (
                <Input
                  key={i}
                  aria-label={t('dialog.topicPlaceholder', { n: i + 1 })}
                  placeholder={t('dialog.topicPlaceholder', { n: i + 1 })}
                  maxLength={TOPIC_CHARS}
                  value={topic}
                  onChange={(event) =>
                    set({
                      topics: draft.topics.map((t, j) => (j === i ? event.target.value : t)),
                    })
                  }
                />
              ))}
            </div>
            {error('topics')}
          </fieldset>
          {replaces && <p className="text-xs text-muted-foreground">{t('dialog.replaces')}</p>}
          {error('entry')}
          {footer}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {t('dialog.cancel')}
            </Button>
            <Button type="submit" disabled={saving} className={cn(saving && 'gap-1.5')}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? t('dialog.saving') : t('dialog.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
