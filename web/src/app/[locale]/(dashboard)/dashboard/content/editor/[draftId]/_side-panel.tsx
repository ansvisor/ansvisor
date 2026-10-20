'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ContentDraft } from '@/lib/content/drafts';
import { ImpactTab } from './_impact-tab';
import { SourcesTab } from './_sources-tab';

/** Remembers whether the panel is open, across drafts and visits. */
const PANEL_OPEN_KEY = 'aeo:content-editor-panel';
/** Wide enough for the page and the panel side by side: the panel starts open from here. */
const PANEL_OPEN_FROM = 1280;

/**
 * Whether the side panel is open: as the person last left it, else open on a
 * wide window. The editor renders on the client only (after its draft is
 * read), so the first state can read the window.
 */
export function useSidePanelOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(PANEL_OPEN_KEY);
      if (stored !== null) return stored === '1';
    } catch {
      // Storage unavailable (private mode): fall back to the window's width.
    }
    return window.innerWidth >= PANEL_OPEN_FROM;
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(PANEL_OPEN_KEY, next ? '1' : '0');
    } catch {
      // The choice just won't persist.
    }
  };
  return [open, toggle];
}

const PANEL_TABS = ['impact', 'sources'] as const;
type PanelTab = (typeof PANEL_TABS)[number];

/**
 * The editor's right panel (Content Editor spec v2 §6), 400px beside the page.
 * The spec's tabs are Impact · Chat · Brief · Sources · Rules; each joins the
 * panel with the update that makes it work: Impact (CE-016), then Sources
 * (CE-008). A tab opened once stays mounted, so switching back keeps it as
 * it was.
 */
export function EditorSidePanel({
  draft,
  title,
  bodyHtml,
}: {
  draft: ContentDraft;
  /** The draft's title and page as written now: Sources says where each source is used. */
  title: string;
  bodyHtml: string;
}) {
  const t = useTranslations('contentEditor.editor.panel');
  const [tab, setTab] = useState<PanelTab>('impact');
  const [opened, setOpened] = useState<Set<PanelTab>>(() => new Set(['impact']));
  return (
    <aside aria-label={t('label')} className="flex w-[400px] shrink-0 flex-col border-l bg-card">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = value as PanelTab;
          setTab(next);
          setOpened((prev) => (prev.has(next) ? prev : new Set([...prev, next])));
        }}
        className="border-b px-3 pt-1.5"
      >
        <TabsList variant="line">
          {PANEL_TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div hidden={tab !== 'impact'}>
          <ImpactTab brandId={draft.brandId} pageUrl={draft.sourceUrl} />
        </div>
        {opened.has('sources') && (
          <div hidden={tab !== 'sources'}>
            <SourcesTab
              draftId={draft.id}
              brandId={draft.brandId}
              title={title}
              sourceUrl={draft.sourceUrl}
              bodyHtml={bodyHtml}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
