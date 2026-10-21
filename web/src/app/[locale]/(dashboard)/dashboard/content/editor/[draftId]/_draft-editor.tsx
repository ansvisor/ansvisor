'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EditorContent, useEditor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { ArrowLeft, Check, Copy, Loader2, PanelRight } from 'lucide-react';
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
  getCitedPassages,
  markContentDraftReady,
  restoreDraftVersion,
  setContentDraftPageType,
} from '@/lib/actions/content-drafts';
import { CONTENT_LIBRARY_PATH, type ContentDraft, type PageType } from '@/lib/content/drafts';
import { CITED_DAYS, MAX_PASSAGES, type CitedPassage } from '@/lib/content/cited-passages';
import type { DraftVersion } from '@/lib/content/history';
import {
  cleanHtml,
  formatHtmlSource,
  htmlFromSource,
  publishableHtml,
} from '@/lib/content/clean-html';
import { PAGE_READ_DELAY_MS, draftTitleFromDoc, safeLinkHref } from '@/lib/content/editor';
import { JsonLd } from '@/lib/content/json-ld-node';
import { detectPageType } from '@/lib/content/page-types';
import { cn } from '@/lib/utils';
import { DropOverlay, useAttachments } from './_attach';
import {
  CITED_EDIT_ALLOWED,
  CitedPassages,
  citedLocks,
  citedPassagesKey,
  lockedPassageCount,
  type HeldEdit,
} from './_cited-passages';
import { HistoryMenu } from './_history-menu';
import { HtmlBlock, copyToClipboard } from './_html-block';
import { PageTypeMenu } from './_page-type-menu';
import { EditorSidePanel, useSidePanelOpen } from './_side-panel';
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
  '[&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-muted-foreground [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
);

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
 * warning (CE-018).
 */
export function DraftEditor({ draft }: { draft: ContentDraft }) {
  const t = useTranslations('contentEditor.editor');
  const autosave = useDraftAutosave(draft.id, draft);
  const [title, setTitle] = useState(draft.title);
  // The page as written now, for the side panel's Sources.
  const [pageHtml, setPageHtml] = useState(draft.bodyHtml);
  const pageReadTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pageReadTimer.current), []);
  const [status, setStatus] = useState(draft.status);
  const [marking, setMarking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const format = useFormatter();
  // A change to a locked passage, waiting for the person (CE-018).
  const [held, setHeld] = useState<HeldEdit | null>(null);
  // What quotes each locked passage, for the warning: "ChatGPT 14× and …".
  const citedBy = useRef(new Map<string, string>());
  const [citedCount, setCitedCount] = useState(0);
  // A picked page type, or the one the page shows as it is written.
  const [picked, setPicked] = useState(draft.pageTypeSource === 'user' ? draft.pageType : null);
  const [detectedType, setDetectedType] = useState(() =>
    detectPageType({ title: draft.title, html: draft.bodyHtml }, draft.siteType),
  );
  const pageType = picked ?? detectedType;
  // The HTML view's text while it is open; null in the visual editor.
  const [htmlSource, setHtmlSource] = useState<string | null>(null);
  const [htmlEdited, setHtmlEdited] = useState(false);
  // Files dropped on the page go in where they land (CE-006).
  const attachRef = useRef<(files: File[]) => void>(undefined);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [panelOpen, togglePanel] = useSidePanelOpen();
  // The header's rules chip opens the panel on Rules.
  const [tabRequest, setTabRequest] = useState<{ tab: 'rules'; n: number } | null>(null);

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
      CitedPassages.configure({
        // The first change held is the one asked about: some keyboards
        // still send the text of a key whose keydown was held, and the
        // person can't type while the question is open.
        onHeld: (edit) => setHeld((current) => current ?? edit),
      }),
    ],
    content: draft.bodyHtml,
    // Rendered on the client only, so the server's HTML can't disagree with it.
    immediatelyRender: false,
    editorProps: {
      attributes: { class: DOCUMENT_CLASS, 'aria-label': t('documentLabel') },
      transformPastedHTML: (html) => {
        // A copy from this editor keeps its images, and needs no word about it.
        if (html.includes('data-pm-slice')) {
          return cleanHtml(html, { keepImages: true, keepHtmlBlocks: true }).html;
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
        setDetectedType(detectPageType({ title: next, html: bodyHtml }, draft.siteType));
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
    // A held paste, cut or join goes through; typed text is typed again.
    if (held.tr && held.tr.before.eq(editor.state.doc)) {
      editor.view.dispatch(held.tr.setMeta(CITED_EDIT_ALLOWED, true));
    }
    setHeld(null);
    editor.commands.focus();
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

  const canMarkReady = status === 'draft' || status === 'in_review';
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
      setStatus(next);
      toast.success(t('markedReady'));
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
      const restored = await restoreDraftVersion(version.id);
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
      setDetectedType(detectPageType({ title: restored.title, html }, draft.siteType));
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
      {/* One line at any width: the title shortens, the tags give way on a
          narrow window, and the save state and Mark ready never move. */}
      <header className="flex items-center gap-2.5 border-b px-4 py-2.5">
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
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
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
        </div>
        <span className="shrink-0">
          <DraftStatusBadge status={status} />
        </span>
        <button
          type="button"
          onClick={() => {
            if (!panelOpen) togglePanel();
            setTabRequest((prev) => ({ tab: 'rules', n: (prev?.n ?? 0) + 1 }));
          }}
          title={t('rulesChipHint')}
          aria-label={t('rulesChip', { met: rules.met, total: rules.total })}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
            rules.total > 0 && rules.met === rules.total
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
          )}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {/* Short on a narrow window, so the header stays one line. */}
          <span aria-hidden className="hidden xl:inline">
            {t('rulesChip', { met: rules.met, total: rules.total })}
          </span>
          <span aria-hidden className="xl:hidden">
            {t('rulesChipShort', { met: rules.met, total: rules.total })}
          </span>
        </button>
        {/* Wide windows only: the page's green lines show them anyway, and
            the header stays one line at 1024px. */}
        {citedCount > 0 && (
          <span
            title={t('cited.chipHint')}
            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 xl:inline-flex dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
            {t('cited.chip', { count: citedCount })}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-3">
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
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
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
        {panelOpen && (
          <EditorSidePanel
            draft={draft}
            title={title}
            bodyHtml={pageHtml}
            pageType={pageType}
            rules={rules}
            reads={reads}
            tabRequest={tabRequest}
          />
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
