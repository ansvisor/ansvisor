'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { DraftMethodBadge, DraftStatusBadge } from '@/components/content/draft-badges';
import { markContentDraftReady } from '@/lib/actions/content-drafts';
import { CONTENT_LIBRARY_PATH, isPageType, type ContentDraft } from '@/lib/content/drafts';
import { draftTitleFromDoc, lengthTarget, safeLinkHref } from '@/lib/content/editor';
import { cn } from '@/lib/utils';
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
 */
export function DraftEditor({ draft }: { draft: ContentDraft }) {
  const t = useTranslations('contentEditor.editor');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const autosave = useDraftAutosave(draft.id, draft);
  const [title, setTitle] = useState(draft.title);
  const [status, setStatus] = useState(draft.status);
  const [marking, setMarking] = useState(false);

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
    ],
    content: draft.bodyHtml,
    // Rendered on the client only, so the server's HTML can't disagree with it.
    immediatelyRender: false,
    editorProps: {
      attributes: { class: DOCUMENT_CLASS, 'aria-label': t('documentLabel') },
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
    },
    onUpdate: ({ editor: e }) => {
      const next = draftTitleFromDoc(e.getJSON());
      setTitle(next);
      autosave.schedule({ title: next, bodyHtml: e.getHTML() });
    },
  });

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

  const typeLabel = isPageType(draft.pageType) ? tTypes(draft.pageType) : null;
  const pageTag = [typeLabel, draft.method === 'create' ? t('newPage') : null]
    .filter(Boolean)
    .join(' · ');

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
          {pageTag && (
            <Badge variant="outline" className="font-normal">
              {pageTag}
            </Badge>
          )}
          <DraftMethodBadge method={draft.method} />
        </div>
        <span className="shrink-0">
          <DraftStatusBadge status={status} />
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <SaveIndicator state={autosave.state} onRetry={() => void autosave.retry()} />
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

      {editor && <EditorToolbar editor={editor} target={lengthTarget(draft.pageType)} />}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-7 pt-7 pb-20">
          <EditorContent editor={editor} />
        </div>
      </div>
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
