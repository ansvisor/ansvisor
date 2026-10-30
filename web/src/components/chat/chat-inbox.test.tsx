import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatListItem } from '@/lib/chat/conversations';
import type { DailySuggestion, DailySuggestionsRead } from '@/lib/chat/daily-suggestions';
import type { SuggestionsReadResult } from '@/lib/actions/chat-suggestions';

/**
 * The Inbox's topic tabs and daily suggestions (CHAT-26 §2.1, §2.2, §2.4,
 * §5, §6; mockup #d-inbox, #d-paused): All, Daily suggestions, Needs you
 * and Runs with their counts (Reports and Alerts hidden until they have a
 * source); the suggestions' rows with their dot, line and day; seen marked
 * for the rows on screen; a row opens its action in the Action Center; the
 * paused banner with Turn back on; Pause; an Agency partner's first Inbox;
 * none for an Analyst; a read-only workspace; and the Inbox as it was while
 * the new Chat is off.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: nav.push }),
}));
const plan = vi.hoisted(() => ({ locked: false, openUpgrade: vi.fn() }));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeDialog: () => ({
    isLocked: plan.locked,
    isDemo: false,
    reason: 'expired',
    adminName: null,
    openUpgrade: plan.openUpgrade,
  }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const store = vi.hoisted(() => ({ setActiveBrand: vi.fn() }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (pick: (s: unknown) => unknown) =>
    pick({
      brands: [{ id: 'brand-a' }, { id: 'brand-b' }],
      activeBrandId: 'brand-a',
      setActiveBrand: store.setActiveBrand,
    }),
}));
const server = vi.hoisted(() => ({
  read: vi.fn(),
  seen: vi.fn(async () => ({ ok: true })),
  open: vi.fn(async () => ({ ok: true })),
  set: vi.fn(async () => ({ ok: true })),
  start: vi.fn(async () => ({ ok: true, made: 2 })),
}));
vi.mock('@/lib/actions/chat-suggestions', () => ({
  readDailySuggestions: server.read,
  markDailySuggestionsSeen: server.seen,
  openDailySuggestion: server.open,
  setDailySuggestions: server.set,
  startDailySuggestions: server.start,
}));
const list = vi.hoisted(() => ({ chats: [] as ChatListItem[] }));
vi.mock('./chat-list-provider', () => ({
  useChatList: () => ({ status: 'ready', chats: list.chats, refresh: async () => undefined }),
}));

const { ChatInboxView } = await import('./chat-inbox');
const { ChatInbox } = await import('./chat-inbox-page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const chat = (id: string, row: Partial<ChatListItem> = {}): ChatListItem => ({
  id,
  title: `Chat ${id}`,
  brand: 'Ansvisor',
  pinned: false,
  archived: false,
  shared: false,
  mine: true,
  ownerInitials: null,
  lastMessageAt: '2026-10-29T08:00:00',
  unread: false,
  state: 'idle',
  step: null,
  progress: null,
  finishedAt: null,
  ...row,
});

/** The mockup's three rows: new today, seen yesterday, started in the Content Editor. */
const suggestion = (id: string, row: Partial<DailySuggestion> = {}): DailySuggestion => ({
  id,
  brandId: 'brand-b',
  actionId: `action-${id}`,
  sentOn: '2026-10-29',
  sentAt: '2026-10-29T07:05:00Z',
  seenAt: null,
  openedAt: null,
  startedAt: null,
  startedVia: null,
  summary: {
    actionNo: 2841,
    kind: 'content_opportunity',
    payload: { title: 'Optimize 5 hiking backpack pages AI asks about' },
    priorityLevel: 'high',
    startNow: { method: 'optimize', pages: 5, minutes: 20 },
  },
  ...row,
});
const MOCKUP_ROWS = [
  suggestion('s1'),
  suggestion('s2', {
    sentOn: '2026-10-28',
    seenAt: '2026-10-28T09:00:00Z',
    summary: {
      actionNo: 2866,
      kind: 'content_opportunity',
      payload: { title: 'Add an llms.txt to trailpeak.example' },
      priorityLevel: 'medium',
      startNow: null,
    },
  }),
  suggestion('s3', {
    sentOn: '2026-10-27',
    seenAt: '2026-10-27T09:00:00Z',
    openedAt: '2026-10-27T09:01:00Z',
    startedAt: '2026-10-27T12:00:00',
    startedVia: 'editor',
    summary: {
      actionNo: 2930,
      kind: 'content_opportunity',
      payload: { title: 'Link your 4 most-read guides to the Backpacks category' },
      priorityLevel: 'high',
      startNow: { method: 'optimize', pages: 4, minutes: 16 },
    },
  }),
];
const readOf = (read: Partial<DailySuggestionsRead> = {}): DailySuggestionsRead => ({
  roleFeed: 'default_on',
  state: 'on',
  suggestions: MOCKUP_ROWS,
  ...read,
});
const ok = (read: Partial<DailySuggestionsRead> = {}): SuggestionsReadResult => ({
  ok: true,
  read: readOf(read),
});

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 29, 9, 30));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  nav.push.mockClear();
  plan.locked = false;
  plan.openUpgrade.mockClear();
  store.setActiveBrand.mockClear();
  for (const fn of Object.values(server)) fn.mockClear();
  server.read.mockResolvedValue(ok());
  list.chats = [
    chat('a', { state: 'needsYou', progress: { done: 3, total: 6 } }),
    chat('b', { state: 'running', step: 'Comparing cited pages', progress: { done: 1, total: 5 } }),
  ];
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    );
  });
}

