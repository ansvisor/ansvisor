import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/** The Action Center's tabs: Today, Actions, Signals, Agents and History. */

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
vi.mock('./first-run-note', () => ({ FirstRunNote: () => null }));

import { ActionCenterTabs } from './action-center-tabs';
import { ChatAgenticProvider } from '@/components/providers/chat-agentic-provider';
import { MenuAccessProvider } from '@/components/providers/menu-access-provider';

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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  planHasAgents = true;
  pathname = '/dashboard/action-center/actions';
});

async function render({
  chatAgentic = false,
  hidden = [] as string[],
}: { chatAgentic?: boolean; hidden?: string[] } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatAgenticProvider enabled={chatAgentic}>
          <MenuAccessProvider hidden={hidden} canManageMenus={false}>
            <ActionCenterTabs />
          </MenuAccessProvider>
        </ChatAgenticProvider>
      </NextIntlClientProvider>,
    );
  });
}

const tabs = () => [...container.querySelectorAll('nav a')].map((a) => a.textContent);

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

describe('ActionCenterTabs', () => {
  it('are Today, Actions, Signals, Agents and History with the new Chat on, Needs review on none', async () => {
    stubAgents(0);
    await render({ chatAgentic: true });
    expect(tabs()).toEqual(['Today', 'Actions', 'Signals', 'Agents', 'History']);
    const hrefs = [...container.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/dashboard/action-center/today',
      '/dashboard/action-center/actions',
      '/dashboard/action-center/signals',
      '/dashboard/agents',
      '/dashboard/action-center/history',
    ]);
    // Needs review is on Today: no tab here.
    expect(current()).toBe('Actions');
  });

  it('leave Agents out without the new Chat, and read no agent runs', async () => {
    const fetch = stubAgents(1);
    await render({ chatAgentic: false });
    expect(tabs()).toEqual(['Today', 'Actions', 'Signals', 'History']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leave Agents out on a plan without agents', async () => {
    planHasAgents = false;
    stubAgents(1);
    await render({ chatAgentic: true });
    expect(tabs()).toEqual(['Today', 'Actions', 'Signals', 'History']);
  });

  it('leave Agents out when its section is off the person’s menu (menu access), the rest stays', async () => {
    stubAgents(1);
    await render({ chatAgentic: true, hidden: ['agents', 'insights'] });
    expect(tabs()).toEqual(['Today', 'Actions', 'Signals', 'History']);
  });

  it('count the person’s open actions, the new signals and their agents whose run waits on them', async () => {
    getMyOpenActionCount.mockResolvedValue(3);
    getNewSignalCount.mockResolvedValue(5);
    const fetch = stubAgents(1, 2);
    await render({ chatAgentic: true });
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
    await render({ chatAgentic: true });
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
      await render({ chatAgentic: true });
      expect(current()).toBe(tab);
    }
    pathname = '/dashboard/action-center/review';
    await render({ chatAgentic: true });
    expect(current()).toBeUndefined();
  });
});
