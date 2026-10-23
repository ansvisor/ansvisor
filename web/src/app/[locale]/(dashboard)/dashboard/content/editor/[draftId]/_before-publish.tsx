'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  articleJsonLd,
  isArticlePage,
  jsonLdScript,
  localDate,
  titleHasPlaceholder,
} from '@/lib/content/page-schema';
import { cn } from '@/lib/utils';
import { copyToClipboard } from './_html-block';
import { trustSuggestions, type QualityRead } from './_quality-tab';

/** Trust under this warns before the page is marked ready (Quality spec §7). */
export const TRUST_GATE = 60;

/** The warning's facts, logged when the page is marked ready anyway. */
export interface ReadyAnyway {
  trust: number;
  /** The Trust check the warning named, and how many it counted. */
  reason: string | null;
  count: number | null;
}

type RowState = 'missing' | 'check';

/**
 * Before you publish (Content Editor Quality spec §7, CE-041), on Mark
 * ready: a warning only when Trust is under 60 (nothing else blocks), what
 * the CMS does for the page (its author, dates and schema), and for an
 * article the JSON-LD to paste when the CMS doesn't write one, from the
 * page's facts only. Mark ready anyway is logged with the Trust the page
 * had. Rendered only while open.
 */
export function BeforePublish({
  onClose,
  quality,
  title,
  isNew,
  pageType,
  image,
  linksPending,
  onMarkReady,
  onFixFirst,
}: {
  onClose: () => void;
  quality: QualityRead;
  title: string;
  /** A new page; an optimized one is already live, with its published date. */
  isNew: boolean;
  pageType: string | null;
  /** The page's own image (firstImage). */
  image: string | null;
  /** The page's links whose read may still come: Trust may change. */
  linksPending: number;
  /** Marks it ready: with the warning's facts when past it. */
  onMarkReady: (anyway: ReadyAnyway | null) => void;
  /** Goes to what would raise Trust, the passage named first. */
  onFixFirst: (show: string | null) => void;
}) {
  const t = useTranslations('contentEditor.editor.beforePublish');
  const tQuality = useTranslations('contentEditor.editor.quality');
  const tAuthor = useTranslations('contentEditor.editor.author');
  const markRef = useRef<HTMLButtonElement>(null);
  // Fix first moves on to the passage: focus isn't sent back to Mark ready.
  const fixing = useRef(false);
  const { author, brandName, siteTrust } = quality;
  // E-E-A-T is read with the authors: until then, who the page is by isn't known.
  const authorsRead = quality.eeat !== null;
  const trust = quality.trust?.score ?? null;
  const below = trust !== null && trust < TRUST_GATE;
  // The biggest of what would raise Trust: the warning's reason.
  const [fix] = below
    ? trustSuggestions(tQuality, quality.trust)
        .filter((s) => s.gain > 0)
        .sort((a, b) => b.gain - a.gain)
    : [];
  const article = isArticlePage(pageType);
  const jsonLd = article
    ? jsonLdScript(
        articleJsonLd({
          title,
          author: authorsRead ? author : undefined,
          authorUrl:
            (author &&
              siteTrust?.checks.authorPages.authors.find((a) => a.name === author.name)?.url) ||
            null,
          brandName,
          brandUrl: siteTrust?.checks.organizationSchema.url ?? null,
          image,
          isNew,
          today: localDate(new Date()),
        }),
      )
    : null;
  const rows: { state: RowState; title: string; detail: string }[] = [
    !authorsRead
      ? { state: 'check', title: t('author.ok'), detail: t('author.unknown') }
      : author
        ? {
            state: 'check',
            title: t('author.ok'),
            detail: t('author.okDetail', { name: author.name }),
          }
        : {
            state: 'missing',
            title: t('author.none'),
            detail: t('author.noneDetail', {
              byline: tAuthor('organization', { brand: brandName }),
            }),
          },
    ...(article
      ? [
          { state: 'check' as const, title: t('dates.title'), detail: t('dates.detail') },
          isNew
            ? { state: 'check' as const, title: t('schema.title'), detail: t('schema.detail') }
            : {
                state: 'check' as const,
                title: t('schema.titleLive'),
                detail: t('schema.detailLive'),
              },
        ]
      : [{ state: 'check' as const, title: t('schema.other'), detail: t('schema.otherDetail') }]),
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        initialFocus={markRef}
        finalFocus={() => !fixing.current}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        {below && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 space-y-1">
              <p>
                {fix
                  ? t('warning', {
                      trust,
                      reason: fix.line,
                      count: fix.count,
                      raised: trust + fix.gain,
                    })
                  : t('warningNoReason', { trust })}
              </p>
              <p className="text-xs opacity-80">{t('logged')}</p>
            </div>
          </div>
        )}
        {linksPending > 0 && (
          <p role="status" className="text-xs text-muted-foreground">
            {t('linksPending', { count: linksPending })}
          </p>
        )}
        <ul className="divide-y rounded-xl border text-sm">
          {rows.map((row) => (
            <li key={row.title} className="flex items-start gap-2.5 px-3 py-2.5">
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                  row.state === 'missing'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {row.state === 'missing' ? '!' : '?'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {row.title}
                  <span className="sr-only">
                    {' · '}
                    {t(`states.${row.state}`)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {row.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {jsonLd && (
          <div className="space-y-1.5">
            <pre
              aria-label={t('jsonLd')}
              tabIndex={0}
              className="max-h-48 overflow-auto rounded-xl border bg-muted/40 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {jsonLd}
            </pre>
            {titleHasPlaceholder(title) && (
              <p className="text-xs text-amber-700 dark:text-amber-300">{t('headlineLeftOut')}</p>
            )}
            <p className="text-xs text-muted-foreground">{t('datesNote')}</p>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          {jsonLd ? (
            <Button
              variant="outline"
              onClick={() => void copyToClipboard(jsonLd, t('copied'), t('copyFailed'))}
            >
              {t('copy')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {below && (
              <Button
                variant="outline"
                onClick={() => {
                  fixing.current = true;
                  onFixFirst(fix?.show ?? null);
                }}
              >
                {t('fixFirst')}
              </Button>
            )}
            <Button
              ref={markRef}
              onClick={() =>
                onMarkReady(
                  below ? { trust, reason: fix?.check ?? null, count: fix?.count ?? null } : null,
                )
              }
            >
              {below ? t('markReadyAnyway') : t('markReady')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
