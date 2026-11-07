import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CharacterCount } from '@tiptap/extensions';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import { ContentImage } from '@/lib/content/content-image';

vi.mock('@/lib/actions/shopping-path', () => ({
  searchProductsForBlock: vi.fn(),
  getProductsForBlock: vi.fn(),
}));
// Generate with AI's panel (its own test): here, a stub that hands back an image it made.
vi.mock('./_ai-image-panel', () => ({
  AiImagePanel: ({
    draftId,
    onUse,
  }: {
    draftId: string;
    onUse: (image: { src: string; alt: string }) => void;
  }) => (
    <button
      type="button"
      data-slot="ai-panel-stub"
      data-draft={draftId}
      onClick={() => onUse({ src: 'https://cdn.example/ai.jpg', alt: 'A coffee cup' })}
    >
      use
    </button>
  ),
}));

const { EditorToolbar, onEmptyLine, TOOLBAR_FOLD_BELOW } = await import('./_toolbar');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** An editor on the page, with the cursor at `pos`. */
function at(content: string, pos: number) {
  editor = new Editor({ extensions: [StarterKit], content });
  editor.commands.setTextSelection(pos);
  return onEmptyLine(editor, editor.state);
}

describe('onEmptyLine', () => {
  // "<h1>Title</h1>" takes positions 0–7: the empty paragraph after it opens at 7.
  it('offers the insert menu on an empty line between blocks', () => {
    expect(at('<h1>Title</h1><p></p><p>Text</p>', 8)).toBe(true);
  });

  it('not on a line with text, a heading or a list item', () => {
    expect(at('<h1>Title</h1><p></p><p>Text</p>', 11)).toBe(false);
    expect(at('<h1>Title</h1><p></p>', 3)).toBe(false);
    expect(at('<h1>Title</h1><ul><li><p></p></li></ul>', 10)).toBe(false);
  });

  it('not on an empty page, where the placeholder shows', () => {
    expect(at('<p></p>', 1)).toBe(false);
  });
});

