import { act, isValidElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';

/**
 * Action Center › Today (SIMPLE_NAV): not found while the simplified layout
 * is off; with it on, the Action Center's header and tabs, and Today's parts,
 * each saying what it will show until it is built.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock('@/components/action-center/action-center-tabs', () => ({
  ActionCenterTabs: () => <nav data-testid="tabs" />,
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: { activeBrandId: string }) => unknown) =>
    selector({ activeBrandId: 'b1' }),
}));
let canManage = true;
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ canManage }),
}));
const { getTaskReviewCount } = vi.hoisted(() => ({ getTaskReviewCount: vi.fn(async () => 2) }));
vi.mock('@/lib/actions/action-task-reviews', () => ({ getTaskReviewCount }));

const { default: ActionCenterTodayPage } = await import('./page');
const { TodayPage } = await import('@/components/action-center/today-page');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  canManage = true;
});

async function draw() {
  const page = ActionCenterTodayPage();
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {page}
      </NextIntlClientProvider>,
    );
  });
}

describe('Action Center › Today', () => {
  it('is not found while SIMPLE_NAV is off, as production leaves it', () => {
    vi.stubEnv('SIMPLE_NAV', undefined);
    expect(() => ActionCenterTodayPage()).toThrow('NEXT_NOT_FOUND');
    vi.stubEnv('SIMPLE_NAV', 'false');
    expect(() => ActionCenterTodayPage()).toThrow('NEXT_NOT_FOUND');
  });

  it('shows Today with SIMPLE_NAV on', () => {
    vi.stubEnv('SIMPLE_NAV', 'true');
    const page = ActionCenterTodayPage();
    expect(isValidElement(page) && page.type).toBe(TodayPage);
  });

  it('draws the Action Center’s header and tabs, the preview note and Today’s five parts', async () => {
    vi.stubEnv('SIMPLE_NAV', 'true');
    await draw();
    expect(container.querySelector('h1')?.textContent).toBe('Action Center');
    expect(container.querySelector('[data-testid="tabs"]')).not.toBeNull();
    expect(container.querySelector('[role="note"]')?.textContent).toContain('Today is in preview');
    const parts = [...container.querySelectorAll('section h2')].map((h) => h.textContent);
    expect(parts).toEqual([
      'Since yesterday',
      "Today's focus",
      'Waiting for you',
      'Finish setting up',
      'Where you stand',
    ]);
    // Each part is named for screen readers by its title.
    for (const section of container.querySelectorAll('section')) {
      const id = section.getAttribute('aria-labelledby');
      expect(id && container.querySelector(`[id="${id}"]`)).toBeTruthy();
    }
    const link = (text: string) =>
      [...container.querySelectorAll('a')].find((a) => a.textContent === text);
    expect(link('All signals')?.getAttribute('href')).toBe('/dashboard/action-center/signals');
    expect(link('All actions')?.getAttribute('href')).toBe('/dashboard/action-center/actions');
  });

  it('links admins and managers to Needs review from Waiting for you, with how many wait', async () => {
    vi.stubEnv('SIMPLE_NAV', 'true');
    await draw();
    const review = container.querySelector('[data-action="today.needsReview"]');
    expect(review?.getAttribute('href')).toBe('/dashboard/action-center/review');
    expect(review?.textContent).toBe('Tasks waiting for review2');
    expect(getTaskReviewCount).toHaveBeenCalledWith('b1');
  });

  it('shows anyone else no Needs review link, and reads no count', async () => {
    vi.stubEnv('SIMPLE_NAV', 'true');
    canManage = false;
    await draw();
    expect(container.querySelector('[data-action="today.needsReview"]')).toBeNull();
    expect(getTaskReviewCount).not.toHaveBeenCalled();
  });
});