const text = () => host.textContent ?? '';
const tabs = () =>
  [...host.querySelectorAll('[role="tab"]')].map((tab) => (tab as HTMLElement).textContent);
const click = async (selector: string) =>
  act(async () => (host.querySelector(selector) as HTMLElement).click());
const openTab = (name: string) => click(`[data-tab="${name}"]`);
const rowTitles = () =>
  [...host.querySelectorAll('[data-action="inbox.openItem"][role="link"]')].map(
    (row) => row.querySelector('span:nth-child(2)')?.firstChild?.textContent,
  );

describe('the topic tabs', () => {
  it('shows All, Daily suggestions, Needs you and Runs with their counts, and the week in the subtitle', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    expect(tabs()).toEqual(['All5', 'Daily suggestions3', 'Needs you1', 'Runs1']);
    expect(text()).not.toContain('Reports');
    expect(text()).not.toContain('Alerts');
    expect(text()).toContain(
      '1 needs you · 1 running · 3 suggestions this week. Results from your agents and daily suggestions land here.',
    );
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('All5');
  });

  it('shows only the tab’s rows', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    expect(rowTitles()).toEqual([
      'Chat a',
      'Chat b',
      'Optimize 5 hiking backpack pages AI asks about',
      'Add an llms.txt to trailpeak.example',
      'Link your 4 most-read guides to the Backpacks category',
    ]);
    await openTab('needsYou');
    expect(rowTitles()).toEqual(['Chat a']);
    await openTab('runs');
    expect(rowTitles()).toEqual(['Chat b']);
    await openTab('suggestions');
    expect(rowTitles()).toEqual([
      'Optimize 5 hiking backpack pages AI asks about',
      'Add an llms.txt to trailpeak.example',
      'Link your 4 most-read guides to the Backpacks category',
    ]);
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('Daily suggestions3');
  });

  it('says "Nothing needs you." when nothing does', async () => {
    list.chats = [];
    await render(<ChatInbox suggestions={ok({ suggestions: [] })} />);
    expect(text()).toContain(
      'Nothing needs you. Results from your agents and daily suggestions land here.',
    );
    expect(tabs()).toEqual(['All0', 'Daily suggestions0', 'Needs you0', 'Runs0']);
    expect(text()).toContain('Nothing here.');
  });
});

