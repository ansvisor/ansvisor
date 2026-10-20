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
vi.mock('@/lib/actions/content-drafts', () => ({
  getContentDraft: (...args: unknown[]) => getContentDraft(...args),
  markContentDraftReady: (...args: unknown[]) => markContentDraftReady(...args),
  saveContentDraft: (...args: unknown[]) => saveContentDraft(...args),
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
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, and its ranges can't be measured. ProseMirror measures
// one when it scrolls the cursor into view (after inserting a block), which
// otherwise throws after the test, on a timer.
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
  saveContentDraft.mockReset().mockResolvedValue({ updatedAt: '2026-10-20T10:00:00Z' });
  brandState.activeBrandId = 'b1';
  brandState.setActiveBrand.mockReset();
  toast.mockReset();
  toast.success.mockReset();
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
