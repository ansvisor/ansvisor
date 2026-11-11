import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * The Action Center's tabs: Needs review (AC-010) for admins and managers,
 * with its count; and with the simplified layout on (SIMPLE_NAV), Today,
 * Actions, Signals, Agents and History.
 */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let pathname = '/dashboard/action-center/actions';
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => pathname,
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: { activeBrandId: string }) => unknown) =>
    selector({ activeBrandId: 'b1' }),
}));
let canManage = true;
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ role: canManage ? 'admin' : 'analyst', canManage, canAdmin: canManage }),
}));
const { getNewSignalCount, getMyOpenActionCount } = vi.hoisted(() => ({
  getNewSignalCount: vi.fn(async () => 0),
  getMyOpenActionCount: vi.fn(async () => 0),
}));
vi.mock('@/lib/actions/signals', () => ({ getNewSignalCount }));
vi.mock('@/lib/actions/action-center-counts', () => ({ getMyOpenActionCount }));
let planHasAgents = true;
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({ canUse: (feature: string) => feature !== 'ai_agent' || planHasAgents }),
}));
const { getTaskReviewCount } = vi.hoisted(() => ({ getTaskReviewCount: vi.fn() }));
vi.mock('@/lib/actions/action-task-reviews', () => ({ getTaskReviewCount }));
vi.mock('./first-run-note', () => ({ FirstRunNote: () => null }));

import { ActionCenterTabs } from './action-center-tabs';
import { SimpleNavProvider } from '@/components/providers/simple-nav-provider';
import { ChatAgenticProvider } from '@/components/providers/chat-agentic-provider';
import { MenuAccessProvider } from '@/components/providers/menu-access-provider';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getTaskReviewCount.mockResolvedValue(3);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  canManage = true;
  planHasAgents = true;
  pathname = '/dashboard/action-center/actions';
});

async function render({
  simpleNav = false,
  chatAgentic = false,
  hidden = [] as string[],
}: { simpleNav?: boolean; chatAgentic?: boolean; hidden?: string[] } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SimpleNavProvider enabled={simpleNav}>
          <ChatAgenticProvider enabled={chatAgentic}>
            <MenuAccessProvider hidden={hidden} canManageMenus={false}>
              <ActionCenterTabs />
            </MenuAccessProvider>
          </ChatAgenticProvider>
        </SimpleNavProvider>
      </NextIntlClientProvider>,
    );
  });
}

const tabs = () => [...container.querySelectorAll('nav a')].map((a) => a.textContent);

describe('ActionCenterTabs', () => {
  it('shows Needs review last, with how many wait, to an admin or a manager', async () => {
    await render();
    expect(getTaskReviewCount).toHaveBeenCalledWith('b1');
    expect(tabs()).toEqual(['Actions', 'Signals', 'KPIs', 'History', 'Needs review3']);
  });

  it('counts again when a review is approved or dismissed on its page', async () => {
    await render();
    getTaskReviewCount.mockResolvedValue(2);
    await act(async () => {
      window.dispatchEvent(new Event('action-task-reviews-changed'));
    });
    expect(tabs().at(-1)).toBe('Needs review2');
  });

  it('shows no count when nothing waits', async () => {
    getTaskReviewCount.mockResolvedValue(0);
    await render();
    expect(tabs().at(-1)).toBe('Needs review');
  });

  it('leaves it out for anyone else, and reads no count', async () => {
    canManage = false;
    await render();
    expect(tabs()).toEqual(['Actions', 'Signals', 'KPIs', 'History']);
    expect(getTaskReviewCount).not.toHaveBeenCalled();
  });
});

/**
 * The person's agents as GET /api/chat/agents?view=mine answers: `waiting`
 * of them with a newest run that needs them, `others` working or done.
 */
function stubAgents(waiting: number, others = 0) {
  const agent = (i: number, status: string, run: string | null) => ({
    id: `a${i}`,
    status,
    lastRun: run ? { status: run, at: '2026-11-11T08:00:00Z' } : null,
  });
  const agents = [
    ...Array.from({ length: waiting }, (_, i) => agent(i, 'active', 'needs_you')),
    ...Array.from({ length: others }, (_, i) => agent(100 + i, 'active', 'running')),
    agent(200, 'active', 'succeeded'),
    agent(201, 'draft', null),
    // An archived agent's old run waits on nobody.
    agent(202, 'archived', 'needs_you'),
  ];
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, agents }) }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const current = () => container.querySelector('nav a[aria-current="page"]')?.textContent;

