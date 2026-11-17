import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuggestionSourceStates } from '@/lib/actions/integrations';

/**
 * Prompt Suggestions while it loads: the data-sources panel is in its place
 * from the first frame (Ansvisor Cloud), each source's status waiting in a
 * line as tall as Connect's button, so neither the read of the sources nor
 * the suggestions' own read moves anything. Self-hosted, which sources show
 * depends on the read, so the panel waits for it, as before.
 */

const env = vi.hoisted(() => ({ cloud: true }));
vi.mock('@/config/plans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/plans')>()),
  isCloud: () => env.cloud,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const integrations = vi.hoisted(() => ({ getSuggestionSourceStates: vi.fn() }));
vi.mock('@/lib/actions/integrations', () => integrations);
// The list has tests of its own; here, where it sits and when it can load.
const card = vi.hoisted(() => ({ mounts: 0 }));
vi.mock('./_suggestions-card', async () => {
  const { useEffect } = await import('react');
  return {
    SuggestionsCard: () => {
      useEffect(() => {
        card.mounts += 1;
      }, []);
      return <div data-testid="suggestions-card">Prompt Suggestions</div>;
    },
  };
});

const { SuggestionsTab } = await import('./_suggestions-tab');
const { DataSourcesPanel } = await import('./_data-sources-panel');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const source = (over: Partial<SuggestionSourceStates['gsc']> = {}) => ({
  configured: true,
  connected: true,
  mapped: true,
  firstDataAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const allConnected: SuggestionSourceStates = {
  gsc: source(),
  ga: source(),
  dataForSeo: { configured: true },
} as SuggestionSourceStates;

let container: HTMLDivElement;
let root: Root;

const panel = () => container.querySelector<HTMLElement>('.rounded-lg.border.bg-muted\\/20');
const statuses = () =>
  [...container.querySelectorAll<HTMLElement>('[data-source-status]')].map((el) => ({
    state: el.dataset.sourceStatus,
    text: el.textContent,
    tall: el.className.includes('min-h-8'),
  }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  env.cloud = true;
  card.mounts = 0;
  localStorage.clear();
  integrations.getSuggestionSourceStates.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Prompt Suggestions while it loads', () => {
  it('shows the panel in place, statuses waiting, before the sources or the suggestions are read', async () => {
    const read = deferred<SuggestionSourceStates>();
    integrations.getSuggestionSourceStates.mockReturnValue(read.promise);
    await act(async () => root.render(<SuggestionsTab brandId="b1" />));

    const first = panel();
    expect(first).not.toBeNull();
    expect(first!.textContent).toContain('Enable smarter prompt suggestions');
    expect(first!.textContent).toContain('Connect your data sources');
    expect(statuses()).toEqual([
      { state: 'loading', text: '', tall: true },
      { state: 'loading', text: '', tall: true },
      { state: 'loading', text: '', tall: true },
    ]);
    // The list sits under it, already mounted, its read free to start.
    const list = container.querySelector('[data-testid="suggestions-card"]')!;
    expect(first!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.mounts).toBe(1);

    await act(async () => read.resolve(allConnected));
    // The same panel, its lines filled in place: nothing above the list came or went.
    expect(panel()).toBe(first);
    expect(statuses()).toEqual([
      { state: 'feeding', text: 'Connected', tall: true },
      { state: 'feeding', text: 'Connected', tall: true },
      { state: 'feeding', text: 'Enabled', tall: true },
    ]);
    expect(card.mounts).toBe(1);
  });

  it('gives Connect the same line as a status, so a source to connect moves nothing either', async () => {
    integrations.getSuggestionSourceStates.mockResolvedValue({
      ...allConnected,
      gsc: source({ connected: false }),
      ga: source({ mapped: false }),
    });
    await act(async () => root.render(<SuggestionsTab brandId="b1" />));
    expect(statuses()).toEqual([
      { state: 'not_connected', text: 'Connect', tall: true },
      { state: 'connected_unmapped', text: 'Map property', tall: true },
      { state: 'feeding', text: 'Enabled', tall: true },
    ]);
  });

  it('keeps the panel where it is, without statuses, when the read fails', async () => {
    const read = deferred<SuggestionSourceStates>();
    integrations.getSuggestionSourceStates.mockReturnValue(
      read.promise.then(() => Promise.reject(new Error('timeout'))),
    );
    await act(async () => root.render(<SuggestionsTab brandId="b1" />));
    const first = panel();
    await act(async () => read.resolve(allConnected));
    expect(panel()).toBe(first);
    expect(statuses().map((s) => s.state)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('shows nothing when dismissed, from the first frame', async () => {
    localStorage.setItem('aeo:suggestion-sources-dismissed', '1');
    integrations.getSuggestionSourceStates.mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(<SuggestionsTab brandId="b1" />));
    expect(panel()).toBeNull();
  });
});

describe('DataSourcesPanel self-hosted', () => {
  it('waits for the read, which says which sources this install has', async () => {
    env.cloud = false;
    await act(async () => root.render(<DataSourcesPanel states={undefined} />));
    expect(panel()).toBeNull();

    await act(async () =>
      root.render(
        <DataSourcesPanel
          states={
            {
              gsc: source({ configured: false }),
              ga: source({ configured: false }),
              dataForSeo: { configured: false },
            } as SuggestionSourceStates
          }
        />,
      ),
    );
    expect(panel()).toBeNull();

    await act(async () => root.render(<DataSourcesPanel states={null} />));
    expect(panel()).toBeNull();
  });
});
