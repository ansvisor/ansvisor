import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentDraft } from '@/lib/content/drafts';
import ContentEditorPage from './page';

const getContentDraft = vi.fn();
const markContentDraftReady = vi.fn();
const saveContentDraft = vi.fn();
const setContentDraftPageType = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  getContentDraft: (...args: unknown[]) => getContentDraft(...args),
  markContentDraftReady: (...args: unknown[]) => markContentDraftReady(...args),
  saveContentDraft: (...args: unknown[]) => saveContentDraft(...args),
  setContentDraftPageType: (...args: unknown[]) => setContentDraftPageType(...args),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ draftId: 'd1' }) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const brandState = vi.hoisted(() => ({
  activeBrandId: 'b1' as string | null,
  brands: [{ id: 'b1' }, { id: 'b2' }],
  setActiveBrand: vi.fn(),
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: typeof brandState) => unknown) => selector(brandState),
}));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
);
vi.mock('mammoth', () => ({
  default: {
    convertToHtml: async () => ({
      value:
        '<h2>From Word</h2><p>Body <strong>bold</strong> <img src="data:image/png;base64,AA"></p>',
    }),
  },
}));
vi.mock('sonner', () => ({ toast }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, and its ranges can't be measured. ProseMirror measures
// one when it scrolls the cursor into view (after inserting a block), which
// otherwise throws after the test, on a timer.
// Nor can jsdom's files be read as text or bytes, as browsers' can.
function readBlob<T>(blob: Blob, read: (reader: FileReader) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as T);
    reader.onerror = () => reject(reader.error);
    read(reader);
  });
}
if (!('text' in Blob.prototype)) {
  Object.assign(Blob.prototype, {
    text(this: Blob) {
      return readBlob<string>(this, (r) => r.readAsText(this));
    },
    arrayBuffer(this: Blob) {
      return readBlob<ArrayBuffer>(this, (r) => r.readAsArrayBuffer(this));
    },
  });
}
if (!('getClientRects' in Range.prototype)) {
  Object.assign(Range.prototype, {
    getClientRects: () => [] as unknown as DOMRectList,
    getBoundingClientRect: () => new DOMRect(),
  });
}

