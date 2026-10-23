import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import type { AiUsage, UsageLimits } from '@/lib/billing/ai-usage';
import { readAiUsage, readUsageLimits } from '@/lib/billing/ai-usage-client';

/**
 * The header meter (AI usage spec §3.1, §4): the share of the month's AI
 * allowance on every page, read once for all of them, and its popover.
 */

const env = { cloud: true, pathname: '/dashboard/insights' };
vi.mock('@/config/plans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/plans')>()),
  isCloud: () => env.cloud,
}));
vi.mock('next/navigation', () => ({ usePathname: () => env.pathname }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    className,
    onClick,
    children,
  }: {
    href: string;
    className?: string;
    onClick?: () => void;
    children: ReactNode;
  }) => (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: { activeBrandId: string | null }) => unknown) =>
    selector({ activeBrandId: 'b1' }),
}));
vi.mock('@/lib/billing/ai-usage-client', () => ({
  readAiUsage: vi.fn(),
  readUsageLimits: vi.fn(),
}));

const { AiUsageProvider, AI_USAGE_STALE_MS } =
  await import('@/components/providers/ai-usage-provider');
const { AiUsageMeter, HeaderWithAiUsage } = await import('./ai-usage-meter');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
  plan: 'growth',
  planName: 'Growth',
  periodStart: '2026-10-20T09:00:00.000Z',
  periodEnd: '2026-11-20T09:00:00.000Z',
  unlimited: false,
  percentUsed: 21.4,
  features: [
    { feature: 'improve', percent: 4 },
    { feature: 'content', percent: 17.2 },
    { feature: 'action_center', percent: 0.2 },
  ],
  ...over,
});
const limits: UsageLimits = {
  auditPages: { used: 42, limit: 500 },
  promptLocations: { used: 1148, limit: 2000 },
};

let container: HTMLDivElement;
let root: Root;

async function render(role: TeamRole = 'admin', children: ReactNode = <AiUsageMeter />) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <AiUsageProvider>{children}</AiUsageProvider>
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}
async function remount(role: TeamRole = 'admin') {
  act(() => root.unmount());
  root = createRoot(container);
  await render(role);
}

