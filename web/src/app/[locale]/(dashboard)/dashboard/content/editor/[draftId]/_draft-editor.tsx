'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EditorContent, useEditor } from '@tiptap/react';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { ArrowLeft, Bot, Check, Copy, Loader2, PanelRight, Target, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import { DraftMethodBadge, DraftStatusBadge } from '@/components/content/draft-badges';
import {
  decideDraftSuggestions,
  fixDraftRules,
  getCitedPassages,
  getDraftSuggestions,
  keepAgentBeforeVersion,
  markContentDraftReady,
  restoreDraftVersion,
  setContentDraftPageType,
  startAgentWriting,
} from '@/lib/actions/content-drafts';
import { agentWriteRequest, useRuleDescriber } from '@/lib/content/agent-write';
import {
  AGENT_POLL_MS,
  CONTENT_LIBRARY_PATH,
  isPageType,
  type ContentDraft,
  type PageType,
} from '@/lib/content/drafts';
import { CITED_DAYS, MAX_PASSAGES, type CitedPassage } from '@/lib/content/cited-passages';
import {
  draftExportBlob,
  draftExportFileName,
  type DraftExportFormat,
} from '@/lib/content/draft-export';
import type { DraftVersion } from '@/lib/content/history';
import type { DraftSuggestion, SuggestionStatus } from '@/lib/content/suggestions';
import {
  cleanHtml,
  formatHtmlSource,
  htmlFromSource,
  publishableHtml,
} from '@/lib/content/clean-html';
import { PAGE_READ_DELAY_MS, draftTitleFromDoc, safeLinkHref } from '@/lib/content/editor';
import { JsonLd } from '@/lib/content/json-ld-node';
import { detectPageType } from '@/lib/content/page-types';
import { aiTracesFound } from '@/lib/content/rules';
import { saveBlob } from '@/lib/download';
import { cn } from '@/lib/utils';
import { AgentBar } from './_agent-bar';
import { DropOverlay, useAttachments } from './_attach';
import {
  CITED_EDIT_ALLOWED,
  CitedPassages,
  citedLocks,
  citedPassagesKey,
  lockedPassageCount,
  type HeldEdit,
} from './_cited-passages';
import { ExportMenu } from './_export-menu';
import { HistoryMenu } from './_history-menu';
import { HtmlBlock, copyToClipboard } from './_html-block';
import { OwnCopies, ownCopyHtml } from './_own-copies';
import { PageTypeMenu } from './_page-type-menu';
import type { AgentRewrite } from './_brief-tab';
import { ruleStatusText, type AgentFix } from './_rules-tab';
import { EditorPanelRail, EditorSidePanel, useSidePanelOpen, type PanelTab } from './_side-panel';
import {
  AgentSuggestions,
  acceptInto,
  suggestionsKey,
  redoDecision,
  undoInto,
  type SuggestionDecision,
  type SuggestionLabels,
} from './_suggestions';
import { useDraftReads } from './_use-draft-reads';
import { useDraftRules } from './_use-draft-rules';
import { EditorToolbar } from './_toolbar';
import { useDraftAutosave, type SaveState } from './_use-autosave';

/**
 * The page as it reads: the app's prose type, links blue and underlined so
 * they read as links, tables with cell borders, a placeholder while empty,
 * and the selected table cells and images marked.
 */
const DOCUMENT_CLASS = cn(
  'prose prose-neutral max-w-none dark:prose-invert min-h-[50vh] focus:outline-none',
  'prose-a:font-normal prose-a:text-blue-600 prose-a:underline prose-a:underline-offset-2 dark:prose-a:text-blue-400',
  'prose-h1:text-3xl prose-h1:tracking-tight prose-h2:tracking-tight',
  '[&_table]:my-4 [&_table]:w-full [&_table]:table-fixed [&_td]:border [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left',
  // Cells and list items hold paragraphs; their margins would pad every row.
  '[&_td>p]:my-0 [&_th>p]:my-0 [&_li>p]:my-0 prose-li:my-1',
  '[&_.selectedCell]:bg-primary/10 [&_img]:rounded-md [&_.ProseMirror-selectednode]:ring-2 [&_.ProseMirror-selectednode]:ring-ring/50',
  // Locked passages (CE-018): a green line, and what quotes them above.
  '[&_.cited-passage]:rounded-r-md [&_.cited-passage]:border-l-[3px] [&_.cited-passage]:border-emerald-300 [&_.cited-passage]:bg-emerald-50/70 [&_.cited-passage]:py-1 [&_.cited-passage]:pr-2 [&_.cited-passage]:pl-3 dark:[&_.cited-passage]:border-emerald-700 dark:[&_.cited-passage]:bg-emerald-950/30',
  '[&_.cited-passage]:before:mb-0.5 [&_.cited-passage]:before:block [&_.cited-passage]:before:text-[11.5px] [&_.cited-passage]:before:leading-snug [&_.cited-passage]:before:font-medium [&_.cited-passage]:before:tracking-normal [&_.cited-passage]:before:text-emerald-700 [&_.cited-passage]:before:content-[attr(data-cited-label)] dark:[&_.cited-passage]:before:text-emerald-400',
  // An accepted agent suggestion (CE-018): a thin green line, the words it put in underlined.
  '[&_.agent-accepted]:border-l-2 [&_.agent-accepted]:border-emerald-300 [&_.agent-accepted]:pl-2.5 dark:[&_.agent-accepted]:border-emerald-700',
  '[&_.agent-accepted-text]:underline [&_.agent-accepted-text]:decoration-emerald-300 [&_.agent-accepted-text]:decoration-2 [&_.agent-accepted-text]:underline-offset-4 dark:[&_.agent-accepted-text]:decoration-emerald-700',
  '[&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-muted-foreground [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
);

