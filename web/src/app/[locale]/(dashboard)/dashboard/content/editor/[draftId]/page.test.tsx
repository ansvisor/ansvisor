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
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

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
  saveContentDraft.mockReset();
  brandState.activeBrandId = 'b1';
  brandState.setActiveBrand.mockReset();
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
