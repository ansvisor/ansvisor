'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { normalizeDomain } from '@/lib/citations/classify';
import type { ContentAuthor } from '@/lib/content/authors';
import { BAND_CLASSES, qualityBand } from '@/lib/content/quality';
import {
  authorProfile,
  FRESH_MONTHS,
  trustGain,
  type EeatCheckId,
  type Score,
  type TrustCheckId,
  type TrustRead,
} from '@/lib/content/quality-checks';
import type { QualityTodo } from '@/lib/content/quality-todos';
import {
  readabilityGain,
  SECTION_WORDS,
  type Readability,
  type ReadabilityCheck,
} from '@/lib/content/readability';
import { SITE_TRUST_PATH, siteTrustMissing, type SiteTrust } from '@/lib/content/site-trust';
import { cn } from '@/lib/utils';
import { MANAGE_AUTHORS_PATH } from './_author-menu';

/** What Quality reads from the draft and its author, for the segment and the header. */
export interface QualityRead {
  /** The page's Readability as written, or null before it is read. */
  readability: Readability | null;
  /** E-E-A-T from the author, or null before the authors are read. */
  eeat: Score<EeatCheckId> | null;
  /** Trust from the page's figures and links, its score null until a figure or a dated source is read. */
  trust: TrustRead | null;
  /** The page's author, or null for the organization byline. */
  author: ContentAuthor | null;
  /** Whether the member reading may edit that author in Settings › Authors. */
  canEdit: boolean;
  /** Whether the workspace has an author to pick (Settings › Authors). */
  hasAuthors: boolean;
  brandName: string;
  /** The brand's team as the page goes out without an author, in its language (teamName). */
  team: string;
  /** The site's trust in Site Audit (CE-043), or null while not read. */
  siteTrust: SiteTrust | null;
  /** What only the person can do (qualityTodos, CE-040). */
  todos: QualityTodo[];
}

type ScoreName = 'eeat' | 'trust' | 'readability';

export interface Suggestion {
  key: string;
  // E-E-A-T's are the person's to-dos.
  score: Exclude<ScoreName, 'eeat'>;
  gain: number;
  line: string;
  detail: string;
  /** The passage Show goes to, if any. */
  show: string | null;
  /** The source Keep keeps (CE-046): the person trusts it all the same. */
  keep?: string;
}

/**
 * Instructions › Quality (Quality spec §3, CE-039): the three scores read
 * from the draft and its author, each labelled an Ansvisor estimate, then
 * what only the person can do (Your to-dos, CE-040) and what would raise
 * them, the biggest gain first. A score shows once one of its checks is
 * live for the page.
 */