describe('the daily suggestions', () => {
  it("lists the last 7 days' rows with their dot, line and day, under the line with Pause", async () => {
    await render(<ChatInbox suggestions={ok()} />);
    await openTab('suggestions');
    expect(text()).toContain(
      'Up to 7 a week, picked from what waits in your Action Center. This list shows the last 7 days and renews every 14 days. Pause daily suggestions',
    );
    const rows = [...host.querySelectorAll('[data-suggestion]')];
    expect(rows.map((row) => row.querySelector('[data-dot]')?.getAttribute('data-dot'))).toEqual([
      'new',
      'seen',
      'started',
    ]);
    expect(rows.map((row) => row.querySelector('[data-dot]')?.getAttribute('title'))).toEqual([
      'New',
      'Seen',
      'Started',
    ]);
    expect(rows.map((row) => row.querySelector('.block')?.textContent)).toEqual([
      'AC-2841 · High · Content Editor or Chat · about 20 min',
      'AC-2866 · Medium · Chat',
      'AC-2930 · High · started in Content Editor Oct 27',
    ]);
    expect(rows.map((row) => row.querySelector('.whitespace-nowrap')?.textContent)).toEqual([
      'Today · Oct 29',
      'Oct 28',
      'Oct 27',
    ]);
    expect(rows.map((row) => row.querySelector('button')?.textContent)).toEqual([
      'Open',
      'Open',
      'Open',
    ]);
  });

  it('says so when none came in the last 7 days', async () => {
    await render(<ChatInbox suggestions={ok({ suggestions: [] })} />);
    await openTab('suggestions');
    expect(text()).toContain('No daily suggestions in the last 7 days.');
  });

  it('marks the rows on screen seen, once, and not the ones seen before', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    expect(server.seen).toHaveBeenCalledTimes(1);
    expect(server.seen).toHaveBeenCalledWith(['s1']);
    await openTab('suggestions');
    await openTab('needsYou');
    await openTab('suggestions');
    expect(server.seen).toHaveBeenCalledTimes(1);
  });

  it('marks nothing seen while no suggestion is on screen', async () => {
    const onSeen = vi.fn();
    await render(
      <ChatInboxView
        status="ready"
        now={new Date(2026, 9, 29, 9, 30)}
        onRetry={() => undefined}
        items={list.chats}
        daily={{
          read: readOf(),
          justStarted: false,
          busy: false,
          onOpen: vi.fn(),
          onSeen,
          onPause: vi.fn(),
          onResume: vi.fn(),
        }}
      />,
    );
    expect(onSeen).toHaveBeenCalledWith(['s1']);
    onSeen.mockClear();
    await openTab('runs');
    expect(onSeen).not.toHaveBeenCalled();
  });

  it('opens the action in the Action Center on its brand, marking it opened and its feed used', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    await openTab('suggestions');
    await click('[data-suggestion="s2"]');
    expect(server.open).toHaveBeenCalledWith('s2');
    expect(store.setActiveBrand).toHaveBeenCalledWith('brand-b');
    expect(nav.push).toHaveBeenCalledWith('/dashboard/action-center/actions?action=action-s2');
    nav.push.mockClear();
    await click('[data-suggestion="s1"] button');
    expect(server.open).toHaveBeenLastCalledWith('s1');
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it('pauses them from the link', async () => {
    server.read.mockResolvedValue(ok({ state: 'off' }));
    await render(<ChatInbox suggestions={ok()} />);
    await openTab('suggestions');
    await click('[data-action="suggestions.pause"]');
    expect(server.set).toHaveBeenCalledWith(false);
    expect(server.read).toHaveBeenCalled();
    expect(text()).toContain(
      'Daily suggestions are pausedYou paused them. Your Action Center is unchanged.Turn back on',
    );
  });
});

