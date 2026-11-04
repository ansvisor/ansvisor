'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Undo2 } from 'lucide-react';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import type { ChatPageVersion } from '@/lib/chat/events';

/** The sections a card shows before Show all. */
const PREVIEWED = 2;

/** "Version 2 · 7 questions · 905 characters": a FAQ by its questions, any other page by its sections. */
export function useVersionLine() {
  const t = useTranslations('chatDeliverable.version');
  return (version: ChatPageVersion) =>
    t('line', {
      n: version.n,
      parts:
        version.counts.questions > 0
          ? t('questions', { count: version.counts.questions })
          : t('sections', { count: version.counts.sections }),
      characters: version.counts.characters,
    });
}

/**
 * A page's version in chat (CHAT-25 §6, mockup #e-chat; W4-12a), under its
 * card's title: What changed since the version before (sections made
 * shorter, with their characters before → after; new questions or sections;
 * placeholders to fill), the first sections with Show all, and Undo to the
 * version before, which puts History's page back (the editor's History). A
 * version saved to the Library each time, as the note says.
 */
export function VersionDetails({
  version,
  runId,
  n,
}: {
  version: ChatPageVersion;
  /**
   * The run and the card's place among its files: what Undo names (no id
   * reaches the page). 0 for a page Files didn't keep, which has no Undo.
   */
  runId: string;
  n: number;
}) {
  const t = useTranslations('chatDeliverable.version');
  const tReadOnly = useTranslations('readOnly.actions');
  const { guard } = useUpgradeGate();
  const [all, setAll] = useState(false);
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const { shortened, added, placeholders } = version.changes;
  const changed = version.n > 1 && (shortened.length > 0 || added.length > 0);
  const shown = all ? version.sections : version.sections.slice(0, PREVIEWED);
  const faq = version.counts.questions > 0;
  const undoable = version.canUndo === true && n > 0;

  async function undo() {
    if (!undoable || busy) return;
    setBusy(true);
    const res = await fetch(`/api/chat/runs/${runId}/files/${n}/undo`, { method: 'POST' }).catch(
      () => null,
    );
    setBusy(false);
    if (res?.ok) {
      setUndone(true);
      toast(t('undone', { n: version.n - 1 }));
    } else {
      toast.error(t('undoFailed'));
    }
  }

  return (
    <div data-slot="page-version" data-version={version.n} className="grid gap-2 text-[13px]">
      {(changed || placeholders.length > 0) && (
        <div data-slot="version-changes">
          <p className="text-xs font-semibold">{t('whatChanged')}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {version.n > 1 &&
              shortened.map((s) => (
                <li key={`s-${s.heading}`}>
                  {t('shortened', { heading: s.heading, before: s.before, after: s.after })}
                </li>
              ))}
            {version.n > 1 &&
              added.map((heading) => (
                <li key={`a-${heading}`}>
                  {t(heading.endsWith('?') ? 'newQuestion' : 'newSection', { heading })}
                </li>
              ))}
            {placeholders.length > 0 && (
              <li className="text-amber-700 dark:text-amber-400">
                {t('placeholders', {
                  count: placeholders.length,
                  list: placeholders.join(', '),
                })}
              </li>
            )}
          </ul>
        </div>
      )}
      {shown.length > 0 && (
        <dl data-slot="version-preview" className="grid gap-1.5">
          {shown.map((section, i) => (
            <div key={`${i}-${section.heading}`}>
              <dt className="font-medium">{section.heading}</dt>
              {section.text && <dd className="text-muted-foreground">{section.text}</dd>}
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {version.sections.length > PREVIEWED && (
          <button
            type="button"
            data-action="version.showAll"
            aria-expanded={all}
            onClick={() => setAll((open) => !open)}
            className="text-xs font-medium underline underline-offset-2"
          >
            {all
              ? t('showLess')
              : t(faq ? 'showAllQuestions' : 'showAllSections', {
                  count: faq ? version.counts.questions : version.counts.sections,
                })}
          </button>
        )}
        {undoable && (
          <button
            type="button"
            data-action="version.undo"
            disabled={busy || undone}
            onClick={guard(() => void undo(), { action: tReadOnly('restoreVersion') })}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <Undo2 className="size-3.5" aria-hidden />
            {undone ? t('undoneShort', { n: version.n - 1 }) : t('undo', { n: version.n - 1 })}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('saved')}</p>
    </div>
  );
}
