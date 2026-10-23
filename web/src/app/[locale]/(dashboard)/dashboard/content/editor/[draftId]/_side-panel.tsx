'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isPageType, type ContentDraft } from '@/lib/content/drafts';
import { BriefTab, type AgentRewrite } from './_brief-tab';
import { ImpactTab } from './_impact-tab';
import { RulesTab, type AgentFix } from './_rules-tab';
import { SourcesTab } from './_sources-tab';
import { useBriefRebuild, type PageNow } from './_use-brief-rebuild';
import type { DraftReads } from './_use-draft-reads';
import type { DraftRulesState } from './_use-draft-rules';

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

// Rules first: what to act on before anything else (the user's call over the
// spec's Impact-first order); the panel opens on it.
const PANEL_TABS = ['rules', 'brief', 'sources', 'impact'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

/**
 * The panel's tabs while it is closed, down the editor's right edge, so the
 * panel is never out of sight (it starts closed on a narrow window). A tab
 * opens the panel on it.
 */
export function EditorPanelRail({ onOpen }: { onOpen: (tab: PanelTab) => void }) {
  const t = useTranslations('contentEditor.editor.panel');
  return (
    <nav
      aria-label={t('label')}
      className="flex w-9 shrink-0 flex-col items-center gap-1 border-l bg-card py-2"
    >
      {PANEL_TABS.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onOpen(value)}
          title={t('openTab', { tab: t(`tabs.${value}`) })}
          className="rounded-md px-1.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors [writing-mode:vertical-rl] hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {t(`tabs.${value}`)}
        </button>
      ))}
    </nav>
  );
}

/**
 * The editor's right panel (Content Editor spec v2 §6), 400px beside the page.
 * The spec's tabs are Impact · Chat · Brief · Sources · Rules; each joins the
 * panel with the update that makes it work: Impact (CE-016), Brief (CE-007),
 * Sources (CE-008) and Rules (CE-009). Rules comes first and the panel opens
 * on it; each other tab mounts (and reads) when first opened, and stays
 * mounted, so switching back keeps it as it was. The brief and the sources are the editor's one read
 * (useDraftReads), which the rules check against too: Sources' "Rebuild with
 * selection" and Impact's "Use lost prompts" rebuild the brief, and open it.
 */
export function EditorSidePanel({
  draft,
  title,
  bodyHtml,
  pageType,
  rules,
  reads,
  tabRequest,
  agentFix,
  agentRewrite,
}: {
  draft: ContentDraft;
  /** The draft's title, page and type as written now: Sources and Brief read them. */
  title: string;
  bodyHtml: string;
  pageType: string | null;
  /** The rules, as the editor checks them (the header's chip shows the same). */
  rules: DraftRulesState;
  /** The draft's brief and sources, read once for the editor. */
  reads: DraftReads;
  /** A tab to open, from outside the panel (the header's rules chip). */
  tabRequest: { tab: PanelTab; n: number } | null;
  /** Fix open rules with agent, for the Rules tab (CE-018). */
  agentFix?: AgentFix;
  /** Rewrite from brief, for the Brief tab; absent once the page is ready or published. */
  agentRewrite?: AgentRewrite;
}) {
  const t = useTranslations('contentEditor.editor.panel');
  const [tab, setTab] = useState<PanelTab>('rules');
  const [opened, setOpened] = useState<Set<PanelTab>>(() => new Set(['rules']));
  const page = useRef<PageNow>({ title, html: bodyHtml, length: rules.length });
  const sourcesNow = useRef(reads.sources);
  useEffect(() => {
    page.current = { title, html: bodyHtml, length: rules.length };
    sourcesNow.current = reads.sources;
  });

  const open = (next: PanelTab) => {
    setTab(next);
    setOpened((prev) => (prev.has(next) ? prev : new Set([...prev, next])));
  };

  const requested = tabRequest?.n;
  useEffect(() => {
    if (tabRequest) open(tabRequest.tab);
    // Only a new request opens a tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  const briefOpened = opened.has('brief');

  const { rebuilding, rebuild } = useBriefRebuild({
    draft,
    pageNow: () => page.current,
    sourcesNow: () => sourcesNow.current,
    onSourcesRead: (read) => reads.setSources(read),
    onRebuilt: (next) => {
      reads.setBrief(next);
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
        {briefOpened && (
          <div hidden={tab !== 'brief'}>
            <BriefTab
              draftId={draft.id}
              state={reads.brief}
              pageType={pageType}
              length={rules.length}
              sourceUrl={draft.sourceUrl}
              method={draft.method}
              rebuilding={rebuilding}
              onRebuild={() => void rebuild()}
              onRetry={reads.reloadBrief}
              onSaved={(saved) => reads.setBrief(saved)}
              rewrite={agentRewrite}
            />
          </div>
        )}
        {opened.has('sources') && (
          <div hidden={tab !== 'sources'}>
            <SourcesTab
              read={reads.sources}
              setRead={reads.setSources}
              onReload={reads.reloadSources}
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
        {opened.has('rules') && (
          <div hidden={tab !== 'rules'}>
            <RulesTab
              agentFix={agentFix}
              // Only a draft with no prompts gets no fan-outs for want of them.
              onOpenSources={
                reads.sources && !reads.sources.failed && reads.sources.data.prompts.length === 0
                  ? () => open('sources')
                  : undefined
              }
              state={rules}
              siteType={draft.siteType}
              draftPageType={isPageType(pageType) ? pageType : null}
            />
          </div>
        )}
        {opened.has('impact') && (
          <div hidden={tab !== 'impact'}>
            <ImpactTab
              brandId={draft.brandId}
              pageUrl={draft.sourceUrl}
              rebuilding={rebuilding}
              onUseLostPrompts={(promptIds) => void rebuild({ addPrompts: promptIds })}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
