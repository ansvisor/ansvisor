'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  Bold,
  ExternalLink,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Rows3,
  Table2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatNumber } from '@/lib/format';
import { safeImageSrc, safeLinkHref } from '@/lib/content/editor';
import { cn } from '@/lib/utils';

/**
 * The editor's toolbar (CE-004, spec §6): H1 H2 H3 · B I link · lists,
 * quote · table, image, and the length counter against the page type's
 * target. Inside a table it adds a row, a column, or removes the table.
 */
export function EditorToolbar({ editor, target }: { editor: Editor; target: number }) {
  const t = useTranslations('contentEditor.editor.toolbar');
  const [dialog, setDialog] = useState<'link' | 'image' | null>(null);

  // Re-read only what the toolbar shows, not on every keystroke's render.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      link: e.isActive('link'),
      href: e.isActive('link')
        ? ((e.getAttributes('link').href as string | undefined) ?? null)
        : null,
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      inTable: e.isActive('table'),
      characters: e.storage.characterCount.characters() as number,
    }),
  });

  const chain = () => editor.chain().focus();
  const tools = [
    [
      {
        key: 'h1',
        icon: Heading1,
        on: state.h1,
        run: () => chain().toggleHeading({ level: 1 }).run(),
      },
      {
        key: 'h2',
        icon: Heading2,
        on: state.h2,
        run: () => chain().toggleHeading({ level: 2 }).run(),
      },
      {
        key: 'h3',
        icon: Heading3,
        on: state.h3,
        run: () => chain().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      { key: 'bold', icon: Bold, on: state.bold, run: () => chain().toggleBold().run() },
      { key: 'italic', icon: Italic, on: state.italic, run: () => chain().toggleItalic().run() },
      { key: 'link', icon: Link2, on: state.link, run: () => setDialog('link') },
    ],
    [
      {
        key: 'bulletList',
        icon: List,
        on: state.bulletList,
        run: () => chain().toggleBulletList().run(),
      },
      {
        key: 'orderedList',
        icon: ListOrdered,
        on: state.orderedList,
        run: () => chain().toggleOrderedList().run(),
      },
      {
        key: 'quote',
        icon: Quote,
        on: state.blockquote,
        run: () => chain().toggleBlockquote().run(),
      },
    ],
    [
      {
        key: 'table',
        icon: Table2,
        on: state.inTable,
        run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      { key: 'image', icon: ImagePlus, on: false, run: () => setDialog('image') },
    ],
  ];
  const tableTools = [
    { key: 'addRow', icon: Rows3, run: () => chain().addRowAfter().run() },
    { key: 'addColumn', icon: Columns3, run: () => chain().addColumnAfter().run() },
    { key: 'deleteTable', icon: Trash2, run: () => chain().deleteTable().run() },
  ];

  return (
    <div
      role="toolbar"
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-0.5 border-b px-4 py-1.5"
    >
      {tools.map((group, i) => (
        <div key={i} className="flex items-center gap-0.5">
          {i > 0 && <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-border" />}
          {group.map((tool) => (
            <ToolButton key={tool.key} label={t(tool.key)} pressed={tool.on} onClick={tool.run}>
              <tool.icon className="h-4 w-4" />
            </ToolButton>
          ))}
        </div>
      ))}
      {state.href && <LinkTarget href={state.href} />}
      {state.inTable && (
        <div className="flex items-center gap-0.5">
          <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-border" />
          {tableTools.map((tool) => (
            <ToolButton key={tool.key} label={t(tool.key)} onClick={tool.run}>
              <tool.icon className="h-4 w-4" />
            </ToolButton>
          ))}
        </div>
      )}
      <span
        className={cn(
          'ml-auto text-xs font-medium tabular-nums text-muted-foreground',
          state.characters > target && 'text-amber-700 dark:text-amber-400',
        )}
      >
        {t('counter', {
          count: formatNumber(state.characters),
          target: formatNumber(target),
        })}
      </span>

      {/* Mounted while open, so each opening starts from the selection. */}
      {dialog === 'link' && <LinkDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialog === 'image' && <ImageDialog editor={editor} onClose={() => setDialog(null)} />}
    </div>
  );
}

/**
 * The link the cursor is in: its address, and a way to open it in a new tab
 * (a path on the brand's own site has no address here to open).
 */
function LinkTarget({ href }: { href: string }) {
  const t = useTranslations('contentEditor.editor.toolbar');
  const safe = safeLinkHref(href);
  const label = href.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const className =
    'ml-1 flex max-w-[240px] items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-blue-600 dark:text-blue-400';
  if (!safe || !/^https?:/.test(safe)) {
    return (
      <span className={cn(className, 'text-muted-foreground dark:text-muted-foreground')}>
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      title={t('openLink')}
      className={cn(className, 'hover:bg-muted hover:underline')}
    >
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

function ToolButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      // Keep the editor's selection: a click on the toolbar mustn't move focus first.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        pressed && 'bg-muted text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** Set, change or remove the link on the selection. */
function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useTranslations('contentEditor.editor.link');
  const [current] = useState(() => editor.getAttributes('link').href as string | undefined);
  const [value, setValue] = useState(current ?? '');
  const [invalid, setInvalid] = useState(false);

  const apply = () => {
    const href = safeLinkHref(value);
    if (!href) {
      setInvalid(true);
      return;
    }
    if (editor.state.selection.empty && !current) {
      // Nothing selected: the address goes in as its own link text.
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{current ? t('editTitle') : t('title')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <Label htmlFor="content-link-href">{t('label')}</Label>
          <Input
            id="content-link-href"
            autoFocus
            value={value}
            placeholder={t('placeholder')}
            aria-invalid={invalid}
            onChange={(e) => {
              setValue(e.target.value);
              setInvalid(false);
            }}
          />
          {invalid && <p className="text-xs text-destructive">{t('invalid')}</p>}
        </form>
        <DialogFooter>
          {current && (
            <Button
              variant="ghost"
              className="mr-auto text-muted-foreground"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                onClose();
              }}
            >
              {t('remove')}
            </Button>
          )}
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <Button onClick={apply}>{t('apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Insert an image by its address; uploads come with attachments (CE-006). */
function ImageDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useTranslations('contentEditor.editor.image');
  const [src, setSrc] = useState('');
  const [alt, setAlt] = useState('');
  const [invalid, setInvalid] = useState(false);

  const insert = () => {
    const safe = safeImageSrc(src);
    if (!safe) {
      setInvalid(true);
      return;
    }
    editor
      .chain()
      .focus()
      .setImage({ src: safe, alt: alt.trim() || undefined })
      .run();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            insert();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="content-image-src">{t('srcLabel')}</Label>
            <Input
              id="content-image-src"
              autoFocus
              value={src}
              placeholder="https://"
              aria-invalid={invalid}
              onChange={(e) => {
                setSrc(e.target.value);
                setInvalid(false);
              }}
            />
            {invalid && <p className="text-xs text-destructive">{t('invalid')}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="content-image-alt">{t('altLabel')}</Label>
            <Input
              id="content-image-alt"
              value={alt}
              placeholder={t('altPlaceholder')}
              onChange={(e) => setAlt(e.target.value)}
            />
          </div>
          {/* Enter in either field inserts. */}
          <button type="submit" hidden />
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <Button onClick={insert}>{t('insert')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
