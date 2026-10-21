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
const getContentImpact = vi.fn();
const getContentResults = vi.fn();
const getDraftSources = vi.fn();
const getDraftBrief = vi.fn();
const rebuildDraftBrief = vi.fn();
const saveDraftRules = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  saveDraftRules: (...args: unknown[]) => saveDraftRules(...args),
  getDraftSources: (...args: unknown[]) => getDraftSources(...args),
  getDraftBrief: (...args: unknown[]) => getDraftBrief(...args),
  rebuildDraftBrief: (...args: unknown[]) => rebuildDraftBrief(...args),
  getContentImpact: (...args: unknown[]) => getContentImpact(...args),
  getContentResults: (...args: unknown[]) => getContentResults(...args),
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

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

const draft = (over: Partial<ContentDraft> = {}): ContentDraft => ({
  id: 'd1',
  brandId: 'b1',
  title: 'Pipeline forecasting',
  pageType: 'feature_page',
  pageTypeSource: 'user',
  siteType: 'b2b',
  sourceUrl: null,
  method: 'optimize',
  status: 'in_review',
  bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams trust it.</p>',
  author: 'agent',
  rules: { set: null, overrides: {} },
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
  getContentImpact.mockReset().mockResolvedValue(null);
  getContentResults.mockReset().mockResolvedValue(null);
  getDraftSources.mockReset().mockResolvedValue(null);
  getDraftBrief.mockReset().mockResolvedValue({ brief: null });
  rebuildDraftBrief.mockReset();
  saveDraftRules.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
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
      // It reads the page once typing pauses.
      await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
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
      await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
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

    it('names the existing page an optimize draft is for beside its type', async () => {
      getContentDraft.mockResolvedValue(
        draft({ sourceUrl: 'https://northwind.example/features/pipeline-forecasting/' }),
      );
      await renderPage();
      expect(typeMenu().textContent).toBe('Feature page · /features/pipeline-forecasting');
      expect(typeMenu().title).toBe('https://northwind.example/features/pipeline-forecasting/');
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

describe('the side panel', () => {
  const panel = () => container.querySelector('aside');
  const innerWidth = window.innerWidth;
  afterEach(() => {
    window.innerWidth = innerWidth;
  });

  it('starts closed on a narrow window, and the header opens it', async () => {
    getContentDraft.mockResolvedValue(draft({ sourceUrl: 'https://acme.example.com/pricing' }));
    window.innerWidth = 1024;
    await renderPage();
    expect(panel()).toBeNull();
    expect(getContentImpact).not.toHaveBeenCalled();

    await act(async () => button('Show side panel')!.click());
    expect(panel()!.getAttribute('aria-label')).toBe('Side panel');
    expect(panel()!.textContent).toContain('Impact');
    // The page the draft optimizes, over 30 days.
    expect(getContentImpact).toHaveBeenCalledWith('b1', 'https://acme.example.com/pricing', 30);
    expect(getContentResults).toHaveBeenCalledWith('b1', 'https://acme.example.com/pricing', 30);
    expect(button('Hide side panel')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens Sources only when its tab is picked, and keeps Impact as it was', async () => {
    getDraftSources.mockResolvedValue({
      data: {
        prompts: [],
        fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
        citedPages: [],
        gscQueries: [],
        brandDomains: [],
        competitorDomains: [],
      },
      choices: [],
    });
    getContentDraft.mockResolvedValue(draft({ sourceUrl: 'https://acme.example.com/pricing' }));
    window.innerWidth = 1440;
    await renderPage();
    // The editor reads the sources once on opening; the tab itself isn't there yet.
    expect(getDraftSources).toHaveBeenCalledTimes(1);
    expect(panel()!.textContent).not.toContain('pipeline forecasting');

    const tab = [...panel()!.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (el) => el.textContent === 'Sources',
    )!;
    await act(async () => {
      tab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      tab.click();
    });
    // The tab shows the editor's one read: nothing is read again.
    expect(getDraftSources).toHaveBeenCalledTimes(1);
    // The draft's H1 carries the fan-out's words.
    expect(panel()!.textContent).toContain('pipeline forecasting');
    expect(panel()!.textContent).toContain('H1');
    expect(getContentImpact).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the brief from Sources and opens it', async () => {
    getDraftSources.mockResolvedValue({
      data: {
        prompts: [],
        fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
        citedPages: [],
        gscQueries: [],
        brandDomains: [],
        competitorDomains: [],
      },
      choices: [],
    });
    rebuildDraftBrief.mockResolvedValue({
      brief: {
        goal: 'Win forecasting searches',
        audience: 'Sales leaders',
        outline: [
          {
            heading: 'How pipeline forecasting works',
            keyPoints: [],
            fanout: 'pipeline forecasting',
            platform: 'copilot-web',
          },
        ],
        keywords: ['forecast accuracy', 'pipeline'],
        origin: 'rebuild',
        builtAt: '2026-10-21T10:00:00Z',
        builtFrom: { prompts: 0, fanouts: 1, pages: 0, queries: 0 },
      },
    });
    getContentDraft.mockResolvedValue(draft({ sourceUrl: 'https://acme.example.com/pricing' }));
    window.innerWidth = 1440;
    await renderPage();

    const pick = async (name: string) => {
      const tab = [...panel()!.querySelectorAll<HTMLElement>('[role="tab"]')].find(
        (el) => el.textContent === name,
      )!;
      await act(async () => {
        tab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        tab.click();
      });
    };
    expect([...panel()!.querySelectorAll('[role="tab"]')].map((el) => el.textContent)).toEqual([
      'Impact',
      'Brief',
      'Sources',
      'Rules',
    ]);
    await pick('Sources');
    await act(async () => button('Rebuild with selection')!.click());

    expect(rebuildDraftBrief).toHaveBeenCalledWith('d1', 'b1', {
      promptIds: [],
      fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'] }],
      pages: [],
      queries: [],
      headings: [],
      length: 3000,
    });
    expect(toast.success).toHaveBeenCalledWith('Brief rebuilt from 1 source');
    const selected = panel()!.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe('Brief');
    expect(panel()!.textContent).toContain('How pipeline forecasting works');
    expect(panel()!.textContent).toContain('Win forecasting searches');

    // The rules check against the brief just rebuilt, without a reload.
    await pick('Rules');
    expect(
      [...panel()!.querySelectorAll<HTMLInputElement>('input')].map((input) => input.value),
    ).toContain('forecast accuracy, pipeline');
  });

  it('shows how many rules the page meets, and opens them from the header', async () => {
    getContentDraft.mockResolvedValue(
      draft({
        pageType: 'blog_post',
        bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams trust it in 2026.</p>',
      }),
    );
    window.innerWidth = 1024;
    await renderPage();
    expect(panel()).toBeNull();

    const chip = container.querySelector<HTMLButtonElement>('header button[aria-label^="Rules "]')!;
    const [met, total] = chip
      .getAttribute('aria-label')!
      .replace('Rules ', '')
      .split('/')
      .map(Number);
    expect(total).toBeGreaterThan(met);

    await act(async () => chip.click());
    const selected = panel()!.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe('Rules');
    expect(panel()!.textContent).toContain(`${met} of ${total} rules met`);

    // Turning a rule off for this draft saves it and takes it out of the count.
    const sentence = panel()!.querySelector<HTMLElement>(
      '[role="switch"][aria-label="Max sentence length: on or off"]',
    )!;
    await act(async () => sentence.click());
    expect(saveDraftRules).toHaveBeenCalledWith('d1', {
      set: null,
      overrides: { sentence: { on: false } },
    });
    expect(chip.getAttribute('aria-label')).toBe(`Rules ${met - 1}/${total - 1}`);
    expect(toast).toHaveBeenCalledWith('Rule updated for this draft');
  });

  it('starts open on a wide window, and remembers it closed', async () => {
    getContentDraft.mockResolvedValue(draft({ method: 'create' }));
    window.innerWidth = 1440;
    await renderPage();
    // A new page: nothing to measure yet.
    expect(panel()!.textContent).toContain('This draft is a new page, not live yet');
    expect(getContentImpact).not.toHaveBeenCalled();

    await act(async () => button('Hide side panel')!.click());
    expect(panel()).toBeNull();
    expect(localStorage.getItem('aeo:content-editor-panel')).toBe('0');

    act(() => root.unmount());
    root = createRoot(container);
    await renderPage();
    expect(panel()).toBeNull();
  });
});
