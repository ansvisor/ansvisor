'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquareQuote } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { PluginKey } from '@tiptap/pm/state';
import { useIsMac } from '@/components/chat/chat-shortcuts';

/** The longest passage the quote carries, in characters. */
const QUOTE_MAX = 600;

const ASK_MENU = new PluginKey('askChat');

/** The selected passage as a quote for Chat's box, with room after it to say what to do. */
export function askQuote(passage: string): string {
  const text = passage.trim();
  const cut = text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX).trimEnd()}…` : text;
  const lines = cut.split(/\n+/).map((line) => `> ${line.trim()}`);
  return `${lines.join('\n')}\n\n`;
}

/** Ctrl Shift K (⌘⇧K): Ask Chat about the selected passage. */
export function isAskShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    (event.key.toLowerCase() === 'k' || event.code === 'KeyK')
  );
}

/**
 * Ask Chat on a selection in the page: a small button beside the selected
 * passage (TipTap's bubble menu), or Ctrl Shift K. It hands the passage on
 * as a quote for the Chat tab's box and sends nothing. It hides on Esc, an
 * empty selection, or when the page loses focus.
 */
export function AskChatMenu({
  editor,
  onAsk,
}: {
  editor: Editor;
  /** The quote, for the Chat tab's box. */
  onAsk: (quote: string) => void;
}) {
  const t = useTranslations('contentEditor.editor.askChat');
  const isMac = useIsMac();
  const onAskRef = useRef(onAsk);
  useEffect(() => {
    onAskRef.current = onAsk;
  });

  const hide = () => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(ASK_MENU, 'hide'));
  };
  const ask = (): boolean => {
    const { from, to, empty } = editor.state.selection;
    const text = empty ? '' : editor.state.doc.textBetween(from, to, '\n');
    if (!text.trim()) return false;
    hide();
    onAskRef.current(askQuote(text));
    return true;
  };
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editor.isDestroyed || !editor.view.hasFocus()) return;
      if (event.key === 'Escape') hide();
      else if (isAskShortcut(event) && askRef.current()) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const keys = isMac ? '⌘⇧K' : 'Ctrl Shift K';
  return (
    <BubbleMenu editor={editor} pluginKey={ASK_MENU} options={{ placement: 'top' }}>
      <button
        type="button"
        data-action="editor.askChat"
        aria-label={t('aria')}
        aria-keyshortcuts="Control+Shift+K Meta+Shift+K"
        title={t('title', { keys })}
        onClick={() => ask()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          hide();
          editor.commands.focus();
        }}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-popover px-2 text-xs font-medium text-popover-foreground shadow-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <MessageSquareQuote className="size-3.5" aria-hidden />
        {t('label')}
      </button>
    </BubbleMenu>
  );
}
