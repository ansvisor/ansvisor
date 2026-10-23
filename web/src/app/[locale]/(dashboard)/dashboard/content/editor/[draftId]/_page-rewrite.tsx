'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { passageKey } from '@/lib/content/cited-passages';
import { cleanHtml } from '@/lib/content/clean-html';
import { pageTextLength } from '@/lib/content/rules';
import type { DraftSuggestion, SuggestionStatus } from '@/lib/content/suggestions';
import { cn } from '@/lib/utils';

/**
 * Rewrite the page to these rules: the Content Agent's whole page, one
 * suggestion (kind 'page', 00247). The bar over the page says what it did,
 * Compare shows it beside the page as the agent read it, and Accept puts it
 * in place (History keeps the page first); Undo puts the page back.
 */

/** Blocks whose words a line break or a missing space must not run together. */
const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, div, br';

/**
 * The page's words, one space apart: formatting, markup and the space
 * between blocks don't count, so the editor's HTML (no space between
 * blocks) and stored HTML (line breaks between them) read the same.
 */
function wordsOf(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style').forEach((el) => el.remove());
  doc.querySelectorAll(BLOCKS).forEach((el) => el.append(' '));
  return passageKey(doc.body.textContent ?? '');
}

/** Whether the page's words changed since the agent read it (or since it was put in place). */
export function pageChangedSince(currentHtml: string, readHtml: string): boolean {
  return wordsOf(currentHtml) !== wordsOf(readHtml);
}

const REWRITE_KEY = (draftId: string) => `aeo:page-rewrite:${draftId}`;

/**
 * This browser started a rewrite of the draft: its waiting view and a failed
 * run say so, and Try again rewrites again, after a reload or a closed tab
 * too. Per viewer: on another device the agent's usual copy shows.
 */
export function rememberRewrite(draftId: string) {
  try {
    localStorage.setItem(REWRITE_KEY(draftId), '1');
  } catch {
    // No storage (a private window): the plain agent copy shows instead.
  }
}

export function wasRewrite(draftId: string): boolean {
  try {
    return localStorage.getItem(REWRITE_KEY(draftId)) === '1';
  } catch {
    return false;
  }
}

export function forgetRewrite(draftId: string) {
  try {
    localStorage.removeItem(REWRITE_KEY(draftId));
  } catch {
    // Nothing to forget.
  }
}

/** The page as it reads, for Compare: the editor's prose, smaller. */
const PAGE_CLASS = cn(
  'prose prose-sm prose-neutral max-w-none dark:prose-invert',
  'prose-a:font-normal prose-a:text-blue-600 prose-a:underline dark:prose-a:text-blue-400',
  '[&_table]:w-full [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1',
  '[&_td>p]:my-0 [&_th>p]:my-0 [&_li>p]:my-0',
  // A page to read side by side: its links don't leave the editor.
  '[&_a]:pointer-events-none',
);

function PageColumn({ label, html }: { label: string; html: string }) {
  // Cleaned as a paste is: what the page holds, never a script that runs.
  const clean = useMemo(() => cleanHtml(html, { keepImages: true }).html, [html]);
  return (
    <section aria-label={label} className="flex min-h-0 min-w-0 flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      <div
        className={cn(PAGE_CLASS, 'min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card p-4')}
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    </section>
  );
}

/** The characters of a page rewrite's page before and after, as the Rules tab counts them. */
export function pageCharacters(suggestion: DraftSuggestion): { before: number; after: number } {
  return {
    before: pageTextLength(suggestion.beforeHtml ?? ''),
    after: pageTextLength(suggestion.afterText),
  };
}

/**
 * Compare: the page as the agent read it and the rewrite, side by side, with
 * Reject and Accept while it is open.
 */
export function PageCompareDialog({
  suggestion,
  open,
  onOpenChange,
  busy,
  onDecide,
}: {
  suggestion: DraftSuggestion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onDecide: (status: SuggestionStatus) => void;
}) {
  const t = useTranslations('contentEditor.editor.rewrite');
  const { before, after } = pageCharacters(suggestion);
  const decide = (status: SuggestionStatus) => {
    onOpenChange(false);
    onDecide(status);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t('compareTitle')}</DialogTitle>
          <DialogDescription>
            {t('characters', { before, after })} · {suggestion.reason}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2 md:overflow-hidden">
          <PageColumn label={t('before', { count: before })} html={suggestion.beforeHtml ?? ''} />
          <PageColumn label={t('after', { count: after })} html={suggestion.afterText} />
        </div>
        {suggestion.status === 'open' && (
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => decide('rejected')}>
              {t('reject')}
            </Button>
            <Button disabled={busy} onClick={() => decide('accepted')}>
              {t('accept')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
