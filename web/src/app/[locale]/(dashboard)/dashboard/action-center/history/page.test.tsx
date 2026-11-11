import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * History's range: the Actions list starts on 30 days, the scorecard on 90,
 * since an action's final reading comes 30 days after it closed (learning
 * B1). A range in the URL, or one picked, holds in either view.
 */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: { getActiveBrand: () => { id: string } }) => unknown) =>
    selector({ getActiveBrand: () => ({ id: 'b1' }) }),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/action-center/action-center-tabs', () => ({
  ActionCenterTabs: () => null,
}));
vi.mock('@/components/action-center/history-table', () => ({ HistoryTable: () => null }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/action-center/history-drawer', () => ({ HistoryDrawer: () => null }));
vi.mock('@/components/action-center/scorecard-table', () => ({ ScorecardTable: () => null }));

const { getActionHistory, getActionScorecard } = vi.hoisted(() => ({
  getActionHistory: vi.fn(),
  getActionScorecard: vi.fn(),
}));
vi.mock('@/lib/actions/action-history', () => ({ getActionHistory }));
vi.mock('@/lib/actions/action-scorecard', () => ({ getActionScorecard }));

import ActionCenterHistoryPage from './page';
import { SimpleNavProvider } from '@/components/providers/simple-nav-provider';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getActionHistory.mockResolvedValue([{ id: 'a1', status: 'completed', outcome: 'improved' }]);
  getActionScorecard.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  getActionHistory.mockReset();
  getActionScorecard.mockReset();
  window.history.replaceState(null, '', '/');
});

async function renderAt(url: string, simpleNav = false) {
  window.history.replaceState(null, '', url);
  await act(async () => {
    root.render(
      <SimpleNavProvider enabled={simpleNav}>
        <ActionCenterHistoryPage />
      </SimpleNavProvider>,
    );
  });
}

/** The days back the latest call to `read` asked from. */
function daysAsked(read: typeof getActionHistory): number {
  const { from } = read.mock.calls.at(-1)?.[1] as { from: string };
  return Math.round((Date.now() - Date.parse(from)) / 86_400_000);
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`no ${text} button`);
  return found;
}

describe('History range', () => {
  it('starts the Actions list on 30 days', async () => {
    await renderAt('/');
    expect(daysAsked(getActionHistory)).toBe(30);
    expect(getActionScorecard).not.toHaveBeenCalled();
  });

  it('starts the scorecard on 90 days when the URL names no range', async () => {
    await renderAt('/?view=scorecard');
    expect(daysAsked(getActionScorecard)).toBe(90);
    expect(button('range.90d').className).toContain('bg-primary');
  });

  it('keeps a range the URL names', async () => {
    await renderAt('/?view=scorecard&range=30d');
    expect(daysAsked(getActionScorecard)).toBe(30);
  });

  it('moves to 90 days on switching to the scorecard, unless a range was picked', async () => {
    await renderAt('/');
    await act(async () => button('view.scorecard').click());
    expect(daysAsked(getActionScorecard)).toBe(90);
    // The URL is written after a pause; the view's own default stays out of it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(window.location.search).toBe('?view=scorecard');

    await act(async () => button('range.7d').click());
    await act(async () => button('view.actions').click());
    expect(daysAsked(getActionHistory)).toBe(7);
  });
});

describe('History scorecard by play (AC plan P-4)', () => {
  it('reads the scorecard by kind, or by play once picked, and keeps it in the URL', async () => {
    await renderAt('/?view=scorecard');
    expect(getActionScorecard.mock.calls.at(-1)?.[1]).toMatchObject({ by: 'kind' });
    expect(button('scorecard.by.kind').getAttribute('aria-pressed')).toBe('true');

    await act(async () => button('scorecard.by.play').click());
    expect(getActionScorecard.mock.calls.at(-1)?.[1]).toMatchObject({ by: 'play' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(window.location.search).toBe('?view=scorecard&by=play');
  });

  it('opens on the play the URL names, and offers no grouping on the Actions list', async () => {
    await renderAt('/?view=scorecard&by=play');
    expect(getActionScorecard.mock.calls.at(-1)?.[1]).toMatchObject({ by: 'play' });
    await act(async () => button('view.actions').click());
    expect(() => button('scorecard.by.play')).toThrow();
  });
});

describe('History’s views and KPIs', () => {
  const views = () =>
    [...container.querySelectorAll('.inline-flex')]
      .find((group) => group.textContent?.startsWith('view.actions'))
      ?.querySelectorAll('button, a');

  it('switch between Actions and Scorecard only, without SIMPLE_NAV', async () => {
    await renderAt('/');
    expect([...views()!].map((v) => v.textContent)).toEqual(['view.actions', 'view.scorecard']);
    expect(container.querySelector('a[href="/dashboard/action-center/kpis"]')).toBeNull();
  });

  it('add KPIs, a link to its page, with SIMPLE_NAV on, and still switch in place', async () => {
    await renderAt('/', true);
    const group = container.querySelector('[role="group"][aria-label="view.label"]')!;
    expect([...group.querySelectorAll('button, a')].map((v) => v.textContent)).toEqual([
      'view.actions',
      'view.scorecard',
      'view.kpis',
    ]);
    expect(group.querySelector('a')?.getAttribute('href')).toBe('/dashboard/action-center/kpis');
    await act(async () => button('view.scorecard').click());
    expect(daysAsked(getActionScorecard)).toBe(90);
    // One switch on the page.
    const named = (text: string) =>
      [...container.querySelectorAll('button')].filter((b) => b.textContent === text);
    expect(named('view.actions')).toHaveLength(1);
    expect(named('view.scorecard')).toHaveLength(1);
  });

  it('keep KPIs in reach with SIMPLE_NAV on when there is no history yet', async () => {
    getActionHistory.mockResolvedValue([]);
    await renderAt('/', true);
    expect(container.textContent).toContain('empty.title');
    expect(container.querySelector('a[href="/dashboard/action-center/kpis"]')).not.toBeNull();
  });
});
