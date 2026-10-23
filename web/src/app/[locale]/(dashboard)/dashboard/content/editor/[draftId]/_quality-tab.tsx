'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import type { ContentAuthor } from '@/lib/content/authors';
import { BAND_CLASSES, qualityBand } from '@/lib/content/quality';
import {
  authorProfile,
  scoreGain,
  type EeatCheckId,
  type Score,
} from '@/lib/content/quality-checks';
import {
  readabilityGain,
  SECTION_WORDS,
  type Readability,
  type ReadabilityCheck,
} from '@/lib/content/readability';
import { cn } from '@/lib/utils';
import { MANAGE_AUTHORS_PATH } from './_author-menu';

/** What Quality reads from the draft and its author, for the segment and the header. */
export interface QualityRead {
  /** The page's Readability as written, or null before it is read. */
  readability: Readability | null;
  /** E-E-A-T from the author, or null before the authors are read. */
  eeat: Score<EeatCheckId> | null;
  /** Trust, or null while none of its checks is live for the page. */
  trust: Score | null;
  /** The page's author, or null for the organization byline. */
  author: ContentAuthor | null;
  /** Whether the member reading may edit that author in Settings › Authors. */
  canEdit: boolean;
  /** Whether the workspace has an author to pick (Settings › Authors). */
  hasAuthors: boolean;
  brandName: string;
}

type ScoreName = 'eeat' | 'trust' | 'readability';

interface Suggestion {
  key: string;
  score: ScoreName;
  gain: number;
  line: string;
  detail: string;
  action:
    | { kind: 'show'; text: string }
    | { kind: 'pickAuthor' }
    | { kind: 'manageAuthors'; label: 'addAuthor' | 'editAuthor' }
    | { kind: 'none' };
}

/**
 * Instructions › Quality (Quality spec §3, CE-039): the three scores read
 * from the draft and its author, each labelled an Ansvisor estimate, then
 * what would raise them, the biggest gain first. A score shows once one of
 * its checks is live for the page.
 */
