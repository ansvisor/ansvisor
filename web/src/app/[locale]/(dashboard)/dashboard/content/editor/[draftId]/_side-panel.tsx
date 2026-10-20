'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ContentDraft } from '@/lib/content/drafts';
import { ImpactTab } from './_impact-tab';

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

/**
 * The editor's right panel (Content Editor spec v2 §6), 400px beside the page.
 * The spec's tabs are Impact · Chat · Brief · Sources · Rules; each joins the
 * panel with the update that makes it work, Impact first (CE-016).
 */
export function EditorSidePanel({ draft }: { draft: ContentDraft }) {
  const t = useTranslations('contentEditor.editor.panel');
  return (
    <aside aria-label={t('label')} className="flex w-[400px] shrink-0 flex-col border-l bg-card">
      <Tabs value="impact" className="border-b px-3 pt-1.5">
        <TabsList variant="line">
          <TabsTrigger value="impact">{t('tabs.impact')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ImpactTab brandId={draft.brandId} pageUrl={draft.sourceUrl} />
      </div>
    </aside>
  );
}
