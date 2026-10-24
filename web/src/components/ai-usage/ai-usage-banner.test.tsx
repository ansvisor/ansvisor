import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import type { AiUsage } from '@/lib/billing/ai-usage';

/**
 * The banner under a page's header row (AI usage spec §4): amber from 80% of
 * the month's AI allowance, red once it is used up, nothing below.
 */

const state: { usage: AiUsage | null } = { usage: null };
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage: state.usage, refresh: () => {} }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { AiUsageBanner } = await import('./ai-usage-banner');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
  plan: 'growth',
  planName: 'Growth',
  periodStart: '2026-10-20T09:00:00.000Z',
  periodEnd: '2026-11-20T09:00:00.000Z',
  unlimited: false,
  percentUsed: 84.6,
  features: [],
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function render(role: TeamRole = 'admin') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <AiUsageBanner />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}
const links = () =>
  [...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AiUsageBanner', () => {
  it('shows nothing below 80%, on a plan without an allowance, or before a read', async () => {
    for (const read of [
      usage({ percentUsed: 79.9 }),
      usage({ unlimited: true, percentUsed: null }),
      null,
    ]) {
      state.usage = read;
      await render();
      expect(container.innerHTML).toBe('');
    }
  });

  it('warns in amber from 80%, with where to see the usage', async () => {
    state.usage = usage();
    await render();
    expect(container.textContent).toContain("You've used 84% of this month's AI limit.");
    expect(container.firstElementChild!.className).toContain('bg-amber-50');
    expect(container.firstElementChild!.className).toContain('dark:bg-amber-950/30');
    expect(links()).toEqual([['See usage', '/dashboard/settings/billing#ai-usage']]);
  });

  it('says in red until when AI stops once used up, with getting more and an own key', async () => {
    state.usage = usage({ percentUsed: 100 });
    await render();
    expect(container.textContent).toContain(
      "You've used this month's AI limit. AI features stop until Nov 20; Agent Chat on your own AI key keeps working.",
    );
    expect(container.firstElementChild!.className).toContain('bg-red-50');
    expect(links()).toEqual([
      ['Get more AI usage', '/dashboard/settings/billing'],
      ['Use your own key', '/dashboard/settings/ai-providers'],
    ]);
  });

  it('says in the free trial that starting the plan gives more, also when used up', async () => {
    state.usage = usage({ trial: true });
    await render();
    expect(container.textContent).toContain(
      "You've used 84% of the free trial's AI usage. Starting the plan gives its full monthly allowance.",
    );

    state.usage = usage({ trial: true, percentUsed: 100 });
    await render();
    expect(container.textContent).toContain(
      "You've used the free trial's AI usage. Starting the plan gives its full monthly allowance;",
    );
    expect(links()).toEqual([
      ['Start your plan', '/dashboard/settings/billing'],
      ['Use your own key', '/dashboard/settings/ai-providers'],
    ]);
    expect(container.textContent).not.toContain('Get more AI usage');

    // A member who isn't an admin can't start it: asked to ask one, no links.
    await render('analyst');
    expect(container.textContent).toContain('ask an admin of your workspace');
    expect(links()).toEqual([]);
  });

  it('leaves Get more out on Enterprise, and tells other members to ask an admin', async () => {
    state.usage = usage({ plan: 'enterprise', planName: 'Enterprise', percentUsed: 100 });
    await render();
    expect(links()).toEqual([['Use your own key', '/dashboard/settings/ai-providers']]);

    state.usage = usage({ percentUsed: 100, periodEnd: null });
    await render('analyst');
    expect(container.textContent).toBe(
      "You've used this month's AI limit. AI features stop until it resets; Agent Chat on your own AI key keeps working. To get more AI usage or use your own key, ask an admin of your workspace.",
    );
    expect(links()).toEqual([]);
  });
});