/**
 * How long Fix open rules waits for the agent's batch when its answer didn't
 * come back: past the API's model call (content-agent.js, 60 s) and the
 * batch's save.
 */
const FIX_WAIT_MS = 90_000;

/**
 * The draft's suggestions once a new open batch lands, read every few
 * seconds until the deadline; null if none did. Fix open rules only runs
 * with none open, so any open one is the agent's.
 */
async function agentBatch(draftId: string, until: number): Promise<DraftSuggestion[] | null> {
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, AGENT_POLL_MS));
    const read = await getDraftSuggestions(draftId).catch(() => null);
    if (read?.some((s) => s.status === 'open')) return read;
  }
  return null;
}

/**
 * The content editor (Content Editor, CE-004, spec §6): a header with the
 * draft's title, page type and method, whether it's saved, and Mark ready;
 * the toolbar; and the page itself, rich text that saves as you write. The
 * draft's title is its first heading, as the Library lists it.
 *
 * A paste is cleaned on the way in (CE-005): headings, lists, links and
 * tables stay; fonts, colors, styles and tracking parameters go; ⌘/Ctrl +
 * Shift + V pastes plain text. The HTML view (CE-020) shows the page's
 * source, and cleans it the same way when it switches back. HTML blocks
 * carry code as written, as many as the page needs, and Copy HTML puts the
 * whole page, or one block, on the clipboard. The page type follows the page
 * as it is written until the person picks one (CE-023). The side panel, open
 * beside the page or closed from the header, shows what the page earns
 * (Impact, CE-016), its brief and the sources it draws on (CE-007, CE-008)
 * and the rules it is written to (CE-009); the header's chip says how many
 * of those rules the page meets now. History keeps earlier versions (the
 * imported live page, each Mark ready) and restores any of them; passages
 * AI answers quote today are locked: marked, and changed only after a
 * warning; an agent's suggestions sit in the page as cards to accept or
 * reject, with the agent bar over it, and Fix open rules with agent asks the
 * Content Agent for a new batch (CE-018).
 */
