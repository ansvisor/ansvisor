'use client';

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ContentAuthor } from '@/lib/content/authors';
import {
  draftExportBlob,
  draftExportFileName,
  draftText,
  type DraftExportFormat,
  type ExportFields,
} from '@/lib/content/draft-export';
import { localDate } from '@/lib/content/page-schema';
import {
  exportPlaceholders,
  pageFields,
  titlePlaceholders,
  withByline,
  withoutLeadingH1,
  withoutPlaceholders,
  type PasteChecks,
} from '@/lib/content/ready-to-publish';
import { saveBlob } from '@/lib/download';
import { cn } from '@/lib/utils';
import { copyToClipboard } from './_html-block';

/** Where the page goes (Quality spec §7b), and how: pasted rich, downloaded, or as HTML. */
const DESTINATIONS = ['webflow', 'wordpress', 'shopify', 'docs', 'docx', 'md', 'html'] as const;
export type ExportDestination = (typeof DESTINATIONS)[number];
const FILES: Partial<Record<ExportDestination, DraftExportFormat>> = { docx: 'docx', md: 'md' };
/**
 * Destinations whose title field holds the page's title: its H1 isn't in
 * the content too (Markdown's front matter has it: draftMarkdown leaves it out).
 */
const TITLE_FIELD = new Set<ExportDestination>(['webflow', 'wordpress', 'shopify']);

/** Remembers the destination last picked, across drafts. */
const DESTINATION_KEY = 'aeo:content-export-destination';

function storedDestination(): ExportDestination {
  try {
    const stored = localStorage.getItem(DESTINATION_KEY);
    if (stored && (DESTINATIONS as readonly string[]).includes(stored)) {
      return stored as ExportDestination;
    }
  } catch {
    // Storage unavailable: the first one.
  }
  return 'webflow';
}

/**
 * The page on the clipboard as rich text (and its words as plain text), as
 * a CMS's editor or Google Docs pastes it: through the Clipboard API, else a
 * copy event. Says whether it got there as rich text.
 */
async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    // Refused (an older browser, no permission): the copy event below.
  }
  const put = (event: ClipboardEvent) => {
    event.clipboardData?.setData('text/html', html);
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  };
  document.addEventListener('copy', put);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', put);
  }
}

type RowState = 'ok' | 'missing' | 'check';

/**
 * Export (Content Editor Quality spec §7b, CE-057): the page ready to paste
 * or to save, for the destination picked. Its placeholders are filled first
 * or left out with their sentences (no export carries one; the title's and
 * the headings' are filled first); what it checks is listed (clean HTML,
 * links that answer, images with alt text); the page fields go next to it,
 * read from the page as it goes out, each with Copy. Rendered only while
 * open, on the page as it was when it opened.
 */