const draft = (over: Partial<ContentDraft> = {}): ContentDraft => ({
  id: 'd1',
  brandId: 'b1',
  title: 'Pipeline forecasting',
  pageType: 'feature_page',
  pageTypeSource: 'user',
  siteType: 'b2b',
  method: 'optimize',
  status: 'in_review',
  bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams trust it.</p>',
  author: 'agent',
  updatedAt: '2026-10-20T10:00:00Z',
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function renderPage() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ContentEditorPage />
      </NextIntlClientProvider>,
    );
  });
  // The editor mounts on the client after the first render.
  await act(async () => {});
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent === name,
  );

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getContentDraft.mockReset();
  markContentDraftReady.mockReset();
  setContentDraftPageType.mockReset().mockResolvedValue(undefined);
  saveContentDraft.mockReset().mockResolvedValue({ updatedAt: '2026-10-20T10:00:00Z' });
  brandState.activeBrandId = 'b1';
  brandState.setActiveBrand.mockReset();
  toast.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  toast.info.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the content editor', () => {
  it('opens the draft with its title, type, method, status and length', async () => {
    getContentDraft.mockResolvedValue(draft());
    await renderPage();

    expect(getContentDraft).toHaveBeenCalledWith('d1');
    const header = container.querySelector('header')!;
    expect(header.querySelector('h1')!.textContent).toBe('Pipeline forecasting');
    expect(header.textContent).toContain('Feature page');
    expect(header.textContent).toContain('Optimize');
    expect(header.textContent).toContain('In review');
    expect(header.textContent).toContain('Saved');
    expect(container.querySelector('a[href="/dashboard/content/library"]')).not.toBeNull();

    // The page's text, against a feature page's 3,000-character target.
    expect(container.querySelector('[role="toolbar"]')!.textContent).toContain(
      '35 / 3,000 characters',
    );
    for (const name of ['Heading 1', 'Bold', 'Link', 'Numbered list', 'Insert a table']) {
      expect(button(name)).toBeDefined();
    }
    expect(container.querySelector('.ProseMirror h1')!.textContent).toBe('Pipeline forecasting');
  });

  it('tags a new page as one', async () => {
    getContentDraft.mockResolvedValue(
      draft({
        method: 'create',
        pageType: 'product_page',
        status: 'draft',
        title: '',
        bodyHtml: '',
      }),
    );
    await renderPage();
    const header = container.querySelector('header')!;
    expect(header.textContent).toContain('Product page · New page');
    expect(header.querySelector('h1')!.textContent).toBe('Untitled');
    expect(container.querySelector('[role="toolbar"]')!.textContent).toContain(
      '0 / 1,200 characters',
    );
  });

  describe('the page type', () => {
    const typeMenu = () =>
      container.querySelector<HTMLButtonElement>('header button[aria-label^="Page type:"]')!;
    /** Opens the page type menu and returns its types. */
    async function openTypes() {
      const trigger = typeMenu();
      await act(async () => {
        trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        trigger.click();
      });
      return [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    }
    /** Replaces the page through the HTML view. */
    async function rewrite(html: string) {
      await act(async () => button('Edit as HTML')!.click());
      const source = container.querySelector('textarea')!;
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      await act(async () => {
        setValue.call(source, html);
        source.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => button('Back to visual')!.click());
    }

    it('follows the page while it is detected, and keeps the type the person picks', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          title: 'Northwind vs HubSpot',
          bodyHtml: '<h1>Northwind vs HubSpot</h1>',
          pageType: 'comparison',
          pageTypeSource: 'detected',
        }),
      );
      await renderPage();
      expect(typeMenu().textContent).toBe('Comparison');
      expect(typeMenu().title).toBe('Detected from the page as you write. Pick a type to keep it.');

      await rewrite('<h1>How to clean CRM data</h1>');
      expect(typeMenu().textContent).toBe('Guide');

      const types = await openTypes();
      expect(types.map((item) => item.textContent)).toEqual([
        'Feature page',
        'Solution page',
        'Comparison',
        'Integration',
        'Pricing',
        'Guide',
        'Blog post',
        'Docs / FAQ',
      ]);
      expect(document.body.textContent).toContain('B2B SaaS page types');
      await act(async () => types.find((item) => item.textContent === 'Pricing')!.click());
      expect(setContentDraftPageType).toHaveBeenCalledWith('d1', 'pricing');
      expect(typeMenu().textContent).toBe('Pricing');
      expect(typeMenu().title).toBe('');

      // Picked: the page no longer changes it.
      await rewrite('<h1>Northwind vs HubSpot</h1>');
      expect(typeMenu().textContent).toBe('Pricing');
    });

    it('offers a shop its own types, and keeps a type from another kind of site listed', async () => {
      getContentDraft.mockResolvedValue(
        draft({ siteType: 'ecommerce', pageType: 'feature_page', method: 'create' }),
      );
      await renderPage();
      expect(typeMenu().textContent).toBe('Feature page · New page');
      const types = await openTypes();
      expect(types.map((item) => item.textContent)).toEqual([
        'Product page',
        'Category page',
        'Buying guide',
        'Best-of list',
        'Policy',
        'Blog post',
        'Feature page',
      ]);
    });

    it('puts the type back when picking it fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      setContentDraftPageType.mockRejectedValue(new Error('not_found'));
      getContentDraft.mockResolvedValue(draft({ siteType: 'ecommerce', pageType: 'product_page' }));
      await renderPage();
      const types = await openTypes();
      await act(async () => types.find((item) => item.textContent === 'Policy')!.click());
      expect(toast.error).toHaveBeenCalledWith("Couldn't change the page type. Try again.");
      expect(typeMenu().textContent).toBe('Product page');
    });

    it('says when no type is detected yet', async () => {
      getContentDraft.mockResolvedValue(
        draft({ pageType: null, pageTypeSource: 'detected', method: 'create' }),
      );
      await renderPage();
      expect(typeMenu().textContent).toBe('Set page type · New page');
    });
  });

  it('marks the draft ready once', async () => {
    getContentDraft.mockResolvedValue(draft());
    markContentDraftReady.mockResolvedValue('ready');
    await renderPage();

    await act(async () => button('Mark ready')!.click());
    expect(markContentDraftReady).toHaveBeenCalledWith('d1');
    expect(toast.success).toHaveBeenCalled();
    expect(container.querySelector('header')!.textContent).toContain('Ready');
    expect(button('Mark ready')!.disabled).toBe(true);
  });

  it('shows the page as HTML, and cleans it when it switches back', async () => {
    getContentDraft.mockResolvedValue(
      draft({
        bodyHtml:
          '<h1>Trail Runner X</h1><script type="application/ld+json">{"@type":"Product"}</script>',
      }),
    );
    await renderPage();
    // Schema JSON-LD shows as a labelled block, not as text.
    expect(container.querySelector('[data-json-ld]')!.textContent).toBe(
      '{ } Schema · Product (JSON-LD)',
    );

    await act(async () => button('Edit as HTML')!.click());
    const source = container.querySelector('textarea')!;
    expect(source.value).toBe(
      '<h1>Trail Runner X</h1>\n<script type="application/ld+json">{"@type":"Product"}</script>',
    );
    // The other tools wait while the HTML view is open.
    expect(button('Bold')!.disabled).toBe(true);

    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(
        source,
        `${source.value}<p style="color:red">New <script>alert(1)</script>line</p>`,
      );
      source.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Back to visual')!.click());

    expect(container.querySelector('textarea')).toBeNull();
    expect(toast).toHaveBeenCalledWith('HTML applied · 1 unsafe tag removed');
    const page = container.querySelector('.ProseMirror')!;
    expect(page.querySelector('p')!.outerHTML).toBe('<p>New line</p>');
    expect(page.querySelector('[data-json-ld]')).not.toBeNull();
    expect(page.textContent).not.toContain('alert');
  });

  it('goes back from an unedited HTML view without saving anything', async () => {
    getContentDraft.mockResolvedValue(draft());
    await renderPage();
    await act(async () => button('Edit as HTML')!.click());
    await act(async () => button('Back to visual')!.click());
    expect(container.querySelector('textarea')).toBeNull();
    expect(toast).not.toHaveBeenCalled();
    expect(container.querySelector('header')!.textContent).toContain('Saved');
  });

  it('adds HTML blocks, shows their code as text, and copies one or the whole page', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    getContentDraft.mockResolvedValue(draft({ bodyHtml: '<h1>Trail Runner X</h1>' }));
    await renderPage();

    const code =
      '<iframe src="https://www.youtube.com/embed/x"></iframe>\n<script>track()</script>';
    await act(async () => button('Add an HTML block')!.click());
    const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Code"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(field, code);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Add block')!.click();
    });
    await act(async () => {});

    const block = container.querySelector('[data-html-block-view]')!;
    expect(block.textContent).toContain('HTML block');
    expect(block.textContent).toContain('2 lines');
    // The code is text on the page, never markup: no iframe, no script runs.
    expect(block.querySelector('pre')!.textContent).toBe(code);
    expect(container.querySelector('.ProseMirror iframe, .ProseMirror script')).toBeNull();

    const copyBlock = [...block.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Copy HTML',
    )!;
    await act(async () => copyBlock.click());
    expect(writeText).toHaveBeenLastCalledWith(code);

    const copyPage = [...container.querySelectorAll<HTMLButtonElement>('header button')].find(
      (b) => b.textContent === 'Copy HTML',
    )!;
    await act(async () => copyPage.click());
    // The block went in where the cursor was: the start, as nothing was clicked.
    expect(writeText).toHaveBeenLastCalledWith(`${code}\n<h1>Trail Runner X</h1>`);
    expect(toast.success).toHaveBeenLastCalledWith('HTML copied');
  });

  it('shows the link the cursor is in, to open in a new tab', async () => {
    getContentDraft.mockResolvedValue(
      draft({ bodyHtml: '<p><a href="https://gartner.com/x">Gartner</a> says so.</p>' }),
    );
    await renderPage();
    const target = container.querySelector<HTMLAnchorElement>('[role="toolbar"] a')!;
    expect(target.getAttribute('href')).toBe('https://gartner.com/x');
    expect(target.target).toBe('_blank');
    expect(target.rel).toBe('noopener noreferrer');
    expect(target.textContent).toBe('gartner.com/x');
  });

  describe('attaching files', () => {
    const said = () =>
      toast.success.mock.calls.length +
      toast.error.mock.calls.length +
      toast.info.mock.calls.length;
    /** Attaches the files, and waits until each has said something or a preview opened. */
    async function attach(...files: File[]) {
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, 'files', { value: files, configurable: true });
      const before = said();
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      // Reading a file, and loading its reader the first time, take real time.
      for (let i = 0; i < 80; i++) {
        if (said() - before >= files.length || document.querySelector('[role="dialog"]')) break;
        await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
      }
    }
    const dialogButton = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (b) => b.textContent === name,
      );

    beforeEach(async () => {
      getContentDraft.mockResolvedValue(draft({ bodyHtml: '<p>Intro</p>' }));
      await renderPage();
    });

    it('previews a CSV and inserts it as a table, its first row the header', async () => {
      await attach(new File(['Keyword,Volume\ncrm forecasting,210\npipeline,96\n'], 'kw.csv'));
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain('kw.csv');
      expect(dialog.textContent).toContain('2 rows · 2 columns');

      await act(async () => dialogButton('Insert as table')!.click());
      const table = container.querySelector('.ProseMirror table')!;
      expect([...table.querySelectorAll('th')].map((c) => c.textContent)).toEqual([
        'Keyword',
        'Volume',
      ]);
      expect(table.querySelectorAll('tr')).toHaveLength(3);
      expect(toast.success).toHaveBeenCalledWith('Table inserted from kw.csv · 2 rows');
    });

    it('puts the next import under a table, not in its cell', async () => {
      await attach(new File(['A,B\n1,2\n'], 'one.csv'));
      await act(async () => dialogButton('Insert as table')!.click());
      await attach(new File(['After the table'], 'note.txt'));
      const page = container.querySelector('.ProseMirror')!;
      expect(page.querySelectorAll('table')).toHaveLength(1);
      expect(page.querySelector('table')!.textContent).not.toContain('After the table');
      expect(page.textContent).toContain('After the table');
    });

    it('asks before inserting a table over 200 rows', async () => {
      const csv = ['n', ...Array.from({ length: 250 }, (_, i) => String(i))].join('\n');
      await attach(new File([csv], 'long.csv'));
      await act(async () => dialogButton('Insert as table')!.click());
      expect(container.querySelector('.ProseMirror table')).toBeNull();
      expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
        'This table has 250 rows.',
      );
      await act(async () => dialogButton('Insert all 250 rows')!.click());
      expect(container.querySelectorAll('.ProseMirror table tr')).toHaveLength(251);
    });

    it('inserts only the rows that fit in the page’s size limit, after saying so', async () => {
      const cell = 'x'.repeat(1000);
      const csv = ['a,b,c', ...Array.from({ length: 1000 }, () => `${cell},${cell},${cell}`)].join(
        '\n',
      );
      await attach(new File([csv], 'big.csv'));
      await act(async () => dialogButton('Insert as table')!.click());
      expect(container.querySelector('.ProseMirror table')).toBeNull();
      const note = document.querySelector('[role="dialog"]')!.textContent!;
      const fit = Number(
        /Only the first ([\d,]+) of 1,000 rows fit/.exec(note)![1].replace(',', ''),
      );
      expect(fit).toBeGreaterThan(100);
      expect(fit).toBeLessThan(1000);
      await act(async () => dialogButton(`Insert the first ${fit} rows`)!.click());
      expect(container.querySelectorAll('.ProseMirror table tr')).toHaveLength(fit + 1);
      // As the editor saves it, the page stays under the limit.
      const editorHtml = container.querySelector('.ProseMirror')!.innerHTML;
      expect(editorHtml.length).toBeLessThan(500_000);
    });

    it('imports Markdown and Word as content, cleaned like a paste', async () => {
      await attach(
        new File(
          ['## From Markdown\n\nA *note* with a [link](https://acme.com/?utm_source=x).'],
          'notes.md',
        ),
      );
      const page = container.querySelector('.ProseMirror')!;
      expect(page.querySelector('h2')!.textContent).toBe('From Markdown');
      expect(page.querySelector('a')!.getAttribute('href')).toBe('https://acme.com/');
      expect(toast.success).toHaveBeenLastCalledWith('notes.md imported');

      await attach(new File(['PK'], 'brief.docx'));
      expect([...page.querySelectorAll('h2')].map((h) => h.textContent)).toContain('From Word');
      expect(page.querySelector('img')).toBeNull();
      expect(toast.success).toHaveBeenLastCalledWith('brief.docx imported · 1 image left out');
    });

    it('says what it can’t take: images, old formats, large files', async () => {
      await attach(
        new File(['x'], 'shoe.png'),
        new File(['x'], 'old.xls'),
        new File(['x'.repeat(10 * 1024 * 1024 + 1)], 'huge.txt'),
      );
      expect(toast.info).toHaveBeenCalledWith(
        "Images can't be attached yet. Add shoe.png with Insert an image, by its address.",
      );
      expect(toast.error).toHaveBeenCalledWith('Save old.xls as .xlsx or .docx, then attach it.');
      expect(toast.error).toHaveBeenCalledWith('huge.txt is over 10 MB.');
      expect(container.querySelector('.ProseMirror')!.textContent).toBe('Intro');
    });
  });

  it('follows the draft’s brand in the sidebar', async () => {
    getContentDraft.mockResolvedValue(draft({ brandId: 'b2' }));
    await renderPage();
    expect(brandState.setActiveBrand).toHaveBeenCalledWith('b2');
  });

  it('says when the draft can’t be opened', async () => {
    getContentDraft.mockResolvedValue(null);
    await renderPage();
    expect(container.textContent).toContain(
      "This draft doesn't exist, or it belongs to another workspace.",
    );
    expect(container.querySelector('a[href="/dashboard/content/library"]')).not.toBeNull();
  });
});