export function QualityTab({
  quality,
  onShow,
  onPickAuthor,
}: {
  quality: QualityRead;
  /** Scrolls the draft to a passage and marks it. */
  onShow: (text: string) => void;
  /** Opens the header's author menu. */
  onPickAuthor: () => void;
}) {
  const t = useTranslations('contentEditor.editor.quality');
  const tAuthor = useTranslations('contentEditor.editor.author');
  const { readability, eeat, trust } = quality;
  const scores: { name: ScoreName; score: number | null; empty: string }[] = [
    { name: 'eeat', score: eeat?.score ?? null, empty: t('notScored') },
    { name: 'trust', score: trust?.score ?? null, empty: t('notScored') },
    { name: 'readability', score: readability?.score ?? null, empty: t('tooShortShort') },
  ];
  const suggestions = [
    ...readabilitySuggestions(t, readability),
    ...eeatSuggestions(t, quality, tAuthor('organization', { brand: quality.brandName })),
  ]
    .filter((s) => s.gain > 0)
    .sort((a, b) => b.gain - a.gain);

  return (
    <div className="space-y-4 text-sm">
      <section aria-label={t('scores')} className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {scores.map(({ name, score, empty }) => (
            <div key={name} className="min-w-0 rounded-xl border bg-card px-2.5 py-2">
              <p className="truncate text-xs text-muted-foreground">{t(`names.${name}`)}</p>
              {score === null ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{empty}</p>
              ) : (
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="text-xl font-semibold tabular-nums">{score}</span>
                  <span
                    className={cn(
                      'rounded-full border px-1.5 text-[10.5px] font-medium',
                      BAND_CLASSES[qualityBand(score)],
                    )}
                  >
                    {t(`bands.${qualityBand(score)}`)}
                  </span>
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('estimate')}</p>
        {readability?.score === null && (
          <p className="rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
            {t(readability?.unscored === 'language' ? 'notThisLanguage' : 'tooShort')}
          </p>
        )}
      </section>

      <section aria-label={t('suggestionsLabel')} className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">{t('suggestionsLabel')}</h4>
        {suggestions.length === 0 ? (
          // A page too short to read says so above.
          readability?.score !== null && (
            <p className="text-xs text-muted-foreground">{t('nothingToRaise')}</p>
          )
        ) : (
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s.key} className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5">
                <span className="mt-0.5 shrink-0 rounded-md bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 tabular-nums dark:bg-emerald-950 dark:text-emerald-300">
                  {t('gain', { gain: s.gain, score: t(`names.${s.score}`) })}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium [overflow-wrap:anywhere]">{s.line}</p>
                  <p className="text-xs text-muted-foreground">{s.detail}</p>
                </div>
                <SuggestionAction action={s.action} onShow={onShow} onPickAuthor={onPickAuthor} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** A suggestion's one button. */
function SuggestionAction({
  action,
  onShow,
  onPickAuthor,
}: {
  action: Suggestion['action'];
  onShow: (text: string) => void;
  onPickAuthor: () => void;
}) {
  const t = useTranslations('contentEditor.editor.quality');
  switch (action.kind) {
    case 'show':
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0"
          onClick={() => onShow(action.text)}
        >
          {t('show')}
        </Button>
      );
    case 'pickAuthor':
      return (
        <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onPickAuthor}>
          {t('pickAuthor')}
        </Button>
      );
    case 'manageAuthors':
      return (
        <Link
          href={MANAGE_AUTHORS_PATH}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 shrink-0')}
        >
          {t(action.label)}
        </Link>
      );
    case 'none':
      return null;
  }
}

type T = ReturnType<typeof useTranslations<'contentEditor.editor.quality'>>;

function readabilitySuggestions(t: T, readability: Readability | null): Suggestion[] {
  if (!readability || readability.score === null) return [];
  return readability.checks.map(
    (check): Suggestion => ({
      key: `readability:${check.id}`,
      score: 'readability',
      gain: readabilityGain(readability, check.id),
      line: line(t, check),
      detail: detail(t, check),
      action: check.at ? { kind: 'show', text: check.at } : { kind: 'none' },
    }),
  );
}

/**
 * E-E-A-T's: with no person on the page, picking one is the fix (its gain is
 * the byline's: what the author's profile adds depends on them), or adding
 * one when the workspace has none; with one, completing their profile. Only
 * whoever added the author, the author themself or an admin can, so anyone
 * else is told who to ask instead of being sent where they can't edit.
 */
function eeatSuggestions(t: T, quality: QualityRead, teamByline: string): Suggestion[] {
  const { eeat, author, canEdit, hasAuthors } = quality;
  if (!eeat || eeat.score === null) return [];
  if (!author) {
    return [
      {
        key: 'eeat:byline',
        score: 'eeat',
        gain: scoreGain(eeat, ['byline']),
        line: t('checks.byline.line', { byline: teamByline }),
        detail: t('checks.byline.detail'),
        action: hasAuthors ? { kind: 'pickAuthor' } : { kind: 'manageAuthors', label: 'addAuthor' },
      },
    ];
  }
  const { bio, links } = authorProfile(author);
  const missing = !bio && !links ? 'both' : !bio ? 'bio' : 'links';
  return [
    {
      key: 'eeat:authorProfile',
      score: 'eeat',
      gain: scoreGain(eeat, ['authorBio']),
      line: t(`checks.authorProfile.line.${missing}`, { name: author.name }),
      detail: canEdit
        ? t(`checks.authorProfile.detail.${missing}`)
        : t(`checks.authorProfile.askOthers.${missing}`, {
            name: author.name,
            member: author.userId ? 'yes' : 'no',
          }),
      action: canEdit ? { kind: 'manageAuthors', label: 'editAuthor' } : { kind: 'none' },
    },
  ];
}

/** A Readability check's one line: what the draft does now. */
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
