import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { RoleProvider } from '@/components/providers/role-provider';
import type { ComposerDraft } from '@/components/chat/composer/chat-composer';
import type { ChatMode } from '@/lib/chat/precedence';

/**
 * Ask Chat on a selection in the Content Editor: the button shows beside a
 * selected passage, and a click opens the Chat tab with the passage quoted
 * in the box, focused, and nothing sent.
 */

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/lib/actions/chat-access-requests', () => ({ requestAccess: vi.fn() }));

const { AskChatMenu, askQuote, isAskShortcut } = await import('./_ask-chat');
const { ChatComposer } = await import('@/components/chat/composer/chat-composer');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// jsdom has no layout: the bubble menu places itself from these.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

let container: HTMLDivElement;
let root: Root;
let editor: Editor;
const onSend = vi.fn();

/** The editor's page and its Chat tab, as the editor wires them: Ask Chat fills the box and opens the tab. */
function Page() {
  const [tab, setTab] = useState<'rules' | 'chat'>('rules');
  const [draft, setDraft] = useState<ComposerDraft | null>(null);
  return (
    <>
      <AskChatMenu
        editor={editor}
        onAsk={(quote) => {
          setDraft((was) => ({ nonce: (was?.nonce ?? 0) + 1, text: quote }));
          setTab('chat');
        }}
      />
      {tab === 'chat' && (
        <div data-slot="chat-tab">
          <ChatComposer
            mode={'auto' as ChatMode}
            fullAutoOpen
            onSend={onSend}
            onModeChange={vi.fn()}
            draft={draft}
          />
        </div>
      )}
    </>
  );
}

const button = () => document.querySelector<HTMLButtonElement>('[data-action="editor.askChat"]');
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 300)));

beforeEach(async () => {
  onSend.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: [StarterKit],
    content: '<p>Our pricing starts at 49 dollars a month.</p><p>Cancel any time.</p>',
  });
  vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role="admin">
          <Page />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
});
afterEach(() => {
  act(() => root.unmount());
  editor.destroy();
  document.body.innerHTML = '';
});

describe('Ask Chat on a selection', () => {
  it('shows beside a selected passage, and opens the Chat tab with it quoted, unsent', async () => {
    expect(button()).toBeNull();
    await act(async () => editor.commands.setTextSelection({ from: 1, to: 12 }));
    await settle();
    const ask = button()!;
    expect(ask).not.toBeNull();
    expect(ask.getAttribute('aria-label')).toBe('Ask Chat about the selected passage');
    expect(ask.title).toContain('Shift K');

    await act(async () => ask.click());
    const box = container.querySelector<HTMLTextAreaElement>('[data-slot="chat-tab"] textarea')!;
    expect(box.value).toBe('> Our pricing\n\n');
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe(box.value.length);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('hides on Esc and on an empty selection; Ctrl Shift K asks without the mouse', async () => {
    await act(async () => editor.commands.setTextSelection({ from: 1, to: 12 }));
    await settle();
    expect(button()).not.toBeNull();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(button()).toBeNull();

    await act(async () => editor.commands.setTextSelection(3));
    await settle();
    expect(button()).toBeNull();

    await act(async () =>
      editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 }),
    );
    const shortcut = new KeyboardEvent('keydown', {
      key: 'K',
      code: 'KeyK',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    expect(isAskShortcut(shortcut)).toBe(true);
    await act(async () => window.dispatchEvent(shortcut));
    expect(shortcut.defaultPrevented).toBe(true);
    const box = container.querySelector<HTMLTextAreaElement>('[data-slot="chat-tab"] textarea')!;
    expect(box.value).toBe('> Our pricing starts at 49 dollars a month.\n> Cancel any time.\n\n');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('trims a long passage to about 600 characters', () => {
    const quote = askQuote('word '.repeat(300));
    expect(quote.startsWith('> word')).toBe(true);
    expect(quote.endsWith('…\n\n')).toBe(true);
    expect(quote.length).toBeLessThanOrEqual(606);
  });
});