describe('EditorToolbar', () => {
  let container: HTMLElement;
  let root: Root;
  const openUpgrade = vi.fn();
  const onToggleHtml = vi.fn();
  afterEach(() => {
    openUpgrade.mockReset();
    onToggleHtml.mockReset();
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
  });

  /** `isLocked`: a read-only workspace (plan not active). */
  async function render(
    productsBrandId: string | null,
    isLocked = false,
    aiImages: { draftId: string; title: string } | null = null,
  ) {
    editor = new Editor({
      extensions: [StarterKit, CharacterCount, ContentImage],
      content: '<h1>Title</h1><p>Text</p>',
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <EditorToolbar
              editor={editor!}
              target={3000}
              lengthWarning={false}
              htmlView={false}
              onToggleHtml={onToggleHtml}
              onAttach={() => {}}
              productsBrandId={productsBrandId}
              aiImages={aiImages}
            />
          </UpgradeDialogContext.Provider>
        </NextIntlClientProvider>,
      );
    });
  }
  const products = () =>
    document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Insert products from your catalog"]',
    );

  it("leaves + Insert › Products out of a draft that isn't an online shop's", async () => {
    await render(null);
    expect(products()).toBeNull();
    // The other tools are there.
    expect(document.body.querySelector('button[aria-label="Add an HTML block"]')).not.toBeNull();
  });

  it("offers it on an online shop's draft, from its brand's catalog", async () => {
    await render('b1');
    await act(async () => products()!.click());
    expect(document.body.textContent).toContain('Add products');
  });

  it('opens the upgrade dialog from it on a read-only workspace, and adds nothing', async () => {
    await render('b1', true);
    await act(async () => products()!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Editing the page needs a plan');
    expect(document.body.textContent).not.toContain('Add products');
  });

  const imageButton = () =>
    document.body.querySelector<HTMLButtonElement>('button[aria-label="Insert an image"]');

  it('offers Generate with AI beside the address in a draft’s image dialog, and adds the image marked as AI’s (W4-09)', async () => {
    await render(null, false, { draftId: 'draft-1', title: 'GEO strategies' });
    await act(async () => imageButton()!.click());
    const tabs = [...document.body.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(['Upload or address', 'Generate with AI']);
    expect(document.body.querySelector('[data-slot="ai-panel-stub"]')).toBeNull();
    await act(async () =>
      document.body.querySelector<HTMLButtonElement>('[data-tab="ai"]')!.click(),
    );
    const stub = document.body.querySelector<HTMLButtonElement>('[data-slot="ai-panel-stub"]')!;
    expect(stub.dataset.draft).toBe('draft-1');
    await act(async () => stub.click());
    expect(editor!.getHTML()).toContain(
      '<img src="https://cdn.example/ai.jpg" alt="A coffee cup" data-ai-generated="true">',
    );
  });

  it('keeps the image dialog as it was outside a draft', async () => {
    await render(null);
    await act(async () => imageButton()!.click());
    expect(document.body.querySelector('[role="tab"]')).toBeNull();
    expect(document.body.textContent).toContain('Image address');
  });

  // In a pane beside Chat (CHAT-25 §4): the toolbar's own width, not the window's.
  describe('on a narrow editor', () => {
    /** The toolbar's width, as its ResizeObserver reports it; `resize` reports a new one. */
    let width = 900;
    let report: (() => void) | null = null;
    beforeEach(() => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(private callback: ResizeObserverCallback) {}
          observe(el: Element) {
            report = () =>
              this.callback(
                [
                  {
                    target: el,
                    contentRect: { width: width - 32 },
                    borderBoxSize: [{ inlineSize: width, blockSize: 40 }],
                  } as unknown as ResizeObserverEntry,
                ],
                this as unknown as ResizeObserver,
              );
            report();
          }
          unobserve() {}
          disconnect() {
            report = null;
          }
        },
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      width = 900;
    });
    async function resize(next: number) {
      width = next;
      await act(async () => report?.());
    }

    const toolbar = () => document.body.querySelector('[role="toolbar"]')!;
    const tool = (label: string) =>
      toolbar().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    const more = () =>
      [...toolbar().querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === 'More',
      );
    const items = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    async function pick(name: string) {
      await act(async () => more()!.click());
      await act(async () =>
        items()
          .find((i) => i.textContent?.endsWith(name))!
          .click(),
      );
    }
    const LESS_USED = [
      'Numbered list',
      'Quote',
      'Insert a table',
      'Add an HTML block',
      'Attach a file: Excel, CSV, Word, Markdown, HTML or text',
      'Edit as HTML',
    ];
    const KEPT = [
      'Heading 2',
      'Heading 3',
      'Bold',
      'Italic',
      'Link',
      'Bulleted list',
      'Insert an image',
    ];

    it('keeps every tool in the row at a normal width, with no More', async () => {
      width = TOOLBAR_FOLD_BELOW;
      await render(null);
      expect(more()).toBeUndefined();
      for (const label of [...KEPT, ...LESS_USED]) expect(tool(label), label).not.toBeNull();
    });

    it('folds the less-used tools into More below 600px, and removes none', async () => {
      width = 520;
      await render('b1');
      for (const label of LESS_USED) expect(tool(label), label).toBeNull();
      expect(tool('Insert products from your catalog')).toBeNull();
      for (const label of KEPT) expect(tool(label), label).not.toBeNull();
      // H1 stays as it is: disabled, saying why, while the page has its H1.
      await act(async () => editor!.commands.setTextSelection(9));
      expect(tool('A page has one H1, its title: use Heading 2 here')!.ariaDisabled).toBe('true');

      await act(async () => more()!.click());
      expect(items().map((i) => i.textContent)).toEqual([
        'Numbered list',
        'Quote',
        'Table',
        'Add HTML',
        'Products',
        'Attach a file',
        '</>Edit as HTML',
      ]);
    });

    it('runs the same commands from More as from the row', async () => {
      width = 520;
      await render(null);
      await act(async () => editor!.commands.setTextSelection(9));
      await pick('Numbered list');
      expect(editor!.getHTML()).toContain('<ol><li><p>Text</p></li></ol>');
      // The numbered list is on: More marks it.
      await act(async () => more()!.click());
      expect(items()[0].querySelector('svg + svg')).not.toBeNull();
      await act(async () => items()[0].click());
      expect(editor!.getHTML()).not.toContain('<ol>');

      await pick('Quote');
      expect(editor!.getHTML()).toContain('<blockquote>');
      await pick('Add HTML');
      expect(document.body.textContent).toContain('Add an HTML block');
      await act(async () =>
        document.body.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click(),
      );
      await pick('Edit as HTML');
      expect(onToggleHtml).toHaveBeenCalledTimes(1);
    });

    it('opens the upgrade dialog from More on a read-only workspace, and changes nothing', async () => {
      width = 520;
      await render(null, true);
      await act(async () => editor!.commands.setTextSelection(9));
      await pick('Quote');
      expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Editing the page needs a plan');
      expect(editor!.getHTML()).not.toContain('<blockquote>');
    });

    it('unfolds when the editor widens again, and folds as it narrows', async () => {
      await render(null);
      expect(more()).toBeUndefined();
      await resize(560);
      expect(more()).toBeDefined();
      expect(tool('Quote')).toBeNull();
      await resize(800);
      expect(more()).toBeUndefined();
      expect(tool('Quote')).not.toBeNull();
    });
  });
});
