'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EditorContent, useEditor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { ArrowLeft, Check, Copy, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { DraftMethodBadge, DraftStatusBadge } from '@/components/content/draft-badges';
import { markContentDraftReady, setContentDraftPageType } from '@/lib/actions/content-drafts';
import { CONTENT_LIBRARY_PATH, type ContentDraft, type PageType } from '@/lib/content/drafts';
import {
  cleanHtml,
  formatHtmlSource,
  htmlFromSource,
  publishableHtml,
} from '@/lib/content/clean-html';
import { draftTitleFromDoc, lengthTarget, safeLinkHref } from '@/lib/content/editor';
import { JsonLd } from '@/lib/content/json-ld-node';
import { detectPageType } from '@/lib/content/page-types';
import { cn } from '@/lib/utils';
import { DropOverlay, useAttachments } from './_attach';
import { HtmlBlock, copyToClipboard } from './_html-block';
import { PageTypeMenu } from './_page-type-menu';
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
 * as it is written until the person picks one (CE-023).
 */
export function DraftEditor({ draft }: { draft: ContentDraft }) {
  const t = useTranslations('contentEditor.editor');
  const autosave = useDraftAutosave(draft.id, draft);
  const [title, setTitle] = useState(draft.title);
  const [status, setStatus] = useState(draft.status);
  const [marking, setMarking] = useState(false);
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
      setDetectedType(detectPageType({ title: next, html: bodyHtml }, draft.siteType));
      autosave.schedule({ title: next, bodyHtml });
    },
  });

  const attachments = useAttachments(editor);
  useEffect(() => {
    attachRef.current = (files) => void attachments.attach(files);
  });

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
    // Emits an update, so the title and the autosave follow.
    editor.commands.setContent(cleaned.html);
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
      // What's waiting goes out first, so the ready draft is the one on screen;
      // a page that can't be saved isn't marked ready.
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
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <SaveIndicator state={autosave.state} onRetry={() => void autosave.retry()} />
          <Button variant="outline" size="sm" onClick={copyPageHtml} title={t('copyHtmlHint')}>
            <Copy className="h-3.5 w-3.5" />
            {t('copyHtml')}
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
        </div>
      </header>

      {editor && (
        <EditorToolbar
          editor={editor}
          target={lengthTarget(pageType)}
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
            className={cn('mx-auto max-w-[720px] px-7 pt-7 pb-20', htmlSource !== null && 'hidden')}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
        {dragging && <DropOverlay />}
      </div>
      {attachments.ui}
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