export function ExportDialog({
  onClose,
  title,
  html,
  isNew,
  sourceUrl,
  author,
  teamByline,
  byline,
  checks,
  linksPending,
  initialDestination,
  onFillNow,
}: {
  onClose: () => void;
  title: string;
  /** The page as Copy HTML gives it (publishableHtml). */
  html: string;
  /** A new page; an optimized one is already live, with its published date. */
  isNew: boolean;
  /** The live page an optimized draft is for: its address is the slug. */
  sourceUrl: string | null;
  author: ContentAuthor | null;
  /** The team byline; empty while the authors aren't read. */
  teamByline: string;
  /** The byline line the brand puts in the content (Add byline to content), or null. */
  byline: string | null;
  checks: PasteChecks;
  /** The page's links whose read may still come. */
  linksPending: number;
  /** Copy HTML's: the HTML destination. */
  initialDestination?: ExportDestination;
  /** Goes to the first placeholder, to fill it. */
  onFillNow: () => void;
}) {
  const t = useTranslations('contentEditor.editor.exportDialog');
  const [destination, setDestination] = useState<ExportDestination>(
    () => initialDestination ?? storedDestination(),
  );
  const [skipPlaceholders, setSkipPlaceholders] = useState(false);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const placeholders = useMemo(
    () => exportPlaceholders(html) + titlePlaceholders(title, html),
    [html, title],
  );
  const content = useMemo(
    () => (skipPlaceholders && placeholders ? withoutPlaceholders(html) : html),
    [skipPlaceholders, placeholders, html],
  );
  // What is still open once left out: the title's and the headings'.
  const left = useMemo(
    () =>
      skipPlaceholders
        ? exportPlaceholders(content) + titlePlaceholders(title, content)
        : placeholders,
    [skipPlaceholders, content, title, placeholders],
  );
  const ready = left === 0;
  const fields = useMemo(
    () => pageFields({ title, html: content, sourceUrl, author, teamByline }),
    [title, content, sourceUrl, author, teamByline],
  );
  // The brand's byline line under the H1 (the fields read the page without it).
  const withLine = useMemo(
    () => (byline ? withByline(content, byline) : content),
    [byline, content],
  );
  const out = TITLE_FIELD.has(destination) ? withoutLeadingH1(withLine) : withLine;

  const pick = (next: ExportDestination) => {
    setDestination(next);
    try {
      localStorage.setItem(DESTINATION_KEY, next);
    } catch {
      // The choice just won't be remembered.
    }
  };
  // Arrow keys move along the destinations, as in any radio group.
  const onRadioKey = (event: KeyboardEvent, i: number) => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as const)[
      event.key as 'ArrowRight'
    ];
    if (!step) return;
    event.preventDefault();
    const next = (i + step + DESTINATIONS.length) % DESTINATIONS.length;
    pick(DESTINATIONS[next]);
    radios.current[next]?.focus();
  };
  const exportFields: ExportFields = {
    table: {
      note: t('fields.note'),
      rows: [
        [t('fields.metaTitle'), fields.metaTitle],
        [t('fields.metaDescription'), fields.metaDescription],
        ...(fields.slug ? [[t('fields.slug'), fields.slug] as [string, string]] : []),
        ...(fields.author ? [[t('fields.author'), fields.author] as [string, string]] : []),
        ...(fields.featuredImage
          ? [[t('fields.featuredImage'), fields.featuredImage] as [string, string]]
          : []),
      ],
    },
    front: {
      title: fields.metaTitle,
      description: fields.metaDescription,
      slug: fields.slug,
      author: fields.author,
      // As Before you publish's JSON-LD: a live page keeps its published
      // date (a site's "date"), and today is when it was updated.
      ...(isNew ? { date: localDate(new Date()) } : { lastmod: localDate(new Date()) }),
      ...(fields.featuredImage ? { image: fields.featuredImage } : {}),
    },
    head: {
      title: fields.metaTitle,
      description: fields.metaDescription,
      author: fields.author,
    },
  };
  const download = async (format: DraftExportFormat) => {
    const name = title.trim() || t('untitled');
    try {
      saveBlob(
        await draftExportBlob(format, name, withLine, exportFields),
        draftExportFileName(name, format),
      );
    } catch (err) {
      console.error('Failed to export the page:', err);
      toast.error(t('failed'));
    }
  };
  const act = async () => {
    const file = FILES[destination];
    if (file) return download(file);
    if (destination === 'html') return copyToClipboard(out, t('copiedHtml'), t('copyFailed'));
    if (await copyRich(out, draftText('', out))) {
      toast.success(t('copied', { destination: t(`destinations.${destination}`) }));
      return;
    }
    // No rich text here: the HTML, said as such, for the editor's code view.
    await copyToClipboard(out, t('copiedAsHtml'), t('copyFailed'));
  };

  const rows: { state: RowState; title: string; detail: string }[] = [
    checks.ownCode
      ? {
          state: 'check',
          title: t('checks.ownCode.title'),
          detail: t('checks.ownCode.detail', { count: checks.ownCode }),
        }
      : { state: 'ok', title: t('checks.clean.title'), detail: t('checks.clean.detail') },
  ];
  if (checks.links.count) {
    const { count, read, broken } = checks.links;
    // The reads still coming are for some of the unread links at most, as
    // Before you publish counts them: the rest couldn't be read.
    const reading = Math.min(linksPending, count - read);
    const notRead = count - read - reading;
    rows.push(
      broken
        ? {
            state: 'missing',
            title: t('checks.links.broken', { broken, count }),
            detail: t('checks.links.brokenDetail'),
          }
        : reading && notRead
          ? {
              state: 'check',
              title: t('checks.links.readingAndUnread', { reading, unread: notRead, count }),
              detail: t('checks.links.unreadDetail'),
            }
          : reading
            ? {
                state: 'check',
                title: t('checks.links.reading', { reading, count }),
                detail: t('checks.links.readingDetail'),
              }
            : notRead
              ? {
                  // Some couldn't be read: no word on whether they answer.
                  state: 'check',
                  title: t('checks.links.unread', { unread: notRead, count }),
                  detail: t('checks.links.unreadDetail'),
                }
              : {
                  state: 'ok',
                  title: t('checks.links.ok', { count }),
                  detail: t('checks.links.okDetail'),
                },
    );
  }
  if (checks.images.count) {
    rows.push(
      checks.images.withoutAlt
        ? {
            state: 'missing',
            title: t('checks.images.missing', {
              missing: checks.images.withoutAlt,
              count: checks.images.count,
            }),
            detail: t('checks.images.missingDetail'),
          }
        : {
            state: 'ok',
            title: t('checks.images.ok', { count: checks.images.count }),
            detail: t('checks.images.okDetail'),
          },
    );
  }
  const fieldRows: { label: string; value: string | null; shown?: string }[] = [
    { label: t('fields.metaTitle'), value: fields.metaTitle },
    { label: t('fields.metaDescription'), value: fields.metaDescription },
    {
      label: t('fields.slug'),
      value: fields.slug || null,
      shown: fields.slug || t('fields.noSlug'),
    },
    {
      label: t('fields.author'),
      value: fields.author || null,
      shown: fields.author
        ? t(byline ? 'fields.authorInContent' : 'fields.authorValue', { name: fields.author })
        : t('fields.noAuthor'),
    },
    {
      label: t('fields.featuredImage'),
      value: fields.featuredImage,
      shown: fields.featuredImage ?? t('fields.noImage'),
    },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <div role="radiogroup" aria-label={t('destination')} className="flex flex-wrap gap-1.5">
            {DESTINATIONS.map((d, i) => (
              <button
                key={d}
                ref={(el) => void (radios.current[i] = el)}
                type="button"
                role="radio"
                aria-checked={d === destination}
                tabIndex={d === destination ? 0 : -1}
                onClick={() => pick(d)}
                onKeyDown={(event) => onRadioKey(event, i)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium',
                  d === destination
                    ? 'border-foreground bg-foreground text-background'
                    : 'bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`destinations.${d}`)}
              </button>
            ))}
          </div>
          <DialogDescription className="text-xs">{t(`hints.${destination}`)}</DialogDescription>
        </div>

        {placeholders > 0 &&
          (skipPlaceholders ? (
            <div
              role="status"
              className={cn(
                'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3 py-2.5 text-sm',
                !ready &&
                  'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
              )}
            >
              <span className="min-w-0 flex-1">
                {ready
                  ? t('placeholders.left', { count: placeholders })
                  : t('placeholders.headings', { count: left })}
              </span>
              {!ready && (
                <Button variant="outline" size="sm" className="h-7" onClick={onFillNow}>
                  {t('placeholders.fill')}
                </Button>
              )}
              <button
                type="button"
                className="text-xs font-medium underline-offset-2 hover:underline"
                onClick={() => setSkipPlaceholders(false)}
              >
                {t('placeholders.undo')}
              </button>
            </div>
          ) : (
            <div
              role="alert"
              className="flex flex-wrap items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            >
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 flex-1">{t('placeholders.open', { count: placeholders })}</p>
              <div className="flex w-full justify-end gap-2">
                <Button variant="outline" size="sm" className="h-7" onClick={onFillNow}>
                  {t('placeholders.fill')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => setSkipPlaceholders(true)}
                >
                  {t('placeholders.skip')}
                </Button>
              </div>
            </div>
          ))}

        <section aria-label={t('checks.label')} className="space-y-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">{t('checks.label')}</h3>
          <ul className="divide-y rounded-xl border text-sm">
            {rows.map((row) => (
              <li key={row.title} className="flex items-start gap-2.5 px-3 py-2.5">
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                    row.state === 'ok'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : row.state === 'missing'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {row.state === 'ok' ? (
                    <Check className="h-3 w-3" />
                  ) : row.state === 'missing' ? (
                    '!'
                  ) : (
                    '?'
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {row.title}
                    <span className="sr-only">
                      {' · '}
                      {t(`states.${row.state}`)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{row.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label={t('fields.label')} className="space-y-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t('fields.label')} <span className="font-normal">· {t('fields.where')}</span>
          </h3>
          <dl className="divide-y rounded-xl border text-sm">
            {fieldRows.map((row) => (
              <div key={row.label} className="flex items-start gap-2.5 px-3 py-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 flex-1 text-xs [overflow-wrap:anywhere]">
                  {row.shown ?? row.value}
                </dd>
                {row.value && (
                  <button
                    type="button"
                    aria-label={t('fields.copyLabel', { field: row.label })}
                    className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      void copyToClipboard(
                        row.value!,
                        t('fields.copied', { field: row.label }),
                        t('copyFailed'),
                      )
                    }
                  >
                    {t('fields.copy')}
                  </button>
                )}
              </div>
            ))}
          </dl>
        </section>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          {destination === 'html' && (
            <Button variant="outline" disabled={!ready} onClick={() => void download('html')}>
              {t('actions.downloadHtml')}
            </Button>
          )}
          <Button disabled={!ready} onClick={() => void act()}>
            {t(`actions.${destination}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