export function QualityTab({
  quality,
  onShow,
  onShowPlaceholder,
  onPickAuthor,
  onAddInput,
  onKeep,
}: {
  quality: QualityRead;
  /** Scrolls the draft to a passage and marks it. */
  onShow: (text: string) => void;
  /** Selects the page's first placeholder, to type over. */
  onShowPlaceholder: () => void;
  /** Opens the header's author menu. */
  onPickAuthor: () => void;
  /** Opens Brief › Your input (CE-048). */
  onAddInput?: () => void;
  /** Keeps a weak source or a competitor's on the page (CE-046). */
  onKeep?: (url: string) => void;
}) {
  const t = useTranslations('contentEditor.editor.quality');
  const tSite = useTranslations('audit.siteTrust.checks');
  const format = useFormatter();
  const { readability, eeat, trust, siteTrust } = quality;
  const siteMissing = siteTrust ? siteTrustMissing(siteTrust) : [];
  const scores: { name: ScoreName; score: number | null; empty: string }[] = [
    { name: 'eeat', score: eeat?.score ?? null, empty: t('notScored') },
    { name: 'trust', score: trust?.score ?? null, empty: t('notScored') },
    { name: 'readability', score: readability?.score ?? null, empty: t('tooShortShort') },
  ];
  const { todos } = quality;
  const todosLeft = todos.filter((todo) => !todo.done).length;
  const suggestions = [...readabilitySuggestions(t, readability), ...trustSuggestions(t, trust)]
    .filter((s) => s.gain > 0)
    .sort((a, b) => b.gain - a.gain);
  // Every live check has its points: none to raise, none of the person's left
  // (a page too short to read says so instead).
  const allDone = suggestions.length === 0 && todosLeft === 0 && readability?.score !== null;

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

      {todos.length > 0 && (
        <section aria-label={t('todos.title')} className="space-y-2">
          <h4 className="text-xs text-muted-foreground">
            <span className="font-medium">{t('todos.title')}</span>{' '}
            {t('todos.left', { count: todosLeft })}
          </h4>
          <ul className="space-y-2">
            {todos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                quality={quality}
                onShowPlaceholder={onShowPlaceholder}
                onPickAuthor={onPickAuthor}
                onAddInput={onAddInput}
              />
            ))}
          </ul>
        </section>
      )}

      {(suggestions.length > 0 || allDone) && (
        <section aria-label={t('suggestionsLabel')} className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{t('suggestionsLabel')}</h4>
          {allDone ? (
            <p className="text-xs text-muted-foreground">{t('nothingToRaise')}</p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li key={s.key} className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5">
                  <span className="mt-0.5 shrink-0 rounded-md bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 tabular-nums dark:bg-emerald-950 dark:text-emerald-300">
                    {t('gain', { gain: s.gain, score: t(`names.${s.score}`) })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium [overflow-wrap:anywhere]">{s.line}</p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {s.detail}
                    </p>
                  </div>
                  {s.show !== null && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0"
                      onClick={() => onShow(s.show!)}
                    >
                      {t('show')}
                    </Button>
                  )}
                  {s.keep && onKeep && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0"
                      onClick={() => onKeep(s.keep!)}
                    >
                      {t('keep')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {siteTrust && (
        <section
          aria-label={t('site.label')}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-xs"
        >
          <span className="font-medium">{t('site.score', { score: siteTrust.score })}</span>
          {siteMissing.length > 0 && (
            <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
              <span aria-hidden>· </span>
              {t('site.missing', {
                checks: format.list(siteMissing.map((check) => tSite(`${check}.name`))),
              })}
            </span>
          )}
          {siteMissing.length > 0 && (
            <Link
              href={SITE_TRUST_PATH}
              className="ml-auto font-medium text-foreground underline-offset-2 hover:underline"
            >
              {t('site.fix')}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}

/** A to-do's words: its title, the nudge's "Next for you" phrase and its detail line. */
export function useTodoCopy() {
  const t = useTranslations('contentEditor.editor.quality.todos');
  return (
    todo: QualityTodo,
    { author, team, canEdit }: Pick<QualityRead, 'author' | 'team' | 'canEdit'>,
  ) => {
    if (todo.id === 'placeholders') {
      const count = todo.count ?? 0;
      return {
        title: t('placeholders.title', { count }),
        next: t('placeholders.next', { count }),
        detail: todo.done ? t('placeholders.done') : t('placeholders.detail'),
      };
    }
    if (todo.id === 'byline') {
      const action = todo.action === 'addAuthor' ? 'addAuthor' : 'pickAuthor';
      return {
        title: t(`byline.title.${action}`),
        next: t(`byline.next.${action}`),
        detail:
          todo.done && author
            ? t('byline.done', { name: author.name })
            : action === 'addAuthor'
              ? t('byline.detail.addAuthor')
              : t('byline.detail.pickAuthor', { byline: team }),
      };
    }
    // What only the person can give (Brief › Your input, CE-048).
    if (todo.id === 'experience' || todo.id === 'originalData' || todo.id === 'expertQuote') {
      return {
        title: t(`${todo.id}.title`),
        next: t(`${todo.id}.next`),
        detail: todo.done
          ? t(`${todo.id}.done`)
          : todo.given
            ? t(`${todo.id}.given`)
            : t(`${todo.id}.detail`),
      };
    }
    if (!author) {
      return {
        title: t('authorProfile.titleNoAuthor'),
        next: t('authorProfile.nextNoAuthor'),
        detail: t('authorProfile.detail.noAuthor'),
      };
    }
    const { bio, links } = authorProfile(author);
    const missing = !bio && !links ? 'both' : !bio ? 'bio' : 'links';
    return {
      title: t('authorProfile.title', { name: author.name }),
      next: t('authorProfile.next', { name: author.name }),
      // Only whoever can edit the author is sent to; anyone else is told who can.
      detail: todo.done
        ? t('authorProfile.done')
        : canEdit
          ? t(`authorProfile.detail.${missing}`)
          : t(`authorProfile.askOthers.${missing}`, {
              name: author.name,
              member: author.userId ? 'yes' : 'no',
            }),
    };
  };
}

/**
 * A to-do: its box (checked once done, which the checks decide), what to
 * do, what it adds, and its one button while open.
 */
function TodoRow({
  todo,
  quality,
  onShowPlaceholder,
  onPickAuthor,
  onAddInput,
}: {
  todo: QualityTodo;
  quality: QualityRead;
  onShowPlaceholder: () => void;
  onPickAuthor: () => void;
  onAddInput?: () => void;
}) {
  const t = useTranslations('contentEditor.editor.quality');
  const { title, detail } = useTodoCopy()(todo, quality);
  return (
    <li
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3 py-2.5',
        todo.done && 'bg-muted/40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
          todo.done
            ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-emerald-950'
            : 'border-input bg-background',
        )}
      >
        {todo.done && <Check className="h-3 w-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'font-medium [overflow-wrap:anywhere]',
            todo.done && 'text-muted-foreground line-through',
          )}
        >
          {title}
          <span className="sr-only">
            {' · '}
            {todo.done ? t('todos.done') : t('todos.open')}
          </span>
        </p>
        <p
          className={cn(
            'text-xs text-muted-foreground [overflow-wrap:anywhere]',
            todo.done && 'line-through',
          )}
        >
          {detail}
          {!todo.done && todo.gain > 0 && (
            <>
              {' · '}
              <span className="font-medium whitespace-nowrap text-emerald-700 tabular-nums dark:text-emerald-300">
                {t('gain', { gain: todo.gain, score: t(`names.${todo.score}`) })}
              </span>
            </>
          )}
        </p>
      </div>
      {!todo.done &&
        todo.action &&
        (todo.action === 'showPlaceholder' ? (
          <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onShowPlaceholder}>
            {t('show')}
          </Button>
        ) : todo.action === 'addInput' ? (
          onAddInput && (
            <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onAddInput}>
              {t('addInput')}
            </Button>
          )
        ) : todo.action === 'pickAuthor' ? (
          <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onPickAuthor}>
            {t('pickAuthor')}
          </Button>
        ) : (
          <Link
            href={MANAGE_AUTHORS_PATH}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 shrink-0')}
          >
            {t(todo.action)}
          </Link>
        ))}
    </li>
  );
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
      show: check.at || null,
    }),
  );
}

