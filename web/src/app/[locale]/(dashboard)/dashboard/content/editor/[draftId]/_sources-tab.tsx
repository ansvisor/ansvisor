'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { getDraftSources, setDraftSourceIncluded } from '@/lib/actions/content-drafts';
import { platformNames } from '@/lib/content/impact';
import {
  buildSourceGroups,
  includedCounts,
  readDraftDoc,
  usedIn,
  type DraftSourceChoice,
  type DraftSourceRow,
  type DraftSourcesData,
  type UsedIn,
} from '@/lib/content/sources';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AddSourceDialog } from './_add-source-dialog';

type SourcesRead =
  | { data: DraftSourcesData; choices: DraftSourceChoice[]; failed: false }
  | { data: null; choices: []; failed: true };

/**
 * The Sources tab (Content Editor CE-008, spec §10): every source the draft
 * draws on, by name, grouped — its prompts, the searches AI ran for them, the
 * pages their answers cite, and the brand's Search Console queries — each
 * with its numbers and where the draft uses it as written now. A person
 * unchecks a source to leave it out, or adds a prompt, a page or a query.
 */
export function SourcesTab({
  draftId,
  brandId,
  title,
  sourceUrl,
  bodyHtml,
}: {
  draftId: string;
  brandId: string;
  title: string;
  sourceUrl: string | null;
  bodyHtml: string;
}) {
  const t = useTranslations('contentEditor.editor.sources');
  const [read, setRead] = useState<SourcesRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDraftSources(draftId)
      .then((result) => {
        if (cancelled) return;
        setRead(
          result
            ? { data: result.data, choices: result.choices, failed: false }
            : { data: null, choices: [], failed: true },
        );
      })
      .catch((err) => {
        console.error('Failed to read the draft sources:', err);
        if (!cancelled) setRead({ data: null, choices: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [draftId, attempt]);

  // Where each source is used follows the page as it is written, a beat behind typing.
  const html = useDeferredValue(bodyHtml);
  const doc = useMemo(() => readDraftDoc(html), [html]);
  const groups = useMemo(
    () => (read?.data ? buildSourceGroups(read.data, read.choices, { title, sourceUrl }) : []),
    [read, title, sourceUrl],
  );

  if (!read) {
    return (
      <div className="flex justify-center py-8" aria-busy="true">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (read.failed) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {t('loadError')}
        <button
          type="button"
          className="font-medium underline"
          onClick={() => {
            setRead(null);
            setAttempt((n) => n + 1);
          }}
        >
          {t('retry')}
        </button>
      </p>
    );
  }

  const counts = includedCounts(groups);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const listed = groups.reduce((n, g) => n + g.rows.length, 0);

  // Each toggle changes its own row from the latest state, so quick toggles
  // don't overwrite each other, and a failed one puts back only that row.
  const toggle = async (row: DraftSourceRow, included: boolean) => {
    const isRow = (c: DraftSourceChoice) => c.kind === row.kind && c.ref === row.ref;
    const before = read.choices.find(isRow);
    const withRow =
      (choice: DraftSourceChoice | undefined) =>
      (prev: SourcesRead | null): SourcesRead | null =>
        prev && !prev.failed
          ? {
              ...prev,
              choices: [...prev.choices.filter((c) => !isRow(c)), ...(choice ? [choice] : [])],
            }
          : prev;
    setRead(withRow({ kind: row.kind, ref: row.ref, included, added: row.added }));
    try {
      await setDraftSourceIncluded(draftId, { kind: row.kind, ref: row.ref, included });
    } catch (err) {
      console.error('Failed to change a draft source:', err);
      setRead(withRow(before));
      toast.error(t('toggleFailed'));
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1 rounded-lg bg-muted/50 px-3 py-2">
        <p className="font-medium">{t('summary', { count: total })}</p>
        <p className="text-xs text-muted-foreground">
          {t('summaryParts', {
            prompts: counts.prompt,
            fanouts: counts.fanout,
            pages: counts.cited_page,
            queries: counts.gsc_query,
          })}
        </p>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>

      {listed === 0 ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        groups.map((group) =>
          group.rows.length === 0 ? null : (
            <section key={group.kind} className="space-y-1.5">
              <h4 className="text-xs font-medium text-muted-foreground">
                {t(`groups.${group.kind}`)}{' '}
                <span className="font-normal">· {formatNumber(group.rows.length)}</span>
              </h4>
              <ul className="divide-y rounded-lg border">
                {group.rows.map((row) => (
                  <SourceRow
                    key={`${row.kind}:${row.ref}`}
                    row={row}
                    used={usedIn(row, doc, { sourceUrl })}
                    onToggle={(included) => void toggle(row, included)}
                  />
                ))}
              </ul>
            </section>
          ),
        )
      )}

      <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
        <Plus className="h-3.5 w-3.5" />
        {t('add.button')}
      </Button>
      <AddSourceDialog
        open={adding}
        onOpenChange={setAdding}
        draftId={draftId}
        brandId={brandId}
        gscQueries={read.data.gscQueries}
        listed={groups.flatMap((g) => g.rows.map((r) => `${r.kind}:${r.ref}`))}
        onAdded={() => setAttempt((n) => n + 1)}
      />
    </div>
  );
}

function SourceRow({
  row,
  used,
  onToggle,
}: {
  row: DraftSourceRow;
  used: UsedIn | null;
  onToggle: (included: boolean) => void;
}) {
  const t = useTranslations('contentEditor.editor.sources');
  return (
    <li className={cn('flex items-start gap-2.5 px-3 py-2', !row.included && 'opacity-60')}>
      <Checkbox
        className="mt-0.5"
        checked={row.included}
        onCheckedChange={(checked) => onToggle(checked === true)}
        aria-label={t('include', { name: row.name })}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'line-clamp-2 text-xs font-medium',
            row.kind === 'cited_page' ? 'break-all' : 'break-words',
          )}
          title={row.name}
        >
          {row.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          <SourceDetail row={row} />
        </p>
      </div>
      <span
        className={cn(
          'max-w-[38%] shrink-0 truncate rounded-md px-1.5 py-0.5 text-[11px]',
          used ? 'bg-muted text-foreground' : 'text-muted-foreground',
        )}
        title={t('usedInHint')}
      >
        <UsedInLabel used={used} />
      </span>
    </li>
  );
}

function SourceDetail({ row }: { row: DraftSourceRow }) {
  const t = useTranslations('contentEditor.editor.sources.detail');
  const parts: string[] = [];
  switch (row.kind) {
    case 'prompt':
      parts.push(t('answers', { count: row.answers }), t('named', { count: row.mentioned }));
      if (row.citesPage) parts.push(t('citesPage'));
      break;
    case 'fanout':
      parts.push(platformNames(row.platforms).join(', '), t('searched', { count: row.searched }));
      break;
    case 'cited_page':
      if (row.citations !== null) parts.push(t('citations', { count: row.citations }));
      parts.push(t(`categories.${row.category}`));
      break;
    case 'gsc_query':
      if (row.clicks !== null && row.impressions !== null) {
        parts.push(
          t('clicks', { count: row.clicks }),
          t('impressions', { count: row.impressions }),
        );
      }
      break;
  }
  if (row.added) parts.push(t('added'));
  return <>{parts.filter(Boolean).join(' · ')}</>;
}

function UsedInLabel({ used }: { used: UsedIn | null }) {
  const t = useTranslations('contentEditor.editor.sources.usedIn');
  if (!used) return <>{t('none')}</>;
  switch (used.kind) {
    case 'heading':
      return (
        <>{used.level === 1 ? t('h1') : t('heading', { level: used.level, text: used.text })}</>
      );
    case 'paragraph':
      return <>{t('paragraph', { index: used.index })}</>;
    case 'thisPage':
      return <>{t('thisPage')}</>;
    case 'internalLink':
      return <>{t('internalLink')}</>;
    case 'outboundLink':
      return <>{t('outboundLink')}</>;
  }
}