export function DraftEditor({
  draft,
  onAgentStarted,
}: {
  draft: ContentDraft;
  /** The Content Agent took the draft again (Try again): the page waits for it. */
  onAgentStarted?: () => void;
}) {
  const t = useTranslations('contentEditor.editor');
  const autosave = useDraftAutosave(draft.id, draft);
  const [title, setTitle] = useState(draft.title);
  // The page as written now, for the side panel's Sources.
  const [pageHtml, setPageHtml] = useState(draft.bodyHtml);
  const pageReadTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pageReadTimer.current), []);
  const [status, setStatus] = useState(draft.status);
  const [marking, setMarking] = useState(false);
  // The Content Agent couldn't finish the page Start gave it (CE-015).
  const [agentFailed, setAgentFailed] = useState(draft.agentState === 'failed');
  const [starting, setStarting] = useState(false);
  const describeRule = useRuleDescriber();
  const [restoring, setRestoring] = useState(false);
  const format = useFormatter();
  // A change to a locked passage, waiting for the person (CE-018).
  const [held, setHeld] = useState<HeldEdit | null>(null);
  // What quotes each locked passage, for the warning: "ChatGPT 14× and …".
  const citedBy = useRef(new Map<string, string>());
  const [citedCount, setCitedCount] = useState(0);
  // Whether the locked passages have been read: until then the agent would
  // be told none are locked (a new page has none to read).
  const [citedRead, setCitedRead] = useState(!draft.sourceUrl);
  // An agent's suggestions (CE-018): its latest batch, with what was decided.
  const [suggestions, setSuggestions] = useState<DraftSuggestion[]>([]);
  const suggestionsNow = useRef(suggestions);
  const [deciding, setDeciding] = useState(false);
  const [barClosed, setBarClosed] = useState(false);
  const [fixing, setFixing] = useState(false);
  const tRules = useTranslations('contentEditor.editor.rules');
  const tStatus = useTranslations('contentEditor.editor.rules.status');
  // History keeps the page before the first suggestion accepted here.
  const agentBeforeKept = useRef(false);
  const onDecide = useRef<(id: string, decision: SuggestionDecision) => void>(() => {});
  // A picked page type, or the one the page shows as it is written. As on
  // a save, a page that shows no type keeps the one it had (the stored one
  // to start with), so the header and the Library agree.
  const [picked, setPicked] = useState(draft.pageTypeSource === 'user' ? draft.pageType : null);
  const [detectedType, setDetectedType] = useState(
    () =>
      detectPageType({ title: draft.title, html: draft.bodyHtml }, draft.siteType) ??
      (isPageType(draft.pageType) ? draft.pageType : null),
  );
  const detectType = (title: string, html: string) =>
    setDetectedType((had) => detectPageType({ title, html }, draft.siteType) ?? had);
  const pageType = picked ?? detectedType;
  // The HTML view's text while it is open; null in the visual editor.
  const [htmlSource, setHtmlSource] = useState<string | null>(null);
  const [htmlEdited, setHtmlEdited] = useState(false);
  // Files dropped on the page go in where they land (CE-006).
  const attachRef = useRef<(files: File[]) => void>(undefined);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [panelOpen, togglePanel] = useSidePanelOpen();
  // The header's rules chip opens the panel on Rules, and the closed panel's
  // strip on the tab picked there.
  const [tabRequest, setTabRequest] = useState<{ tab: PanelTab; n: number } | null>(null);
  const openPanelTab = (tab: PanelTab) => {
    if (!panelOpen) togglePanel();
    setTabRequest((prev) => ({ tab, n: (prev?.n ?? 0) + 1 }));
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Pages, not code: the toolbar has no code or rules.
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          defaultProtocol: 'https',
          isAllowedUri: (url) => safeLinkHref(url) !== null,
        },
      }),
      TableKit.configure({ table: { resizable: false } }),
      Image,
      CharacterCount,
      Placeholder.configure({ placeholder: t('placeholder') }),
      JsonLd.configure({
        label: (type) => (type ? t('jsonLd', { type }) : t('jsonLdUntyped')),
      }),
      HtmlBlock,
      OwnCopies,
      CitedPassages.configure({
        // The first change held is the one asked about: some keyboards
        // still send the text of a key whose keydown was held, and the
        // person can't type while the question is open.
        onHeld: (edit) => setHeld((current) => current ?? edit),
      }),
      AgentSuggestions.configure({ onDecide: (id, decision) => onDecide.current(id, decision) }),
    ],
    content: draft.bodyHtml,
    // Rendered on the client only, so the server's HTML can't disagree with it.
    immediatelyRender: false,
    editorProps: {
      attributes: { class: DOCUMENT_CLASS, 'aria-label': t('documentLabel') },
      transformPastedHTML: (html) => {
        // A copy from this editor keeps its images and HTML blocks, and needs
        // no word about it. Only this tab's copies carry its mark.
        const own = ownCopyHtml(html);
        if (own !== null) {
          return cleanHtml(own, { keepImages: true, keepHtmlBlocks: true }).html;
        }
        // Images from elsewhere wait for attachments (CE-006): Docs' and
        // Word's are temporary addresses or embedded data.
        const cleaned = cleanHtml(html, { keepImages: false });
        toast(cleaned.imagesRemoved ? t('paste.cleanedNoImages') : t('paste.cleaned'));
        return cleaned.html;
      },
      transformPastedText: (text, plain) => {
        if (plain) toast(t('paste.plain'));
        return text;
      },
      // A click on a link puts the cursor in it, to edit it; ⌘/Ctrl + click
      // opens it, as in other editors. A path on the brand's own site has no
      // address here to open.
      handleClick: (_view, _pos, event) => {
        if (!event.metaKey && !event.ctrlKey) return false;
        const href = (event.target as HTMLElement).closest('a')?.getAttribute('href');
        if (!href || !/^https?:/.test(safeLinkHref(href) ?? '')) return false;
        window.open(href, '_blank', 'noopener,noreferrer');
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (moved || !files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (at) {
          view.dispatch(
            view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))),
          );
        }
        attachRef.current?.(files);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      const next = draftTitleFromDoc(e.getJSON());
      const bodyHtml = e.getHTML();
      setTitle(next);
      autosave.schedule({ title: next, bodyHtml });
      // The panel and the type chip catch up once typing pauses.
      clearTimeout(pageReadTimer.current);
      pageReadTimer.current = setTimeout(() => {
        setPageHtml(bodyHtml);
        detectType(next, bodyHtml);
      }, PAGE_READ_DELAY_MS);
    },
  });

  const attachments = useAttachments(editor);
  // The rules the page is written to, checked as it reads now (CE-009).
  // The brief and sources, read once: the rules check against them, the panel shows them.
  const reads = useDraftReads(draft.id);
  const rules = useDraftRules({
    draft,
    html: pageHtml,
    characters: (editor?.storage.characterCount.characters() as number | undefined) ?? 0,
    pageType,
    reads,
  });
  useEffect(() => {
    attachRef.current = (files) => void attachments.attach(files);
    onDecide.current = (id, decision) => void decide([id], decision);
  });

  /** "ChatGPT 14× and Perplexity 6×": the platforms quoting a passage, the most first. */
  const quotedBy = useCallback(
    (passage: CitedPassage) => {
      const byName = new Map<string, number>();
      for (const { platform, answers } of passage.platforms) {
        const name = PLATFORM_LABELS[platform] ?? platform;
        byName.set(name, (byName.get(name) ?? 0) + answers);
      }
      return format.list(
        [...byName]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => t('cited.platform', { name, count })),
        { type: 'conjunction' },
      );
    },
    [format, t],
  );

  // The page's passages AI answers quote, for a draft of an existing page:
  // read when it opens, and again after a restore.
  const loadCited = useCallback(async () => {
    if (!editor || !draft.sourceUrl) return;
    setCitedRead(false);
    const texts = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (!node.isTextblock) return true;
      if (node.textContent.trim()) texts.add(node.textContent.slice(0, 5_000));
      return false;
    });
    try {
      const cited = await getCitedPassages(draft.id, [...texts].slice(0, MAX_PASSAGES));
      if (!cited || editor.isDestroyed) return;
      const labels = new Map<string, string>();
      citedBy.current = new Map();
      for (const passage of cited) {
        const platforms = quotedBy(passage);
        citedBy.current.set(passage.key, platforms);
        labels.set(passage.key, t('cited.label', { platforms, days: CITED_DAYS }));
      }
      editor.view.dispatch(
        editor.state.tr.setMeta(citedPassagesKey, { labels, unlocked: new Set() }),
      );
    } catch (err) {
      console.error('Failed to read the cited passages:', err);
    } finally {
      // Read or not, the editor's locks are what the agent is told.
      if (!editor.isDestroyed) setCitedRead(true);
    }
  }, [editor, draft.id, draft.sourceUrl, quotedBy, t]);

  useEffect(() => {
    void loadCited();
    // Once per editor: a restore reads them again itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // The header's count follows the page.
  useEffect(() => {
    if (!editor) return;
    const count = () => setCitedCount(lockedPassageCount(editor.state));
    editor.on('transaction', count);
    return () => {
      editor.off('transaction', count);
    };
  }, [editor]);

  /** "Edit anyway": the passage is the person's to change now. */
  const editAnyway = () => {
    if (!editor || !held) return;
    const locks = citedLocks(editor.state);
    editor.view.dispatch(
      editor.state.tr.setMeta(citedPassagesKey, {
        ...locks,
        unlocked: new Set(locks.unlocked).add(held.key),
      }),
    );
    // The held change goes through: a paste, a cut, or the key pressed.
    if (held.tr && held.tr.before.eq(editor.state.doc)) {
      editor.view.dispatch(held.tr.setMeta(CITED_EDIT_ALLOWED, true));
    }
    setHeld(null);
    editor.commands.focus();
  };

  const suggestionLabels = useMemo<SuggestionLabels>(
    () => ({
      agent: t('suggestions.agent'),
      accept: t('suggestions.accept'),
      reject: t('suggestions.reject'),
      accepted: t('suggestions.accepted'),
      rejected: t('suggestions.rejected'),
      undo: t('suggestions.undo'),
      restore: t('suggestions.restore'),
      locked: t('suggestions.locked'),
      stale: t('suggestions.stale'),
    }),
    [t],
  );

  // The latest batch, read when the editor opens.
  useEffect(() => {
    if (!editor) return;
    getDraftSuggestions(draft.id)
      .then(setSuggestions)
      .catch((err) => console.error('Failed to read the agent suggestions:', err));
  }, [editor, draft.id]);

  // The page shows them as they are now.
  useEffect(() => {
    suggestionsNow.current = suggestions;
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(suggestionsKey, { suggestions, labels: suggestionLabels }),
    );
  }, [editor, suggestions, suggestionLabels]);

  /**
   * Accept, reject, undo (an accepted one) or restore (a rejected one): the
   * page changes first, then the decision is kept. Accepting keeps the page
   * as it was in History before the first agent change.
   */
  const decide = async (ids: string[], decision: SuggestionDecision | 'undo_all') => {
    if (!editor || deciding) return;
    const all = suggestionsNow.current;
    const next = all.map((s) => ({ ...s }));
    const picked = next.filter((s) => ids.includes(s.id));
    const changed: string[] = [];
    let status: SuggestionStatus = 'open';
    // The page's change, applied only once the decision is saved.
    let tr: Transaction | null = null;
    setDeciding(true);
    try {
      if (decision === 'accept') {
        const open = picked.filter((s) => s.status === 'open');
        if (open.length > 0 && !agentBeforeKept.current) {
          await autosave.settle();
          await keepAgentBeforeVersion(draft.id);
          agentBeforeKept.current = true;
        }
        tr = editor.state.tr;
        for (const s of open) {
          if (acceptInto(tr, editor.state, s, next)) {
            s.status = 'accepted';
            changed.push(s.id);
          }
        }
        status = 'accepted';
        if (open.length > changed.length) {
          toast(t('suggestions.notApplied', { count: open.length - changed.length }));
        }
      } else if (decision === 'reject') {
        for (const s of picked.filter((s) => s.status === 'open')) {
          s.status = 'rejected';
          changed.push(s.id);
        }
        status = 'rejected';
      } else {
        // Undo, Restore and Undo all send suggestions back to review.
        tr = editor.state.tr;
        for (const s of [...picked].reverse()) {
          if (s.status === 'accepted' && decision !== 'restore') {
            if (!undoInto(tr, editor.state, s, next)) continue;
          } else if (s.status !== 'rejected' || decision === 'undo') {
            continue;
          }
          s.status = 'open';
          changed.push(s.id);
        }
      }
      if (changed.length === 0) return;
      // The decision is saved first, with the page held still: when it fails,
      // neither the page nor the cards change, so they stay in step.
      const editable = editor.isEditable;
      editor.setEditable(false, false);
      try {
        await decideDraftSuggestions(changed, status);
      } finally {
        if (editable) editor.setEditable(true, false);
      }
      if (tr?.docChanged) {
        if (tr.before.eq(editor.state.doc)) {
          editor.view.dispatch(tr);
        } else {
          // The page changed while the decision was saved: the change is made
          // again on the page as it is now, at once, before the page can
          // change again. What it no longer fits goes back to how it was,
          // saved as well, so the cards and the page agree.
          const redo = redoDecision(
            editor.state,
            all,
            changed,
            decision === 'accept' ? 'accept' : 'undo',
          );
          if (redo.tr.docChanged) editor.view.dispatch(redo.tr);
          if (redo.failed.length > 0) {
            const back: SuggestionStatus = decision === 'accept' ? 'open' : 'accepted';
            await decideDraftSuggestions(redo.failed, back);
            for (const s of next) if (redo.failed.includes(s.id)) s.status = back;
            toast(t('suggestions.notApplied', { count: redo.failed.length }));
          }
        }
      }
      setSuggestions(next);
      if (decision === 'accept')
        toast.success(t('suggestions.acceptedToast', { count: changed.length }));
      else if (decision === 'reject')
        toast(t('suggestions.rejectedToast', { count: changed.length }));
      else toast(t('suggestions.undoneToast', { count: changed.length }));
    } catch (err) {
      console.error('Failed to decide the suggestions:', err);
      toast.error(t('suggestions.saveFailed'));
    } finally {
      setDeciding(false);
    }
  };
  const openSuggestions = suggestions.filter((s) => s.status === 'open').length;

  /**
   * Fix open rules with agent: the page as it is now is saved, then the
   * Content Agent reads it with the rules still open (or only the ones
   * named), the person's own rules and the locked passages, and leaves a new
   * batch of suggestions for review.
   */
  const fixRules = async (only?: string[]) => {
    if (!editor || fixing || !citedRead) return;
    if (openSuggestions > 0) {
      toast(t('suggestions.decideFirst'));
      return;
    }
    const open = rules.rules.filter(
      ({ rule, status }) => rule.on && status.state === 'bad' && (!only || only.includes(rule.key)),
    );
    if (open.length === 0) return;
    const pageText = editor.getText({ blockSeparator: '\n' });
    const request = {
      rules: open.map(({ rule, status }) => ({
        key: rule.key,
        name: tRules(`names.${rule.key}`),
        detail: [
          rule.current
            ? `${tRules('agent.aim')}: ${rule.current}${rule.unit ? ` ${tRules(`units.${rule.unit}`)}` : ''}`
            : null,
          `${tRules('agent.now')}: ${ruleStatusText(tStatus, status)}`,
          rule.key === 'aiTraces'
            ? `${tRules('agent.phrases')}: ${aiTracesFound(pageText).join(', ')}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
      textRules: rules.textRules.filter(({ rule }) => rule.on).map(({ rule }) => rule.text),
      locked: (() => {
        const locks = citedLocks(editor.state);
        return [...locks.labels.keys()].filter((key) => !locks.unlocked.has(key));
      })(),
    };
    setFixing(true);
    const asked = Date.now();
    try {
      // The agent reads the page as saved.
      await autosave.settle();
      const result = await fixDraftRules(draft.id, draft.brandId, request).catch((err) => {
        // The call itself gave up (a timeout on the way): the agent may still finish.
        console.error('Failed to hear back from the Content Agent:', err);
        return { error: 'unconfirmed' as const };
      });
      if ('error' in result && result.error === 'unconfirmed') {
        // No answer is not a failure: its batch shows if it lands in time.
        const landed = await agentBatch(draft.id, asked + FIX_WAIT_MS);
        if (!landed) {
          toast.error(t('suggestions.fixErrors.failed'));
          return;
        }
        setSuggestions(landed);
        setBarClosed(false);
        agentBeforeKept.current = false;
        toast.success(
          t('suggestions.fixed', { count: landed.filter((s) => s.status === 'open').length }),
        );
        return;
      }
      if ('error' in result) {
        toast.error(t(`suggestions.fixErrors.${result.error}`));
        // Another tab (or the API) left them: show them here to decide.
        if (result.error === 'open_suggestions') {
          setSuggestions(await getDraftSuggestions(draft.id));
          setBarClosed(false);
        }
        return;
      }
      if (result.count === 0) {
        toast(t('suggestions.nothingToFix'));
        return;
      }
      setSuggestions(await getDraftSuggestions(draft.id));
      setBarClosed(false);
      // A new batch: History keeps the page again before its first change.
      agentBeforeKept.current = false;
      toast.success(t('suggestions.fixed', { count: result.count }));
    } catch (err) {
      console.error('Failed to run the Content Agent:', err);
      toast.error(t('suggestions.fixErrors.failed'));
    } finally {
      setFixing(false);
    }
  };
  const agentFix: AgentFix = {
    run: (only) => void fixRules(only),
    running: fixing,
    blocked:
      openSuggestions > 0
        ? t('suggestions.decideFirst')
        : !citedRead
          ? t('suggestions.citedLoading')
          : null,
  };

  // A drag with files over the page shows where they go; one dropped beside
  // the page (not on its text) goes in at the cursor.
  const withFiles = (e: React.DragEvent) =>
    htmlSource === null && [...e.dataTransfer.types].includes('Files');
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!withFiles(e)) return;
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!withFiles(e)) return;
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) setDragging(false);
    },
    onDragOver: (e: React.DragEvent) => {
      if (withFiles(e)) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      if (e.defaultPrevented || !withFiles(e)) return;
      e.preventDefault();
      void attachments.attach([...e.dataTransfer.files]);
    },
  };

  const openHtmlView = () => {
    if (!editor) return;
    // The cards aren't in the HTML: decide them first.
    if (openSuggestions > 0) {
      toast(t('suggestions.htmlBlocked', { count: openSuggestions }));
      return;
    }
    setHtmlSource(formatHtmlSource(editor.getHTML()));
    setHtmlEdited(false);
  };
  const applyHtmlView = () => {
    if (!editor || htmlSource === null) return;
    // Nothing edited: back to the page as it was, with nothing to save.
    if (!htmlEdited) {
      setHtmlSource(null);
      return;
    }
    const cleaned = cleanHtml(htmlFromSource(htmlSource), {
      keepImages: true,
      keepHtmlBlocks: true,
    });
    // Emits an update, so the title and the autosave follow. HTML edited by
    // hand may change locked passages: it was the person's to write.
    editor.chain().setMeta(CITED_EDIT_ALLOWED, true).setContent(cleaned.html).run();
    setHtmlSource(null);
    toast(
      cleaned.unsafeRemoved
        ? t('html.appliedUnsafe', { count: cleaned.unsafeRemoved })
        : t('html.applied'),
    );
  };

  // HTML edited but not applied isn't saved yet: leaving asks first.
  useEffect(() => {
    if (!htmlEdited || htmlSource === null) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [htmlEdited, htmlSource]);

  // The page as HTML to publish; in the HTML view, the source on screen.
  const copyPageHtml = () => {
    if (!editor) return;
    const html = htmlSource !== null ? htmlFromSource(htmlSource) : editor.getHTML();
    void copyToClipboard(
      publishableHtml(html),
      t('copyHtmlDone'),
      t('copyHtmlFailed', { html: '</> HTML' }),
    );
  };

  /** Export: the page as Copy HTML gives it, as a Word, HTML or Markdown file. */
  const exportPage = async (format: DraftExportFormat) => {
    if (!editor) return;
    const html = publishableHtml(
      htmlSource !== null ? htmlFromSource(htmlSource) : editor.getHTML(),
    );
    const name = title.trim() || t('untitled');
    try {
      saveBlob(await draftExportBlob(format, name, html), draftExportFileName(name, format));
    } catch (err) {
      console.error('Failed to export the page:', err);
      toast.error(t('export.failed'));
    }
  };

  /**
   * The agent on this draft again (Try again, Rewrite from brief): it takes
   * the page as saved now, with the brief, the sources and the rules in effect
   * here, and the page waits for it.
   */
  const startAgent = async () => {
    if (!editor) return;
    setStarting(true);
    try {
      await autosave.settle();
      const request = await agentWriteRequest(
        {
          id: draft.id,
          brandId: draft.brandId,
          title,
          pageType,
          method: draft.method,
          sourceUrl: draft.sourceUrl,
          bodyHtml: editor.getHTML(),
          rules: draft.rules,
        },
        describeRule,
        {
          rules: rules.rules.filter(({ rule }) => rule.on).map(({ rule }) => rule),
          textRules: rules.textRules.filter(({ rule }) => rule.on).map(({ rule }) => rule.text),
        },
      );
      const result = await startAgentWriting(draft.id, draft.brandId, request);
      if ('error' in result) {
        toast.error(t(`agentFailed.errors.${result.error}`));
        return;
      }
      onAgentStarted?.();
    } catch (err) {
      console.error('Failed to start the Content Agent again:', err);
      toast.error(t('agentFailed.errors.failed'));
    } finally {
      setStarting(false);
    }
  };

  const canMarkReady = status === 'draft' || status === 'in_review';
  // Rewrite from brief, while the page is still open to the agent (not ready
  // or published), as the API allows.
  const agentRewrite: AgentRewrite | undefined = canMarkReady
    ? {
        run: () => void startAgent(),
        running: starting,
        blocked: openSuggestions > 0 ? t('suggestions.decideFirst') : null,
      }
    : undefined;
  const markReady = async () => {
    setMarking(true);
    try {
      // What's waiting goes out first, so the ready draft (and the version
      // History keeps of it) is the one on screen; a page that can't be saved
      // isn't marked ready.
      try {
        await autosave.settle();
      } catch {
        toast.error(t('markReadyUnsaved'));
        return;
      }
      const next = await markContentDraftReady(draft.id);
      setStatus(next.status);
      toast.success(
        next.tasksDone > 0 && draft.action
          ? t('markedReadyAction', { no: draft.action.number, count: next.tasksDone })
          : t('markedReady'),
      );
    } catch (err) {
      console.error('Failed to mark the draft ready:', err);
      toast.error(t('markReadyFailed'));
    } finally {
      setMarking(false);
    }
  };

  // A version from History replaces the page: what's waiting is saved first,
  // as the server keeps the page it replaces, and the page can't change
  // while the restore runs.
  const restoreVersion = async (version: DraftVersion, label: string) => {
    if (!editor || restoring) return;
    setRestoring(true);
    editor.setEditable(false, false);
    try {
      await autosave.settle();
      const restored = await restoreDraftVersion(draft.id, version.id);
      editor
        .chain()
        .setMeta(CITED_EDIT_ALLOWED, true)
        .setContent(restored.bodyHtml, { emitUpdate: false })
        .run();
      // The server has this page now: nothing from before it is still to
      // save, and saves go on from the restored version.
      autosave.discard(restored);
      const html = editor.getHTML();
      setTitle(restored.title);
      setPageHtml(html);
      detectType(restored.title, html);
      toast.success(t('history.restored', { version: label }));
      void loadCited();
    } catch (err) {
      console.error('Failed to restore the version:', err);
      toast.error(t('history.restoreFailed'));
    } finally {
      editor.setEditable(true, false);
      setRestoring(false);
    }
  };

  const pickPageType = async (type: PageType) => {
    if (type === picked) return;
    const before = picked;
    setPicked(type);
    try {
      await setContentDraftPageType(draft.id, type);
    } catch (err) {
      console.error('Failed to set the page type:', err);
      setPicked(before);
      toast.error(t('pageType.failed'));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Two lines: the title and what you do with the page on top, which
          stays light (the title shortens, the save state and Mark ready never
          move), and the page's tags under the title, all of them at any width. */}
      <header className="border-b px-4 pt-2.5 pb-2">
        <div className="flex items-center gap-2.5">
          <Link
            href={CONTENT_LIBRARY_PATH}
            aria-label={t('back')}
            title={t('back')}
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="min-w-0 truncate text-sm font-medium" title={title.trim() || undefined}>
            {title.trim() || t('untitled')}
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
            <SaveIndicator state={autosave.state} onRetry={() => void autosave.retry()} />
            <HistoryMenu
              draftId={draft.id}
              disabled={
                htmlSource !== null
                  ? t('history.htmlOpen')
                  : restoring
                    ? t('history.restoring')
                    : null
              }
              onRestore={(version, label) => void restoreVersion(version, label)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={copyPageHtml}
              title={t('copyHtmlHint')}
              aria-label={t('copyHtml')}
            >
              <Copy className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">{t('copyHtml')}</span>
            </Button>
            <ExportMenu disabled={!editor} onExport={(format) => void exportPage(format)} />
            <Button
              size="sm"
              // A page that can't be saved can't be marked ready; the save state says why.
              disabled={
                !canMarkReady ||
                marking ||
                autosave.state === 'conflict' ||
                autosave.state === 'too_large'
              }
              onClick={markReady}
            >
              {marking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                !canMarkReady && <Check className="h-3.5 w-3.5" />
              )}
              {t('markReady')}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-pressed={panelOpen}
              aria-label={panelOpen ? t('panel.hide') : t('panel.show')}
              title={panelOpen ? t('panel.hide') : t('panel.show')}
              onClick={togglePanel}
              className={cn(panelOpen && 'bg-muted')}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Lined up under the title (the back button's 28px and the 10px gap). */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[38px]">
          <PageTypeMenu
            brandId={draft.brandId}
            siteType={draft.siteType}
            pageType={pageType}
            detected={picked === null}
            isNew={draft.method === 'create'}
            sourceUrl={draft.sourceUrl}
            onPick={(type) => void pickPageType(type)}
          />
          <DraftMethodBadge method={draft.method} />
          <DraftStatusBadge status={status} />
          <button
            type="button"
            onClick={() => openPanelTab('rules')}
            title={t('rulesChipHint')}
            aria-label={t('rulesChip', { met: rules.met, total: rules.total })}
            className={cn(
              'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium',
              rules.total > 0 && rules.met === rules.total
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
            )}
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
            {t('rulesChip', { met: rules.met, total: rules.total })}
          </button>
          {citedCount > 0 && (
            <span
              title={t('cited.chipHint')}
              className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
              {t('cited.chip', { count: citedCount })}
            </span>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {agentFailed && canMarkReady && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[13px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            >
              <Bot aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{t('agentFailed.text')}</span>
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={starting || !editor}
                  onClick={() => void startAgent()}
                >
                  {starting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t('agentFailed.retry')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('agentFailed.dismiss')}
                  title={t('agentFailed.dismiss')}
                  onClick={() => setAgentFailed(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </span>
            </div>
          )}
          {/* The action this draft is the work of (CE-022): under the header,
              which has no room left at 1024px, and Mark ready completes its task. */}
          {draft.action && (
            <p className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-[13px] text-muted-foreground">
              <Target aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">
                {t.rich(canMarkReady ? 'actionBar' : 'actionBarDone', {
                  no: draft.action.number,
                  link: (chunks) => (
                    <Link
                      href={`/dashboard/action-center/actions?action=${draft.action!.id}`}
                      className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </span>
            </p>
          )}
          {suggestions.length > 0 && !(barClosed && openSuggestions === 0) && (
            <AgentBar
              suggestions={suggestions}
              rulesOpen={Math.max(0, rules.total - rules.met)}
              busy={deciding}
              onAcceptAll={() =>
                void decide(
                  suggestions.filter((s) => s.status === 'open').map((s) => s.id),
                  'accept',
                )
              }
              onRejectAll={() =>
                void decide(
                  suggestions.filter((s) => s.status === 'open').map((s) => s.id),
                  'reject',
                )
              }
              onUndoAll={() =>
                void decide(
                  suggestions.filter((s) => s.status !== 'open').map((s) => s.id),
                  'undo_all',
                )
              }
              onClose={() => setBarClosed(true)}
              onFixRules={() => void fixRules()}
              fixing={fixing}
            />
          )}
          {editor && (
            <EditorToolbar
              editor={editor}
              target={rules.length}
              htmlView={htmlSource !== null}
              onToggleHtml={htmlSource === null ? openHtmlView : applyHtmlView}
              onAttach={attachments.open}
            />
          )}

          {htmlSource !== null && (
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{t('html.title')}</span> ·{' '}
                {t('html.hint', { marker: '<!-- html-block -->' })}
              </span>
              <Button size="sm" className="ml-auto h-7" onClick={applyHtmlView}>
                {t('html.back')}
              </Button>
            </div>
          )}

          <div className="relative min-h-0 flex-1" {...dropHandlers}>
            <div className="h-full overflow-y-auto">
              {htmlSource !== null && (
                <textarea
                  value={htmlSource}
                  onChange={(e) => {
                    setHtmlSource(e.target.value);
                    setHtmlEdited(true);
                  }}
                  spellCheck={false}
                  aria-label={t('html.label')}
                  className="block h-full min-h-[600px] w-full resize-none bg-muted/20 px-7 py-5 font-mono text-[12.5px] leading-relaxed outline-none"
                />
              )}
              <div
                className={cn(
                  'mx-auto max-w-[720px] px-7 pt-7 pb-20',
                  htmlSource !== null && 'hidden',
                )}
              >
                <EditorContent editor={editor} />
              </div>
            </div>
            {dragging && <DropOverlay />}
          </div>
          {attachments.ui}
        </div>
        {panelOpen ? (
          <EditorSidePanel
            draft={draft}
            title={title}
            bodyHtml={pageHtml}
            pageType={pageType}
            rules={rules}
            reads={reads}
            tabRequest={tabRequest}
            agentFix={agentFix}
            agentRewrite={agentRewrite}
          />
        ) : (
          <EditorPanelRail onOpen={openPanelTab} />
        )}
      </div>

      <Dialog open={held !== null} onOpenChange={(open) => !open && setHeld(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('cited.holdTitle')}</DialogTitle>
            <DialogDescription>
              {t('cited.holdDescription', {
                platforms: (held && citedBy.current.get(held.key)) ?? '',
                days: CITED_DAYS,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={editAnyway}>
              {t('cited.editAnyway')}
            </Button>
            <Button
              onClick={() => {
                setHeld(null);
                editor?.commands.focus();
              }}
            >
              {t('cited.keep')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const t = useTranslations('contentEditor.editor.save');
  if (state === 'conflict') {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-destructive"
        role="status"
        title={t('conflictHint')}
      >
        {t('conflict')}
        <button
          type="button"
          className="font-medium underline"
          onClick={() => window.location.reload()}
        >
          {t('reload')}
        </button>
      </span>
    );
  }
  if (state === 'too_large') {
    return (
      <span className="text-xs text-destructive" role="status" title={t('tooLargeHint')}>
        {t('tooLarge')}
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive" role="status">
        {t('failed')}
        <button type="button" className="font-medium underline" onClick={onRetry}>
          {t('retry')}
        </button>
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground" role="status">
      {t(state)}
    </span>
  );
}
