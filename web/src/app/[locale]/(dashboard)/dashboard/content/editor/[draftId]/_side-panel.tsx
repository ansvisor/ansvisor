'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ContentDraft } from '@/lib/content/drafts';
import { getDraftBrief } from '@/lib/actions/content-drafts';
import { BriefTab, type BriefState } from './_brief-tab';
import { ImpactTab } from './_impact-tab';
import { SourcesTab } from './_sources-tab';
import { useBriefRebuild, type PageNow } from './_use-brief-rebuild';

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

const PANEL_TABS = ['impact', 'brief', 'sources'] as const;
type PanelTab = (typeof PANEL_TABS)[number];

/**
 * The editor's right panel (Content Editor spec v2 §6), 400px beside the page.
 * The spec's tabs are Impact · Chat · Brief · Sources · Rules; each joins the
 * panel with the update that makes it work: Impact (CE-016), Brief (CE-007)
 * and Sources (CE-008). A tab opened once stays mounted, so switching back
 * keeps it as it was. The brief is held here: Sources' "Rebuild with
 * selection" and Impact's "Use lost prompts" rebuild it too, and open it.
 */
export function EditorSidePanel({
  draft,
  title,
  bodyHtml,
  pageType,
}: {
  draft: ContentDraft;
  /** The draft's title, page and type as written now: Sources and Brief read them. */
  title: string;
  bodyHtml: string;
  pageType: string | null;
}) {
  const t = useTranslations('contentEditor.editor.panel');
  const [tab, setTab] = useState<PanelTab>('impact');
  const [opened, setOpened] = useState<Set<PanelTab>>(() => new Set(['impact']));
  const [brief, setBrief] = useState<BriefState>({ status: 'loading' });
  const [briefAttempt, setBriefAttempt] = useState(0);
  // Read afresh after prompts join the draft.
  const [sourcesVersion, setSourcesVersion] = useState(0);
  const page = useRef<PageNow>({ title, html: bodyHtml, pageType });
  const briefNow = useRef(brief);
  useEffect(() => {
    page.current = { title, html: bodyHtml, pageType };
    briefNow.current = brief;
  });

  const open = (next: PanelTab) => {
    setTab(next);
    setOpened((prev) => (prev.has(next) ? prev : new Set([...prev, next])));
  };

  const briefOpened = opened.has('brief');
  useEffect(() => {
    // A brief already in hand (a rebuild from Sources or Impact) isn't read again.
    if (!briefOpened || briefNow.current.status !== 'loading') return;
    let cancelled = false;
    getDraftBrief(draft.id)
      .then((result) => {
        if (!cancelled)
          setBrief(result ? { status: 'ready', brief: result.brief } : { status: 'failed' });
      })
      .catch((err) => {
        console.error('Failed to read the brief:', err);
        if (!cancelled) setBrief({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [draft.id, briefOpened, briefAttempt]);

  const { rebuilding, rebuild } = useBriefRebuild({
    draft,
    pageNow: () => page.current,
    onRebuilt: (next) => {
      setBrief({ status: 'ready', brief: next });
      open('brief');
    },
  });

  return (
    <aside aria-label={t('label')} className="flex w-[400px] shrink-0 flex-col border-l bg-card">
      <Tabs
        value={tab}
        onValueChange={(value) => open(value as PanelTab)}
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
          <ImpactTab
            brandId={draft.brandId}
            pageUrl={draft.sourceUrl}
            rebuilding={rebuilding}
            onUseLostPrompts={(promptIds) =>
              void rebuild({ addPrompts: promptIds }).then(() => setSourcesVersion((n) => n + 1))
            }
          />
        </div>
        {briefOpened && (
          <div hidden={tab !== 'brief'}>
            <BriefTab
              draftId={draft.id}
              state={brief}
              pageType={pageType}
              sourceUrl={draft.sourceUrl}
              rebuilding={rebuilding}
              onRebuild={() => void rebuild()}
              onRetry={() => {
                setBrief({ status: 'loading' });
                setBriefAttempt((n) => n + 1);
              }}
              onSaved={(saved) => setBrief({ status: 'ready', brief: saved })}
            />
          </div>
        )}
        {opened.has('sources') && (
          <div hidden={tab !== 'sources'}>
            <SourcesTab
              key={sourcesVersion}
              draftId={draft.id}
              brandId={draft.brandId}
              title={title}
              sourceUrl={draft.sourceUrl}
              bodyHtml={bodyHtml}
              rebuilding={rebuilding}
              onRebuild={(sources) => void rebuild({ sources })}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