const trigger = () => container.querySelector<HTMLButtonElement>('button');
const popup = () => document.querySelector<HTMLElement>('[data-slot="popover-content"]');
const links = () =>
  [...popup()!.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
async function open() {
  await act(async () => trigger()!.click());
  await act(async () => {});
}

beforeEach(() => {
  env.cloud = true;
  env.pathname = '/dashboard/insights';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(readAiUsage).mockReset().mockResolvedValue(usage());
  vi.mocked(readUsageLimits).mockReset().mockResolvedValue(limits);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('AiUsageMeter', () => {
  it('shows the month’s share with a bar, named with what it shows', async () => {
    await render();
    const button = trigger()!;
    expect(button.textContent).toBe('AI21%');
    expect(button.getAttribute('aria-label')).toBe('AI 21% used this month');
    expect(button.className).toContain('text-foreground');
    expect(button.querySelector<HTMLElement>('[style]')!.style.width).toBe('21.4%');
  });

  it('keeps its room while the first read runs, from a phone’s width up', async () => {
    vi.mocked(readAiUsage).mockReturnValue(new Promise(() => {}));
    await render();
    expect(trigger()).toBeNull();
    const box = container.querySelector('span[aria-hidden]')!;
    expect(box.className).toContain('hidden');
    expect(box.className).toContain('sm:inline-block');
  });

  it('shows nothing on a plan without an allowance, without an active plan, or self-hosted', async () => {
    vi.mocked(readAiUsage).mockResolvedValue(usage({ unlimited: true, percentUsed: null }));
    await render();
    expect(container.innerHTML).toBe('');

    vi.mocked(readAiUsage).mockResolvedValue(null);
    await remount();
    expect(container.innerHTML).toBe('');

    env.cloud = false;
    vi.mocked(readAiUsage).mockClear();
    await remount();
    expect(container.innerHTML).toBe('');
    expect(readAiUsage).not.toHaveBeenCalled();
  });

  it('turns amber from 80% and red once used up, and says so in its name', async () => {
    vi.mocked(readAiUsage).mockResolvedValue(usage({ percentUsed: 84 }));
    await render();
    expect(trigger()!.className).toContain('text-amber-700');
    expect(trigger()!.getAttribute('aria-label')).toBe(
      'AI 84% used this month, close to the limit',
    );

    vi.mocked(readAiUsage).mockResolvedValue(usage({ percentUsed: 100 }));
    await remount();
    expect(trigger()!.className).toContain('text-red-700');
    expect(trigger()!.getAttribute('aria-label')).toBe(
      'AI 100% used this month, the limit is reached',
    );
    await open();
    expect(popup()!.textContent).toContain(
      'Used up. AI features stop until Nov 20; Agent Chat on your own AI key keeps working.',
    );
  });

  it('opens what used it, what isn’t counted, the other limits and where to get more', async () => {
    await render();
    await open();
    const text = popup()!.textContent;
    expect(text).toContain('Shared by every seat · resets Nov 20');
    expect(popup()!.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(popup()!.getAttribute('aria-labelledby')!)!.textContent).toBe(
      'AI usage this month · Growth plan',
    );
    const rows = [...popup()!.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      'Improve suggestions4%',
      'Content Editor (briefs, Content Agent)17%',
      'Action Center task writing<1%',
      'Agent Chat, on your own AI keyNot counted',
      'Site Audit pages42 of 500',
      'Prompt locations1,148 of 2,000',
    ]);
    expect(readUsageLimits).toHaveBeenCalledWith('b1');
    // Opening reads the usage again.
    expect(readAiUsage).toHaveBeenCalledTimes(2);
    expect(links()).toEqual([
      ['Get more AI usage', '/dashboard/settings/billing'],
      ['Use your own key', '/dashboard/settings/ai-providers'],
      ['See details', '/dashboard/settings/billing#ai-usage'],
    ]);
  });

  it('closes when one of its links is followed', async () => {
    await render();
    await open();
    await act(async () => popup()!.querySelector('a')!.click());
    await act(async () => {});
    expect(trigger()!.getAttribute('aria-expanded')).toBe('false');
  });

  it('makes Get more the primary button from 80%, and leaves it out on Enterprise', async () => {
    await render();
    await open();
    expect(popup()!.querySelector('a')!.className).not.toContain('bg-primary');

    vi.mocked(readAiUsage).mockResolvedValue(usage({ percentUsed: 84 }));
    await remount();
    await open();
    const getMore = popup()!.querySelector('a')!;
    expect(getMore.textContent).toBe('Get more AI usage');
    expect(getMore.className).toContain('bg-primary');

    vi.mocked(readAiUsage).mockResolvedValue(usage({ plan: 'enterprise', planName: 'Enterprise' }));
    await remount();
    await open();
    expect(popup()!.textContent).not.toContain('Get more AI usage');
  });

  it('tells a member who isn’t an admin to ask one, instead of the admin’s links', async () => {
    await render('manager');
    await open();
    expect(popup()!.textContent).toContain(
      'To get more AI usage or use your own key, ask an admin of your workspace.',
    );
    expect(links()).toEqual([['See details', '/dashboard/settings/billing#ai-usage']]);
  });

  it('leaves the other limits out when none has a cap', async () => {
    vi.mocked(readUsageLimits).mockResolvedValue({ auditPages: null, promptLocations: null });
    await render();
    await open();
    expect(popup()!.textContent).not.toContain('Other limits this month');
  });

  it('keeps the limits it shows while it reads them again, and only the latest read lands', async () => {
    const reads: ((value: UsageLimits) => void)[] = [];
    vi.mocked(readUsageLimits).mockImplementation(
      () => new Promise<UsageLimits>((resolve) => reads.push(resolve)),
    );
    await render();
    await open();
    expect(popup()!.textContent).toContain('Loading');
    await act(async () => reads[0](limits));
    expect(popup()!.textContent).toContain('42 of 500');

    // Closed and opened twice: the first of the two reads lands last.
    await act(async () => trigger()!.click());
    await open();
    await act(async () => trigger()!.click());
    await open();
    expect(popup()!.textContent).toContain('42 of 500');
    await act(async () => reads[2]({ ...limits, auditPages: { used: 44, limit: 500 } }));
    await act(async () => reads[1]({ ...limits, auditPages: { used: 43, limit: 500 } }));
    expect(popup()!.textContent).toContain('44 of 500');
  });
});

describe('HeaderWithAiUsage', () => {
  it('puts the meter after the page’s header row, under it on the right on a phone', async () => {
    await render(
      'admin',
      <HeaderWithAiUsage>
        <h1>Mentions</h1>
      </HeaderWithAiUsage>,
    );
    const row = container.firstElementChild!;
    expect(row.firstElementChild!.textContent).toBe('Mentions');
    expect(row.lastElementChild).toBe(trigger());
    expect(trigger()!.className).toContain('self-end');
    expect(row.className).toContain('sm:flex-row');
  });
});

describe('AiUsageProvider', () => {
  it('reads once for every page, again on a page change once a minute old', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await render();
    expect(readAiUsage).toHaveBeenCalledTimes(1);

    env.pathname = '/dashboard/prompts';
    await render();
    expect(readAiUsage).toHaveBeenCalledTimes(1);

    now += AI_USAGE_STALE_MS;
    env.pathname = '/dashboard/mentions';
    await render();
    expect(readAiUsage).toHaveBeenCalledTimes(2);
  });

  it('reads again on a return to the tab once a minute old, keeping the last read on a failure', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await render();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(readAiUsage).toHaveBeenCalledTimes(1);

    now += AI_USAGE_STALE_MS;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(readAiUsage).mockRejectedValue(new Error('offline'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => {});
    expect(readAiUsage).toHaveBeenCalledTimes(2);
    expect(trigger()!.textContent).toBe('AI21%');
  });

  it('reads again when the tab becomes visible, not while it is hidden', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await render();
    now += AI_USAGE_STALE_MS;
    const visibility = vi.spyOn(document, 'visibilityState', 'get');

    visibility.mockReturnValue('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(readAiUsage).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    vi.mocked(readAiUsage).mockResolvedValue(usage({ percentUsed: 30 }));
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {});
    expect(readAiUsage).toHaveBeenCalledTimes(2);
    expect(trigger()!.textContent).toBe('AI30%');
  });
});