/** A Trust suggestion: its check, and how many it names (Before you publish's warning). */
export type TrustSuggestion = Suggestion & { check: TrustCheckId; count: number };

/**
 * Trust's: figures without a source, sources past FRESH_MONTHS, links that
 * don't answer, each with Show on the first one in the page. A broken link
 * is listed before Trust is scored too, its gain out of the Phase 1 points.
 * Phase 2 (CE-046): weak or competitors' sources, Show and Keep on the first,
 * and no primary source among them.
 */
export function trustSuggestions(t: T, trust: TrustRead | null): TrustSuggestion[] {
  if (!trust) return [];
  const out: TrustSuggestion[] = [];
  if (trust.unsourced.length) {
    out.push({
      key: 'trust:claimsSourced',
      check: 'claimsSourced',
      score: 'trust',
      gain: trustGain(trust, ['claimsSourced']),
      line: t('checks.claimsSourced.line', { count: trust.unsourced.length }),
      count: trust.unsourced.length,
      detail: t('checks.claimsSourced.detail'),
      show: trust.unsourced[0],
    });
  }
  if (trust.stale.length) {
    out.push({
      key: 'trust:freshSources',
      check: 'freshSources',
      score: 'trust',
      gain: trustGain(trust, ['freshSources']),
      count: trust.stale.length,
      line: t('checks.freshSources.line', {
        count: trust.stale.length,
        total: trust.dated,
        months: FRESH_MONTHS,
      }),
      detail: t('checks.freshSources.detail'),
      show: trust.stale[0].text,
    });
  }
  // Only once Trust is scored: their gain out of the Phase 1 points would be made up.
  if (trust.weak.length && trust.score !== null) {
    const [first] = trust.weak;
    out.push({
      key: 'trust:noWeakSources',
      check: 'noWeakSources',
      score: 'trust',
      gain: trustGain(trust, ['noWeakSources']),
      line: t('checks.noWeakSources.line', { count: trust.weak.length }),
      count: trust.weak.length,
      detail: t('checks.noWeakSources.detail', {
        host: normalizeDomain(first.url),
        kind: first.kind,
      }),
      show: first.text,
      keep: first.url,
    });
  }
  const primary = trust.checks.find((c) => c.id === 'primarySources');
  if (primary && primary.points < primary.max && trust.score !== null) {
    out.push({
      key: 'trust:primarySources',
      check: 'primarySources',
      score: 'trust',
      gain: trustGain(trust, ['primarySources']),
      line: t('checks.primarySources.line'),
      count: 1,
      detail: t('checks.primarySources.detail'),
      show: null,
    });
  }
  if (trust.broken.length) {
    out.push({
      key: 'trust:noBrokenLinks',
      check: 'noBrokenLinks',
      score: 'trust',
      gain: trustGain(trust, ['noBrokenLinks']),
      line: t('checks.noBrokenLinks.line', { count: trust.broken.length }),
      count: trust.broken.length,
      detail: t('checks.noBrokenLinks.detail', {
        count: trust.broken.length,
        url: trust.broken[0].url,
      }),
      show: trust.broken[0].text,
    });
  }
  return out;
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
    // English reads by its band (as Site Audit does): over it, the page reads too simple.
    if (check.band) {
      return check.count > 0
        ? t('checks.readingLevel.detailSimple', check.band)
        : t('checks.readingLevel.detailBand', check.band);
    }
    return check.formula
      ? t('checks.readingLevel.detail', { target: check.target ?? 60 })
      : t('checks.readingLevel.detailLength');
  }
  return t(`checks.${check.id}.detail`);
}
