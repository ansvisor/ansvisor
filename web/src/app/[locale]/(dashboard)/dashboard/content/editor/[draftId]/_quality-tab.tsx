'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { BAND_CLASSES, qualityBand } from '@/lib/content/quality';
import {
  readabilityGain,
  SECTION_WORDS,
  type Readability,
  type ReadabilityCheck,
} from '@/lib/content/readability';
import { cn } from '@/lib/utils';

/**
 * Instructions › Quality (Quality spec §3, CE-039): the scores read from the
 * draft, each labelled an Ansvisor estimate, then what would raise them, the
 * biggest gain first. Phase 1 reads Readability; E-E-A-T and Trust join as
 * their checks go live.
 */
export function QualityTab({
  readability,
  onShow,
}: {
  /** The draft's Readability as written, or null before it is read. */
  readability: Readability | null;
  /** Scrolls the draft to a passage and marks it. */
  onShow: (text: string) => void;
}) {
  const t = useTranslations('contentEditor.editor.quality');
  const score = readability?.score ?? null;
  const suggestions = (readability?.checks ?? [])
    .map((check) => ({ check, gain: readabilityGain(readability!, check.id) }))
    .filter(({ gain }) => gain > 0)
    .sort((a, b) => b.gain - a.gain);

  return (
    <div className="space-y-4 text-sm">
      <section aria-label={t('scores')} className="space-y-2">
        {score === null ? (
          <p className="rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
            {t(readability?.unscored === 'language' ? 'notThisLanguage' : 'tooShort')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[8.5rem] rounded-xl border bg-card px-3 py-2">
              <p className="text-xs text-muted-foreground">{t('names.readability')}</p>
              <p className="mt-0.5 flex items-center gap-2">
                <span className="text-xl font-semibold tabular-nums">{score}</span>
                <span
                  className={cn(
                    'rounded-full border px-2 text-[11px] font-medium',
                    BAND_CLASSES[qualityBand(score)],
                  )}
                >
                  {t(`bands.${qualityBand(score)}`)}
                </span>
              </p>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t('estimate')}</p>
      </section>

      {score !== null && (
        <section aria-label={t('suggestionsLabel')} className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{t('suggestionsLabel')}</h4>
          {suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('nothingToRaise')}</p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map(({ check, gain }) => (
                <li
                  key={check.id}
                  className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5"
                >
                  <span className="mt-0.5 shrink-0 rounded-md bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 tabular-nums dark:bg-emerald-950 dark:text-emerald-300">
                    {t('gain', { gain, score: t('names.readability') })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium [overflow-wrap:anywhere]">{line(t, check)}</p>
                    <p className="text-xs text-muted-foreground">{detail(t, check)}</p>
                  </div>
                  {check.at && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0"
                      onClick={() => onShow(check.at!)}
                    >
                      {t('show')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

type T = ReturnType<typeof useTranslations<'contentEditor.editor.quality'>>;

/** A check's one line: what the draft does now. */
function line(t: T, check: ReadabilityCheck): string {
  switch (check.id) {
    case 'avgSentence':
      return t('checks.avgSentence.line', { words: check.value });
    case 'longSentences':
      return t('checks.longSentences.line', { count: check.count });
    case 'readingLevel':
      return check.formula
        ? t('checks.readingLevel.line', {
            score: check.value,
            formula: t(`formulas.${check.formula}`),
          })
        : t('checks.readingLevel.lineLength');
    case 'answerFirst':
      return t('checks.answerFirst.line');
    case 'shortParagraphs':
      return t('checks.shortParagraphs.line', { count: check.count });
    case 'headingSpacing':
      return t('checks.headingSpacing.line', { count: check.count, words: SECTION_WORDS });
    case 'passiveJargon':
      return t('checks.passiveJargon.line', { passive: check.count, jargon: check.value });
  }
}

/** Its detail line: what to do. */
function detail(t: T, check: ReadabilityCheck): string {
  if (check.id === 'avgSentence' && check.count < 0) return t('checks.avgSentence.detailShort');
  if (check.id === 'readingLevel') {
    return check.formula
      ? t('checks.readingLevel.detail', { target: check.target ?? 60 })
      : t('checks.readingLevel.detailLength');
  }
  return t(`checks.${check.id}.detail`);
}
