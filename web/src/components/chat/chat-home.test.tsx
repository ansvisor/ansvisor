import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { FocusArea } from '@/lib/chat/focus';
import type { ChatListItem } from '@/lib/chat/conversations';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import type { SinceYouLeft } from '@/lib/chat/since';

/**
 * Chat Home and the Inbox (CHAT-01 items 10–12; mockup #s-home, #s-inbox):
 * the greeting by the person's clock, what needs them as a link to the
 * Inbox or "All caught up."; "For you now" (CHAT-08 v2): Ask anything
 * always, More and the jobs that write for someone who can change things, a
 * job's chip only with something to do, its count from the brand's data,
 * read again for another brand, which starts the chat in its skill's words
 * and opens it; the Inbox lists needs you, running and unread results with
 * Review, Watch and Open.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/dashboard/chat',
  useRouter: () => ({ push: nav.push }),
}));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({ isLocked: false, openUpgrade: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const BRAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const due = vi.hoisted(() => ({
  brand: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  answer: null as unknown,
  read: vi.fn(),
  since: null as SinceYouLeft | null,
}));
vi.mock('@/lib/actions/chat-home', () => ({
  readFocusFill: vi.fn(async () => ({ ok: false })),
  readHomeShortcuts: due.read,
  readSinceYouLeft: vi.fn(async () => ({ ok: true, since: due.since })),
}));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => analytics);
vi.mock('@/lib/actions/chat-prefs', () => ({
  saveChatFocus: vi.fn(),
  skipChatFocus: vi.fn(),
  markFocusPrompted: vi.fn(),
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (pick: (s: { activeBrandId: string }) => unknown) =>
    pick({ activeBrandId: due.brand }),
}));
const list = vi.hoisted(() => ({ chats: [] as ChatListItem[] }));
vi.mock('./chat-list-provider', () => ({
  useChatList: () => ({
    status: 'ready',
    chats: list.chats,
    total: list.chats.length,
    archived: 0,
    refresh: async () => undefined,
    update: () => undefined,
  }),
}));

const { ChatHome, ChatHomeView } = await import('./chat-home');
const { ChatInboxView } = await import('./chat-inbox');

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
  lastMessageAt: '2026-10-30T09:00:00',
  unread: false,
  state: 'idle',
  step: null,
  progress: null,
  finishedAt: null,
  ...row,
});

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  nav.push.mockClear();
  list.chats = [];
  due.brand = BRAND;
  due.answer = { ok: true, dueTasks: 3, lostPages: 0, readyDrafts: 0 };
  due.read.mockReset().mockImplementation(async () => due.answer);
  due.since = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(node: ReactNode, role: TeamRole = 'manager') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>{node}</RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const text = () => host.textContent ?? '';
const at = (time: string) => new Date(`2026-10-30T${time}`);
const view = (props: Partial<Parameters<typeof ChatHomeView>[0]> = {}) => (
  <ChatHomeView
    firstName="Alex"
    now={at('12:00:00')}
    inbox={0}
    needsYou={0}
    dueTasks={null}
    lostPages={null}
    readyDrafts={null}
    canChange
    onAsk={() => undefined}
    starting={false}
    {...props}
  />
);

describe('ChatHomeView', () => {
  it('greets by the local hour, at 11:59, 12:00, 17:59 and 18:00', async () => {
    for (const [time, words] of [
      ['11:59:00', 'Good morning, Alex'],
      ['12:00:00', 'Good afternoon, Alex'],
      ['17:59:00', 'Good afternoon, Alex'],
      ['18:00:00', 'Good evening, Alex'],
    ]) {
      await render(view({ now: at(time) }));
      expect(host.querySelector('h1')?.textContent).toBe(words);
    }
  });

  it('greets without a name, and not at all until the clock is known', async () => {
    await render(view({ firstName: null }));
    expect(host.querySelector('h1')?.textContent).toBe('Good afternoon');
    await render(view({ now: null }));
    expect(host.querySelector('h1')?.textContent).toBe('');
  });

  it('links what needs the person to the Inbox, or says all is caught up', async () => {
    await render(view({ inbox: 3, needsYou: 1 }));
    const link = host.querySelector('[data-action="home.openInbox"]')!;
    expect(link.getAttribute('href')).toBe('/dashboard/chat/inbox');
    expect(text()).toContain('Your agents worked while you were away. 1 thing needs you.');
    await render(view({ inbox: 3, needsYou: 2 }));
    expect(text()).toContain('2 things need you');
    await render(view());
    expect(text()).toContain('All caught up.');
  });

  it('shows Ask anything and More always, and a job only with something to do', async () => {
    await render(view({ dueTasks: 0, lostPages: 0, readyDrafts: 0 }));
    expect(text()).toContain('For you now');
    expect(host.querySelector('[data-action="home.askAnything"]')?.textContent).toBe(
      'Ask anything',
    );
    const more = host.querySelector('[data-action="home.moreShortcuts"]')!;
    expect(more.textContent).toBe('More▾');
    // The arrow is drawn, not read.
    expect(more.querySelector('[aria-hidden="true"]')?.textContent).toBe('▾');
    expect(host.querySelector('[data-action="home.runShortcut"]')).toBeNull();
    await render(view({ dueTasks: 1234, lostPages: 1, readyDrafts: 2 }));
    expect(
      [...host.querySelectorAll('[data-action="home.runShortcut"]')].map((b) => b.textContent),
    ).toEqual(['Complete tasks 1,234 due', 'Win back citations 1 page', 'Ready to publish 2']);
    // The chips are one group, named by its title.
    const group = host.querySelector('[role="group"]')!;
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'For you now',
    );
  });

  it('gives someone who can’t change things the jobs that read, and no More', async () => {
    const onAsk = vi.fn();
    await render(view({ dueTasks: 4, lostPages: 2, readyDrafts: 1, canChange: false, onAsk }));
    expect(host.querySelector('[data-action="home.moreShortcuts"]')).toBeNull();
    const chips = [...host.querySelectorAll<HTMLElement>('[data-action="home.runShortcut"]')];
    expect(chips.map((b) => b.dataset.skill)).toEqual(['winback']);
    await act(async () => chips[0].click());
    expect(onAsk).toHaveBeenCalledWith(
      'Show the 2 pages that lost citations and what AI cites instead.',
    );
  });

  it('asks Chat in each chip’s words', async () => {
    const onAsk = vi.fn();
    await render(view({ dueTasks: 4, lostPages: 2, readyDrafts: 1, onAsk }));
    for (const chip of host.querySelectorAll<HTMLElement>('[data-action="home.runShortcut"]')) {
      await act(async () => chip.click());
    }
    // In the words of W2-04's skills: Chat prepares; the person closes and publishes.
    expect(onAsk.mock.calls).toEqual([
      [
        "/tasks Work through this week's Action Center tasks by priority and prepare what each one needs. I'll close the tasks.",
      ],
      ['Win back the citations we lost on 2 pages: refresh them against what AI cites now.'],
      [
        'Check the 1 ready draft, fill their page fields and send them to our CMS as drafts. Going live stays my click.',
      ],
    ]);
  });

  it('puts Ask anything into the composer, and More opens its / menu', async () => {
    const box = document.createElement('textarea');
    box.dataset.action = 'composer.input';
    const slash = document.createElement('button');
    slash.dataset.action = 'composer.openSlash';
    const opened = vi.fn();
    slash.addEventListener('click', opened);
    document.body.append(box, slash);
    try {
      await render(view());
      await act(async () =>
        (host.querySelector('[data-action="home.askAnything"]') as HTMLElement).click(),
      );
      expect(document.activeElement).toBe(box);
      await act(async () =>
        (host.querySelector('[data-action="home.moreShortcuts"]') as HTMLElement).click(),
      );
      expect(opened).toHaveBeenCalledTimes(1);
    } finally {
      box.remove();
      slash.remove();
    }
  });
});

const SINCE: SinceYouLeft = {
  from: '2026-10-19',
  seenAt: '2026-10-19T15:20:00.000Z',
  drop: { engine: 'google-aio', before: 60, now: 40 },
  win: { engine: 'chatgpt-web', before: 31, now: 45 },
};

describe('Since you left', () => {
  it('shows the biggest drop with Why?, then one win with Which ones?', async () => {
    await render(view({ since: SINCE }));
    expect(text()).toContain('Since you left');
    expect(text()).toContain('Oct 19 → yesterday');
    expect(text()).toContain('Google AI Overviews citations');
    expect(text()).toContain('down 20');
    expect(text()).toContain('One win');
    expect(text()).toContain('ChatGPT citations');
    expect(text()).toContain('up 14');
    expect(host.querySelector('[data-action="why.open"]')?.textContent).toBe('Why?');
    expect(host.querySelector('[data-action="win.open"]')?.textContent).toBe('Which ones?');
  });

  it('writes a big move with thousands', async () => {
    await render(
      view({ since: { ...SINCE, drop: { engine: 'google-aio', before: 1500, now: 266 } } }),
    );
    expect(text()).toContain('down 1,234');
    expect(
      host.querySelector('[data-action="why.open"]')?.previousElementSibling?.textContent,
    ).toContain('1,234');
  });

  it('says "Since you left" over a win alone, and nothing without a move', async () => {
    await render(view({ since: { ...SINCE, drop: null } }));
    expect(text()).toContain('Since you left');
    expect(text()).not.toContain('One win');
    await render(view({ since: null }));
    expect(text()).not.toContain('Since you left');
  });

  it('asks Chat why, or which ones, in the words of the strip', async () => {
    const onAsk = vi.fn();
    await render(view({ since: SINCE, onAsk }));
    await act(async () => (host.querySelector('[data-action="why.open"]') as HTMLElement).click());
    await act(async () => (host.querySelector('[data-action="win.open"]') as HTMLElement).click());
    expect(onAsk.mock.calls).toEqual([
      ['Why did our Google AI Overviews citations drop since Oct 19?'],
      ['Which ChatGPT citations did we win since Oct 19?'],
    ]);
  });

  it('keeps the person’s leave a moment after Home goes, not on a quick return', async () => {
    const sent = vi.fn(async () => new Response('{"ok":true}'));
    globalThis.fetch = sent as unknown as typeof fetch;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await render(<ChatHome firstName="Alex" />);
      act(() => root.unmount());
      root = createRoot(host);
      await render(<ChatHome firstName="Alex" />);
      vi.advanceTimersByTime(1500);
      expect(sent).not.toHaveBeenCalled();
      act(() => root.unmount());
      root = createRoot(host);
      vi.advanceTimersByTime(1000);
      expect(sent).toHaveBeenCalledWith('/api/chat/home-seen', {
        method: 'POST',
        keepalive: true,
      });
      // A page that closes on Home keeps it too.
      await render(<ChatHome firstName="Alex" />);
      window.dispatchEvent(new Event('pagehide'));
      expect(sent).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ChatHome', () => {
  it('starts a chip’s job as a new chat and opens it while it works', async () => {
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response('', {
        status: 200,
        headers: { 'x-chat-conversation': 'cccccccc-0000-4000-8000-000000000001' },
      });
    }) as unknown as typeof fetch;
    await render(<ChatHome firstName="Alex" />);
    await act(async () => undefined);
    expect(text()).toContain('Complete tasks 3 due');
    expect(due.read).toHaveBeenCalledWith(BRAND, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    await act(async () => (host.querySelector('[data-skill="tasks"]') as HTMLElement).click());
    expect(calls[0]).toMatchObject({
      url: '/api/chat/runs',
      body: {
        message:
          "/tasks Work through this week's Action Center tasks by priority and prepare what each one needs. I'll close the tasks.",
        brandId: BRAND,
      },
    });
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/cccccccc-0000-4000-8000-000000000001');
  });

  it('shows no job when the counts can’t be read, and keeps Ask anything', async () => {
    due.answer = { ok: false };
    await render(<ChatHome firstName="Alex" />);
    await act(async () => undefined);
    expect(host.querySelector('[data-action="home.runShortcut"]')).toBeNull();
    expect(host.querySelector('[data-action="home.askAnything"]')).not.toBeNull();
    due.read.mockRejectedValueOnce(new Error('network'));
    root.unmount();
    root = createRoot(host);
    await render(<ChatHome firstName="Alex" />);
    await act(async () => undefined);
    expect(host.querySelector('[data-action="home.runShortcut"]')).toBeNull();
  });

  it('reads the counts again for another brand, never showing the first one’s', async () => {
    await render(<ChatHome firstName="Alex" />);
    await act(async () => undefined);
    expect(text()).toContain('Complete tasks 3 due');
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    due.brand = other;
    let answer: (value: unknown) => void = () => undefined;
    due.read.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await render(<ChatHome firstName="Alex" />);
    // While the new brand's counts are read, the first brand's aren't shown.
    expect(host.querySelector('[data-action="home.runShortcut"]')).toBeNull();
    await act(async () => answer({ ok: true, dueTasks: 0, lostPages: 0, readyDrafts: 5 }));
    expect(due.read).toHaveBeenLastCalledWith(other, expect.any(String));
    expect(text()).toContain('Ready to publish 5');
  });

  it('shows an Analyst no More and no job that writes', async () => {
    due.answer = { ok: true, dueTasks: 3, lostPages: 0, readyDrafts: 2 };
    await render(<ChatHome firstName="Alex" />, 'analyst');
    await act(async () => undefined);
    expect(host.querySelector('[data-action="home.moreShortcuts"]')).toBeNull();
    expect(host.querySelector('[data-action="home.runShortcut"]')).toBeNull();
  });

  it('asks Why? from "Since you left" in a new chat', async () => {
    due.since = SINCE;
    const bodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('', {
        status: 200,
        headers: { 'x-chat-conversation': 'cccccccc-0000-4000-8000-000000000002' },
      });
    }) as unknown as typeof fetch;
    await render(<ChatHome firstName="Alex" />);
    await act(async () => undefined);
    await act(async () => (host.querySelector('[data-action="why.open"]') as HTMLElement).click());
    expect(bodies[0]).toMatchObject({
      message: 'Why did our Google AI Overviews citations drop since Oct 19?',
    });
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/cccccccc-0000-4000-8000-000000000002');
  });
});

describe("a teammate's shared chat", () => {
  it('never needs the person on Home: its author answers it', async () => {
    list.chats = [
      chat('t', { mine: false, shared: true, ownerInitials: 'SL', state: 'needsYou' }),
      chat('u', { mine: false, shared: true, ownerInitials: 'SL', state: 'running' }),
    ];
    await render(<ChatHome firstName="Alex" />);
    expect(host.querySelector('[data-action="home.openInbox"]')).toBeNull();
    expect(text()).toContain('All caught up.');
  });
});

describe('ChatInboxView', () => {
  it('lists needs you, running and unread results, each with its button', async () => {
    const now = at('12:00:00');
    await render(
      <ChatInboxView
        status="ready"
        now={now}
        onRetry={() => undefined}
        items={[
          chat('a', {
            state: 'needsYou',
            progress: { done: 3, total: 6 },
            lastMessageAt: '2026-10-30T11:50:00',
          }),
          chat('b', {
            state: 'running',
            step: 'Comparing cited pages',
            progress: { done: 1, total: 5 },
          }),
          chat('c', { state: 'done', unread: true, finishedAt: '2026-10-30T08:02:00' }),
        ]}
      />,
    );
    expect(text()).toContain(
      '1 needs you · 1 running · 1 done today. Results from your agents land here.',
    );
    expect(text()).toContain('Needs your OK · step 4 of 6');
    expect(text()).toContain('10 min ago');
    const buttons = [...host.querySelectorAll('[data-action^="inbox."]')]
      .map((el) => (el as HTMLElement).dataset.action)
      .filter((name) => name !== 'inbox.openItem');
    expect(buttons).toEqual(['inbox.review', 'inbox.watch', 'inbox.openReport']);
    await act(async () =>
      (host.querySelector('[data-action="inbox.openItem"]') as HTMLElement).click(),
    );
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/a');
  });

  it('says one line when nothing is there', async () => {
    await render(<ChatInboxView status="ready" now={null} onRetry={() => undefined} items={[]} />);
    expect(text()).toBe('InboxNothing needs you. Results from your agents land here.');
  });
});

describe('the focus pill (CHAT-24 §3 item 3)', () => {
  it('says what Chat focuses on under the greeting, and Edit opens the picker', async () => {
    const onEdit = vi.fn();
    await render(view({ focus: { areas: ['pd', 'bd'], onEdit } }));
    const pill = host.querySelector('[data-slot="focus-pill"]')!;
    expect(pill.textContent).toBe('Focused on Product and Markets and sourcesEdit');
    await act(async () => (pill.querySelector('button') as HTMLButtonElement).click());
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('names the first two of three or more, and the rest as a count', async () => {
    await render(view({ focus: { areas: ['lead', 'comp', 'brand'], onEdit: () => undefined } }));
    const pill = host.querySelector('[data-slot="focus-pill"]')!;
    expect(pill.textContent).toBe('Focused on Big picture, Competitors +1Edit');
    expect(pill.getAttribute('title')).toBe('Big picture, Competitors, Brand');
  });

  it('offers a focus without one, and shows no pill outside Chat Home', async () => {
    await render(view({ focus: { areas: [], onEdit: () => undefined } }));
    expect(host.querySelector('[data-slot="focus-pill"]')?.textContent).toBe(
      'Get suggestions for what you work onChoose focus',
    );
    await render(view());
    expect(host.querySelector('[data-slot="focus-pill"]')).toBeNull();
  });
});

describe('Home by focus (CHAT-24 §4)', () => {
  const words = (rivalMove: { name: string; points: number } | null = null) => ({
    fill: { rival: 'Kestrel CRM', topic: 'Integrations', market: null },
    rivalMove,
  });
  const focus = (...areas: FocusArea[]) => ({ areas, onEdit: () => undefined });
  const chips = () => [...host.querySelectorAll<HTMLElement>('[data-action="home.runShortcut"]')];

  it('takes the picked areas’ shortcuts in turn, five at most beside Ask anything', async () => {
    await render(view({ focus: focus('comp', 'brand'), words: words() }));
    expect(chips().map((chip) => chip.textContent)).toEqual([
      'Competitor moves',
      'Fact check',
      'Prompts we lost',
      'How AI describes us',
      'Cited for rivals, not us',
    ]);
    expect(host.querySelector('[data-action="home.moreShortcuts"]')).not.toBeNull();
  });

  it('keeps the jobs’ counts and rules, and asks in each shortcut’s words', async () => {
    const onAsk = vi.fn();
    analytics.track.mockClear();
    await render(view({ focus: focus('seo'), words: words(), dueTasks: 4, lostPages: 0, onAsk }));
    expect(chips().map((chip) => [chip.dataset.skill, chip.textContent])).toEqual([
      ['tasks', 'Complete tasks 4 due'],
      ['auditFixes', 'Site audit fixes'],
      ['report', 'Weekly report'],
    ]);
    await act(async () => chips()[2].click());
    expect(onAsk).toHaveBeenCalledWith("/report Write this week's report on our AI visibility.");
    expect(analytics.track).toHaveBeenCalledWith('chat_focus_shortcut_clicked', {
      area: 'seo',
      skill: 'report',
    });
    // A role that only reads: no job that changes things.
    await render(view({ focus: focus('seo'), words: words(), dueTasks: 4, canChange: false }));
    expect(chips().map((chip) => chip.dataset.skill)).toEqual(['auditFixes', 'report']);
  });

  it('starts with four questions in the workspace’s words, a new chat each', async () => {
    const onAsk = vi.fn();
    analytics.track.mockClear();
    await render(view({ focus: focus('pd', 'bd'), words: words(), onAsk }));
    const questions = [...host.querySelectorAll<HTMLElement>('[data-action="dept.starter"]')];
    expect(questions.map((q) => q.textContent)).toEqual([
      '›What do buyers ask AI about Integrations?',
      '›Where does AI send buyers to our rivals?',
      '›Which features does AI name for Kestrel CRM but not for us?',
      '›Which directories and review sites does AI trust in our category?',
    ]);
    expect(text()).toContain('Start with a question');
    await act(async () => questions[1].click());
    expect(onAsk).toHaveBeenCalledWith('Where does AI send buyers to our rivals?');
    expect(analytics.track).toHaveBeenCalledWith('chat_starter_clicked', { area: 'bd', index: 1 });
  });

  it('waits for the words before the questions, and shows none without a focus', async () => {
    await render(view({ focus: focus('pd'), words: null }));
    expect(host.querySelector('[data-action="dept.starter"]')).toBeNull();
    await render(view({ focus: focus(), words: words() }));
    expect(host.querySelector('[data-action="dept.starter"]')).toBeNull();
    expect(text()).not.toContain('Start with a question');
  });

  it('offers new skills for the picked areas, each starting a chat with it', async () => {
    const onAsk = vi.fn();
    await render(view({ focus: focus('comp', 'brand'), words: null, onAsk }));
    const news = [...host.querySelectorAll<HTMLElement>('[data-action="dept.openNew"]')];
    expect(news.map((item) => item.textContent)).toEqual([
      'Skill/rivalsA one-page brief on one competitor across all AI platforms.',
      'Skill/wrongclaimFinds AI answers with wrong facts about you and drafts the fixes.',
    ]);
    await act(async () => news[0].click());
    expect(onAsk).toHaveBeenCalledWith('/rivals');
    await render(view({ focus: focus('lead', 'growth'), words: words() }));
    expect(text()).not.toContain('New for you');
  });

  it('says a competitor’s rise under the greeting, after what needs the person', async () => {
    await render(
      view({ focus: focus('pd', 'comp'), words: words({ name: 'Kestrel CRM', points: 4 }) }),
    );
    expect(host.querySelector('h1 + p')?.textContent).toBe(
      'Kestrel CRM’s mention rate rose 4 points this week.',
    );
    await render(
      view({
        focus: focus('comp'),
        words: words({ name: 'Kestrel CRM', points: 4 }),
        inbox: 1,
        needsYou: 1,
      }),
    );
    expect(host.querySelector('h1 + p')?.textContent).toContain('1 thing needs you');
    await render(view({ focus: focus('comp'), words: words({ name: 'Kestrel CRM', points: 2 }) }));
    expect(host.querySelector('h1 + p')?.textContent).toBe('All caught up.');
  });
});