describe('ActionCenterTabs without SIMPLE_NAV', () => {
  it('stay as they were whatever Chat and the menu say, and read none of the new counts', async () => {
    const fetch = stubAgents(2);
    await render({ simpleNav: false, chatAgentic: true });
    expect(tabs()).toEqual(['Actions', 'Signals', 'KPIs', 'History', 'Needs review3']);
    expect(getMyOpenActionCount).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector('nav[data-tabs="simple"]')).toBeNull();
  });
});

describe('ActionCenterTabs with SIMPLE_NAV', () => {
  it('are Today, Actions, Signals, Agents and History with the new Chat on, Needs review on none', async () => {
    stubAgents(0);
    await render({ simpleNav: true, chatAgentic: true });
    expect(tabs()).toEqual(['Today', 'Actions', 'Signals', 'Agents', 'History']);
    const hrefs = [...container.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/dashboard/action-center/today',
      '/dashboard/action-center/actions',
      '/dashboard/action-center/signals',
      '/dashboard/agents',
      '/dashboard/action-center/history',
    ]);
    // Needs review moves to Today: no tab and no count read here.
    expect(getTaskReviewCount).not.toHaveBeenCalled();
    expect(current()).toBe('Actions');
  });

  it('leave Agents out without the new Chat, and read no agent runs', async () => {
    const fetch = stubAgents(1);
    await render({ simpleNav: true, chatAgentic: false });
    expect(tabs()).toEqual(['Today', 'Actions', 'Signals', 'History']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leave Agents out on a plan without agents', async () => {
    planHasAgents = false;
    stubAgents(1);
    await render({ simpleNav: true, chatAgentic: true });
    expect(tabs()).toEqual(['Today', 'Actions', 'Signals', 'History']);
  });

  it('leave Agents out when its section is off the person’s menu (menu access), the rest stays', async () => {
    stubAgents(1);
    await render({ simpleNav: true, chatAgentic: true, hidden: ['agents', 'insights'] });
    expect(tabs()).toEqual(['Today', 'Actions', 'Signals', 'History']);
  });

  it('show the same to every role', async () => {
    canManage = false;
    stubAgents(0);
    await render({ simpleNav: true, chatAgentic: true });
    expect(tabs()).toEqual(['Today', 'Actions', 'Signals', 'Agents', 'History']);
  });

  it('count the person’s open actions, the new signals and their agents whose run waits on them', async () => {
    getMyOpenActionCount.mockResolvedValue(3);
    getNewSignalCount.mockResolvedValue(5);
    const fetch = stubAgents(1, 2);
    await render({ simpleNav: true, chatAgentic: true });
    expect(getMyOpenActionCount).toHaveBeenCalledWith('b1');
    expect(getNewSignalCount).toHaveBeenCalledWith('b1');
    expect(fetch).toHaveBeenCalledWith('/api/chat/agents?view=mine', { cache: 'no-store' });
    expect(tabs()).toEqual(['Today', 'Actions3', 'Signals5', 'Agents1', 'History']);
    // Plain numbers, as in the mockup: no colour of their own beside the menu's dots.
    for (const key of ['actions', 'signals', 'agents']) {
      const pill = container.querySelector(`[data-count="${key}"]`)!;
      expect(pill.className).toContain('text-muted-foreground');
      expect(pill.className).not.toMatch(/blue|amber|bg-/);
    }
  });

  it('show no count that is 0 or failed', async () => {
    getMyOpenActionCount.mockRejectedValue(new Error('down'));
    getNewSignalCount.mockResolvedValue(0);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ ok: false }) })),
    );
    await render({ simpleNav: true, chatAgentic: true });
    expect(tabs()).toEqual(['Today', 'Actions', 'Signals', 'Agents', 'History']);
  });

  it('mark the tab of the page shown: Today, Agents under its pages, and History on KPIs', async () => {
    stubAgents(0);
    for (const [path, tab] of [
      ['/dashboard/action-center/today', 'Today'],
      ['/dashboard/agents/new', 'Agents'],
      ['/dashboard/action-center/history', 'History'],
      ['/dashboard/action-center/kpis', 'History'],
    ] as const) {
      pathname = path;
      await render({ simpleNav: true, chatAgentic: true });
      expect(current()).toBe(tab);
    }
    pathname = '/dashboard/action-center/review';
    await render({ simpleNav: true, chatAgentic: true });
    expect(current()).toBeUndefined();
  });
});