describe('paused', () => {
  it('shows the banner, and Turn back on turns them on and reads again', async () => {
    await render(<ChatInbox suggestions={ok({ state: 'paused', suggestions: [] })} />);
    await openTab('suggestions');
    expect(text()).toContain(
      'Daily suggestions are pausedNone was opened or used in 30 days, so we stopped picking them. Your Action Center is unchanged.Turn back on',
    );
    expect(text()).toContain('Turned back on, the first suggestion arrives tomorrow morning.');
    expect(host.querySelector('[data-action="suggestions.pause"]')).toBeNull();
    await click('[data-action="suggestions.resume"]');
    expect(server.set).toHaveBeenCalledWith(true);
    expect(server.read).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-action="suggestions.resume"]')).toBeNull();
    expect(host.querySelector('[data-action="suggestions.pause"]')).not.toBeNull();
  });
});

describe('who gets them', () => {
  it("makes an Agency partner's feeds on their first Inbox, with the line saying so", async () => {
    server.read.mockResolvedValue(ok({ roleFeed: 'opt_in', state: 'on', suggestions: [] }));
    await render(
      <ChatInbox suggestions={ok({ roleFeed: 'opt_in', state: 'none', suggestions: [] })} />,
    );
    expect(server.start).toHaveBeenCalledTimes(1);
    expect(server.read).toHaveBeenCalledTimes(1);
    expect(text()).toContain(
      'Daily suggestions are on for you: one action a day from your Action Center, starting tomorrow morning.',
    );
  });

  it('makes none for an Admin, nor again for a partner who has them', async () => {
    await render(<ChatInbox key="admin" suggestions={ok({ state: 'none' })} />);
    await render(
      <ChatInbox key="partner" suggestions={ok({ roleFeed: 'opt_in', state: 'off' })} />,
    );
    expect(server.start).not.toHaveBeenCalled();
  });

  it('gives an Analyst no Daily suggestions tab', async () => {
    await render(
      <ChatInbox suggestions={ok({ roleFeed: 'never', state: 'none', suggestions: [] })} />,
    );
    expect(tabs()).toEqual(['All2', 'Needs you1', 'Runs1']);
    expect(text()).toContain('1 needs you · 1 running. Results from your agents land here.');
    expect(server.start).not.toHaveBeenCalled();
    expect(server.seen).not.toHaveBeenCalled();
  });
});

describe('a read-only workspace', () => {
  it('shows the list and writes nothing: Pause opens the plan dialog, a row still opens', async () => {
    plan.locked = true;
    await render(<ChatInbox suggestions={ok({ roleFeed: 'opt_in', state: 'on' })} />);
    await openTab('suggestions');
    expect(host.querySelectorAll('[data-suggestion]')).toHaveLength(3);
    expect(server.seen).not.toHaveBeenCalled();
    await click('[data-action="suggestions.pause"]');
    expect(server.set).not.toHaveBeenCalled();
    expect(plan.openUpgrade).toHaveBeenCalledWith('Pausing daily suggestions needs a plan');
    await click('[data-suggestion="s1"]');
    expect(server.open).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith('/dashboard/action-center/actions?action=action-s1');
  });

  it("doesn't make a partner's feeds", async () => {
    plan.locked = true;
    await render(
      <ChatInbox suggestions={ok({ roleFeed: 'opt_in', state: 'none', suggestions: [] })} />,
    );
    expect(server.start).not.toHaveBeenCalled();
  });
});

describe('with the new Chat off', () => {
  it('is the Inbox as it was: no tabs, no suggestions', async () => {
    list.chats = [];
    await render(<ChatInbox suggestions={{ ok: false, failure: 'chat_off' }} />);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(text()).toBe('InboxNothing needs you. Results from your agents land here.');
    expect(server.seen).not.toHaveBeenCalled();
    expect(server.start).not.toHaveBeenCalled();
  });
});
