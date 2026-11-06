import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentDraft } from '@/lib/content/drafts';
import { ContentEditorSurface } from './_editor-surface';
import ContentEditorPage from './page';

// The editor itself as a stub: page.test.tsx has the real one, embedded too.
const editorProps = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock('./_draft-editor', () => ({
  DraftEditor: (props: Record<string, unknown>) => {
    editorProps.value = props;
    return <div data-slot="draft-editor" />;
  },
}));
const writingProps = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock('./_agent-writing', () => ({
  AgentWriting: (props: Record<string, unknown>) => {
    writingProps.value = props;
    return <div data-slot="agent-writing" />;
  },
}));
const getContentDraft = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/content-drafts', () => ({ getContentDraft }));
const writeLastDraft = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/last-draft', () => ({ writeLastDraft }));
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage: null, refresh: vi.fn() }),
}));
const brandState = vi.hoisted(() => ({
  activeBrandId: 'b1' as string | null,
  brands: [{ id: 'b1' }, { id: 'b2' }],
  setActiveBrand: vi.fn(),
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: typeof brandState) => unknown) => selector(brandState),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ draftId: 'd1' }) }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const draft = (over: Partial<ContentDraft> = {}) =>
  ({
    id: 'd1',
    brandId: 'b1',
    title: 'Pipeline forecasting',
    agentState: null,
    ...over,
  }) as ContentDraft;

let container: HTMLDivElement;
let root: Root;

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    );
  });
}

const libraryLink = () => container.querySelector('a[href="/dashboard/content/library"]');
const closeButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Close');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  editorProps.value = null;
  writingProps.value = null;
  getContentDraft.mockReset();
  writeLastDraft.mockReset();
  brandState.activeBrandId = 'b1';
  brandState.setActiveBrand.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the editor page', () => {
  it('shows the surface on the draft its address names, in the full-height frame it had', async () => {
    getContentDraft.mockResolvedValue(draft());
    await render(<ContentEditorPage />);

    expect(getContentDraft).toHaveBeenCalledWith('d1');
    const frame = container.firstElementChild!;
    expect(frame.className).toBe('-m-6 flex h-[calc(100vh-4rem)] flex-col md:h-screen');
    // The surface fills the frame; the editor opens in it as the editor's own page.
    const surface = frame.firstElementChild!;
    expect(frame.children).toHaveLength(1);
    expect(surface.className).toBe('flex h-full min-h-0 flex-col');
    expect(surface.querySelector('[data-slot="draft-editor"]')).not.toBeNull();
    expect(editorProps.value).toMatchObject({ draft: { id: 'd1' }, embedded: false });
    expect(editorProps.value!.onClose).toBeUndefined();
    expect(writeLastDraft).toHaveBeenCalledWith('b1', 'd1');
  });

  it('keeps the Library link on a draft that isn’t there', async () => {
    getContentDraft.mockResolvedValue(null);
    await render(<ContentEditorPage />);

    expect(container.textContent).toContain(
      "This draft doesn't exist, or it belongs to another workspace.",
    );
    expect(libraryLink()!.textContent).toBe('Back to the Library');
    expect(closeButton()).toBeUndefined();
  });
});

describe('the surface embedded (Open here, CHAT-25 §4)', () => {
  it('fills the box it is put in and hands the editor embedded and Close', async () => {
    const onClose = vi.fn();
    getContentDraft.mockResolvedValue(draft());
    await render(
      <div data-slot="pane">
        <ContentEditorSurface draftId="d1" embedded onClose={onClose} />
      </div>,
    );

    const surface = container.querySelector('[data-slot="pane"]')!.firstElementChild!;
    expect(surface.className).toBe('flex h-full min-h-0 flex-col');
    expect(editorProps.value).toMatchObject({ draft: { id: 'd1' }, embedded: true, onClose });
  });

  it('hands Close to the agent’s screen while it writes the page', async () => {
    const onClose = vi.fn();
    getContentDraft.mockResolvedValue(draft({ agentState: 'writing' }));
    await render(<ContentEditorSurface draftId="d1" embedded onClose={onClose} />);

    expect(container.querySelector('[data-slot="agent-writing"]')).not.toBeNull();
    expect(writingProps.value).toMatchObject({ draftId: 'd1', embedded: true, onClose });
  });

  it('still follows the draft’s brand in the sidebar and remembers it as the last draft', async () => {
    getContentDraft.mockResolvedValue(draft({ brandId: 'b2' }));
    await render(<ContentEditorSurface draftId="d1" embedded onClose={vi.fn()} />);

    expect(writeLastDraft).toHaveBeenCalledWith('b2', 'd1');
    expect(brandState.setActiveBrand).toHaveBeenCalledWith('b2');
  });

  it('offers Close, not the Library, on a draft that isn’t there', async () => {
    const onClose = vi.fn();
    getContentDraft.mockResolvedValue(null);
    await render(<ContentEditorSurface draftId="d1" embedded onClose={onClose} />);

    expect(libraryLink()).toBeNull();
    await act(async () => closeButton()!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Try again beside Close when the draft couldn’t be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getContentDraft.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(draft());
    try {
      await render(<ContentEditorSurface draftId="d1" embedded onClose={vi.fn()} />);
      expect(container.textContent).toContain("Couldn't open this draft.");
      expect(closeButton()).toBeDefined();

      const retry = [...container.querySelectorAll('button')].find(
        (b) => b.textContent === 'Try again',
      )!;
      await act(async () => retry.click());
      expect(getContentDraft).toHaveBeenCalledTimes(2);
      expect(editorProps.value).toMatchObject({ embedded: true });
    } finally {
      vi.mocked(console.error).mockRestore();
    }
  });
});
