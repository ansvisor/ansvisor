import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import type { AiUsage, UsageLimits } from '@/lib/billing/ai-usage';
import { readAiUsage, readDraftAiUsage, readUsageLimits } from '@/lib/billing/ai-usage-client';

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

const toast = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/billing/ai-usage-client', () => ({
  readAiUsage: vi.fn(),
  readUsageLimits: vi.fn(),
  readDraftAiUsage: vi.fn(),
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
  toast.warning.mockReset();
  toast.error.mockReset();
  localStorage.clear();
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

describe('AiUsageMeter in the Content Editor', () => {
  const page = () =>
    [...popup()!.querySelectorAll('p')].find((p) => p.textContent?.startsWith('This page'));

  it('is the header’s button height, the percent alone narrower than 1280px, named on hover', async () => {
    await render('admin', <AiUsageMeter compact draftId="d1" />);
    expect(trigger()!.className).toContain('h-7');
    const [label, bar] = trigger()!.querySelectorAll('span');
    expect(label.className).toContain('hidden xl:inline');
    expect(bar.className).toContain('hidden xl:block');
    expect(trigger()!.title).toBe('AI 21% used this month');
  });

  it('adds the page’s share of the month, read on each opening', async () => {
    let answer: (value: number | null) => void = () => {};
    vi.mocked(readDraftAiUsage).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render('admin', <AiUsageMeter compact draftId="d1" />);
    await open();
    expect(readDraftAiUsage).toHaveBeenCalledWith('d1');
    expect(page()!.textContent).toBe('This page this monthLoading...');
    await act(async () => answer(3.7));
    expect(page()!.textContent).toBe('This page this month3%');

    // A sliver reads as under 1%; one it can't read is left out.
    await act(async () => trigger()!.click());
    vi.mocked(readDraftAiUsage).mockResolvedValue(0.1);
    await open();
    expect(page()!.textContent).toBe('This page this month<1%');
    await act(async () => trigger()!.click());
    vi.mocked(readDraftAiUsage).mockResolvedValue(null);
    await open();
    expect(page()).toBeUndefined();
  });

  it('has no page line outside the editor', async () => {
    await render();
    await open();
    expect(page()).toBeUndefined();
    expect(readDraftAiUsage).not.toHaveBeenCalled();
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

  it('follows the row with the banner from 80%', async () => {
    vi.mocked(readAiUsage).mockResolvedValue(usage({ percentUsed: 84 }));
    await render(
      'admin',
      <HeaderWithAiUsage>
        <h1>Mentions</h1>
      </HeaderWithAiUsage>,
    );
    expect(container.children).toHaveLength(2);
    expect(container.lastElementChild!.textContent).toContain(
      "You've used 84% of this month's AI limit.",
    );
  });
});

describe('AiUsageProvider', () => {
  it('toasts reaching 80% once a period, not again on later reads, in a new tab or once used up', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(readAiUsage).mockImplementation(async () => usage({ percentUsed: 84 }));
    await render();
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(
      "You've used 84% of this month's AI limit.",
    );
    expect(localStorage.getItem('aeo:ai-usage-toast')).toBe('2026-10-20T09:00:00.000Z:growth');

    const reread = async (over: Partial<AiUsage>) => {
      now += AI_USAGE_STALE_MS;
      vi.mocked(readAiUsage).mockImplementation(async () => usage(over));
      await act(async () => window.dispatchEvent(new Event('focus')));
      await act(async () => {});
    };
    await reread({ percentUsed: 90 });
    await remount();
    // Used up: the red banner says it, no toast.
    await reread({ percentUsed: 100 });
    expect(readAiUsage).toHaveBeenCalledTimes(4);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();

    // A plan changed within the period starts over.
    await reread({ plan: 'enterprise', planName: 'Enterprise', percentUsed: 81 });
    expect(toast.warning).toHaveBeenCalledTimes(2);
  });

  it('toasts nothing below 80%, on a plan without an allowance, or self-hosted', async () => {
    vi.mocked(readAiUsage).mockResolvedValue(usage({ percentUsed: 79.9 }));
    await render();
    vi.mocked(readAiUsage).mockResolvedValue(usage({ unlimited: true, percentUsed: null }));
    await remount();
    env.cloud = false;
    await remount();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('toasts once in a tab when the browser’s storage can’t be used', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    // Each read a new answer, as the server's: the toast is weighed again on each.
    vi.mocked(readAiUsage).mockImplementation(async () => usage({ percentUsed: 84 }));
    await render();
    for (let read = 0; read < 2; read++) {
      now += AI_USAGE_STALE_MS;
      await act(async () => window.dispatchEvent(new Event('focus')));
      await act(async () => {});
    }
    expect(readAiUsage).toHaveBeenCalledTimes(3);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

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
