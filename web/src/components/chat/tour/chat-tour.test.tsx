import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import {
  ChatPanelContext,
  type ChatPanelSetup,
  type ChatPanelState,
} from '@/components/chat/panel/chat-panel-context';
import type { TourTopic } from '@/lib/chat/tour';

/**
 * The product tour (owner decision 2026-11-06; mockups chat-tour/2 and 3):
 * a topic opens its page with the side panel on the tour's chat; Next, the
 * topic's own step in Chat, Another topic and End the tour under its turn;
 * "Ansvisor tour · n of 5" over it.
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: '/dashboard/insights' }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => nav.pathname,
}));
// What a page watching the brand's first run last saw of it.
const firstRun = vi.hoisted(() => ({ run: null as unknown }));
vi.mock('@/hooks/use-first-run', () => ({ currentFirstRun: () => firstRun.run }));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => analytics);
const actions = vi.hoisted(() => ({
  showTourTopic: vi.fn(),
  endChatTour: vi.fn(),
  prepareChatTour: vi.fn(),
}));
vi.mock('@/lib/actions/chat-tour', () => actions);
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (pick: (s: { activeBrandId: string }) => unknown) =>
    pick({ activeBrandId: 'brand-1' }),
}));

// An in-memory localStorage: the test environment may have none.
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

const {
  ChatTourProvider,
  TOUR_PANEL_CLOSED_KEY,
  TourControls,
  TourLabel,
  tourScrollTop,
  useChatTour,
} = await import('./chat-tour');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CHAT = '44444444-4444-4444-8444-444444444444';
const openChat = vi.fn();

/** The panel as a page has it: on the page (`available`), open or not, and its closes. */
const panelState = { available: false, open: false, closes: 0 };
const panel = (enabled = true) =>
  ({
    setup: { enabled } as ChatPanelSetup,
    available: panelState.available,
    open: panelState.open,
    closes: panelState.closes,
    size: 'compact',
    toggle: vi.fn(),
    close: vi.fn(),
    resize: vi.fn(),
    page: null,
    setPage: vi.fn(),
    draft: null,
    ask: vi.fn(),
    fill: vi.fn(),
    openChat,
  }) as ChatPanelState;

let root: Root;
let host: HTMLDivElement;
/** The tour as the provider gives it, after each render. */
const probe: { tour: ReturnType<typeof useChatTour> } = { tour: null };

function Probe({ children }: { children?: ReactNode }) {
  const tour = useChatTour();
  useEffect(() => {
    probe.tour = tour;
  });
  return <>{children}</>;
}

async function render(
  node: ReactNode,
  {
    enabled = true,
    initial = { chatId: null, topic: null, finished: false },
  }: {
    enabled?: boolean;
    initial?: { chatId: string | null; topic: TourTopic | null; finished: boolean };
  } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatPanelContext.Provider value={panel(enabled)}>
          <ChatTourProvider initial={initial}>
            <Probe>{node}</Probe>
          </ChatTourProvider>
        </ChatPanelContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.clearAllMocks();
  nav.pathname = '/dashboard/insights';
  firstRun.run = null;
  Object.assign(panelState, { available: false, open: false, closes: 0 });
  localStorage.removeItem(TOUR_PANEL_CLOSED_KEY);
  actions.showTourTopic.mockResolvedValue({ ok: true, chatId: CHAT });
  actions.endChatTour.mockResolvedValue({ ok: true, chatId: CHAT });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const q = (selector: string) => host.querySelector<HTMLElement>(selector);
const chips = () =>
  [...host.querySelectorAll('[data-slot="tour-controls"] button')].map((b) => b.textContent);
async function click(selector: string) {
  await act(async () => q(selector)!.click());
}

describe('ChatTourProvider', () => {
  it("opens a topic's page with the panel on the tour's chat", async () => {
    await render(null);
    expect(probe.tour).toMatchObject({ available: true, active: false });
    await act(async () => probe.tour!.show('visibility', 'everything'));
    expect(actions.showTourTopic).toHaveBeenCalledWith({
      topic: 'visibility',
      via: 'everything',
      brandId: 'brand-1',
      firstRun: null,
    });
    expect(nav.push).toHaveBeenCalledWith('/dashboard/insights');
    expect(openChat).toHaveBeenCalledWith(CHAT);
    expect(probe.tour).toMatchObject({
      chatId: CHAT,
      topic: 'visibility',
      active: true,
      finished: false,
    });
    expect(analytics.track).toHaveBeenCalledWith('chat_tour_topic', {
      topic: 'visibility',
      via: 'everything',
    });
  });

  it('says so, and stays, when a topic could not be opened', async () => {
    actions.showTourTopic.mockResolvedValue({ ok: false });
    await render(null);
    await act(async () => probe.tour!.show('content', 'topic'));
    expect(toast.error).toHaveBeenCalledWith('Couldn’t open that part of the tour. Try again.');
    expect(nav.push).not.toHaveBeenCalled();
    expect(openChat).not.toHaveBeenCalled();
    expect(probe.tour?.active).toBe(false);
  });

  it('ends the tour with its last line in the panel', async () => {
    await render(null, { initial: { chatId: CHAT, topic: 'content', finished: false } });
    expect(probe.tour?.active).toBe(true);
    await act(async () => probe.tour!.end());
    expect(actions.endChatTour).toHaveBeenCalledTimes(1);
    expect(openChat).toHaveBeenCalledWith(CHAT);
    expect(probe.tour).toMatchObject({ finished: true, active: false });
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('is not offered where the side panel is off for the person', async () => {
    await render(null, { enabled: false });
    expect(probe.tour?.available).toBe(false);
  });
});

describe('TourLabel and TourControls', () => {
  it('counts the topic in the tour', async () => {
    await render(<TourLabel topic="prompts" />);
    expect(q('[data-slot="tour-label"]')?.textContent).toBe('Ansvisor tour · 2 of 5');
  });

  it('offers Next, Another topic and End the tour under a topic', async () => {
    await render(
      <TourControls focus={{ kind: 'turn', topic: 'visibility', question: 0 }} send={vi.fn()} />,
      {
        initial: { chatId: CHAT, topic: 'visibility', finished: false },
      },
    );
    expect(chips()).toEqual(['Next: Topics and prompts', 'Another topic', 'End the tour']);
    await click('[data-action="tour.next"]');
    expect(actions.showTourTopic).toHaveBeenCalledWith({
      topic: 'prompts',
      via: 'next',
      brandId: 'brand-1',
      firstRun: null,
    });
    expect(nav.push).toHaveBeenCalledWith('/dashboard/prompts');
  });

  it("offers Prompts' own step, which asks Chat in the same chat", async () => {
    const send = vi.fn();
    await render(
      <TourControls focus={{ kind: 'turn', topic: 'prompts', question: 2 }} send={send} />,
      {
        initial: { chatId: CHAT, topic: 'prompts', finished: false },
      },
    );
    expect(chips()).toEqual([
      'Next: Positions and locations',
      'Suggest prompts for me',
      'Another topic',
      'End the tour',
    ]);
    await click('[data-action="tour.topicAction"]');
    expect(send).toHaveBeenCalledWith('Suggest prompts for me');
    expect(actions.showTourTopic).not.toHaveBeenCalled();
  });

  it('keeps the step off while Chat is paused at the AI limit', async () => {
    await render(
      <TourControls
        focus={{ kind: 'turn', topic: 'prompts', question: 2 }}
        send={vi.fn()}
        disabled
      />,
      {
        initial: { chatId: CHAT, topic: 'prompts', finished: false },
      },
    );
    expect((q('[data-action="tour.topicAction"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists the other topics on Another topic, and opens the one picked', async () => {
    await render(
      <TourControls focus={{ kind: 'turn', topic: 'content', question: 4 }} send={vi.fn()} />,
      {
        initial: { chatId: CHAT, topic: 'content', finished: false },
      },
    );
    await click('[data-action="tour.another"]');
    expect(
      [...host.querySelectorAll('[data-action="tour.pick"]')].map((b) => b.textContent),
    ).toEqual(['Visibility', 'Topics and prompts', 'Positions and locations', 'Connections']);
    await click('[data-topic="positions"]');
    expect(actions.showTourTopic).toHaveBeenCalledWith({
      topic: 'positions',
      via: 'topic',
      brandId: 'brand-1',
      firstRun: null,
    });
    expect(nav.push).toHaveBeenCalledWith('/dashboard/prompts/tracked');
  });

  it('makes End the tour the next step after the last topic', async () => {
    await render(<TourControls focus={{ kind: 'newest', topic: 'connections' }} send={vi.fn()} />, {
      initial: { chatId: CHAT, topic: 'connections', finished: false },
    });
    expect(chips()).toEqual(['Another topic', 'End the tour']);
    expect(q('[data-action="tour.end"]')?.className).toContain('bg-foreground');
    await click('[data-action="tour.end"]');
    expect(actions.endChatTour).toHaveBeenCalledTimes(1);
  });
});

describe('the panel during the tour', () => {
  const ON = { chatId: CHAT, topic: 'prompts' as const, finished: false };

  it('opens by itself on the tour’s chat on every page with the panel', async () => {
    panelState.available = true;
    await render(null, { initial: ON });
    expect(openChat).toHaveBeenCalledWith(CHAT);
  });

  it('stays shut on Chat’s own pages, once open, and outside the tour', async () => {
    const fresh = async (initial: typeof ON | { chatId: null; topic: null; finished: boolean }) => {
      act(() => root.unmount());
      root = createRoot(host);
      await render(null, { initial });
    };
    await fresh(ON);
    Object.assign(panelState, { available: true, open: true });
    await fresh(ON);
    panelState.open = false;
    await fresh({ ...ON, finished: true });
    await fresh({ chatId: null, topic: null, finished: false });
    expect(openChat).not.toHaveBeenCalled();
  });

  it('leaves it closed once the person closes it, after a reload too, until they open it again', async () => {
    panelState.available = true;
    panelState.open = true;
    await render(null, { initial: ON });
    // ✕: closed by the person.
    Object.assign(panelState, { open: false, closes: 1 });
    await render(null, { initial: ON });
    expect(openChat).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOUR_PANEL_CLOSED_KEY)).toBe(CHAT);

    // Another page, or a reload: still closed.
    act(() => root.unmount());
    root = createRoot(host);
    Object.assign(panelState, { open: false, closes: 0 });
    await render(null, { initial: ON });
    expect(openChat).not.toHaveBeenCalled();

    // Ask Chat opens it again: pages open it by themselves again.
    panelState.open = true;
    await render(null, { initial: ON });
    expect(localStorage.getItem(TOUR_PANEL_CLOSED_KEY)).toBeNull();
  });

  it('opens it again from a tour chip after the person closed it', async () => {
    localStorage.setItem(TOUR_PANEL_CLOSED_KEY, CHAT);
    panelState.available = true;
    await render(null, { initial: ON });
    expect(openChat).not.toHaveBeenCalled();
    await act(async () => probe.tour!.show('content', 'next'));
    expect(openChat).toHaveBeenCalledWith(CHAT);
    expect(localStorage.getItem(TOUR_PANEL_CLOSED_KEY)).toBeNull();
  });

  it('tells the turn what a page saw of the brand’s first run', async () => {
    firstRun.run = { brandId: 'brand-1', queued: false, progress: null, left: { minutes: 14 } };
    await render(null);
    await act(async () => probe.tour!.show('visibility', 'topic'));
    expect(actions.showTourTopic).toHaveBeenCalledWith(
      expect.objectContaining({ firstRun: { minutes: 14 } }),
    );
    firstRun.run = { brandId: 'brand-1', queued: true, progress: null, left: { hours: 2 } };
    await act(async () => probe.tour!.show('content', 'next'));
    expect(actions.showTourTopic).toHaveBeenLastCalledWith(
      expect.objectContaining({ firstRun: { minutes: 120 } }),
    );
  });
});

describe('TourControls on a page not explained yet', () => {
  it('offers Show me this page, Another topic and End the tour, and explains the page', async () => {
    nav.pathname = '/dashboard/settings/integrations';
    await render(
      <TourControls focus={{ kind: 'unexplained', topic: 'connections' }} send={vi.fn()} />,
      {
        initial: { chatId: CHAT, topic: 'visibility', finished: false },
      },
    );
    expect(chips()).toEqual(['Show me this page', 'Another topic', 'End the tour']);
    await click('[data-action="tour.showPage"]');
    expect(actions.showTourTopic).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'connections', via: 'topic' }),
    );
  });
});

describe('tourScrollTop', () => {
  const at = (over: Partial<Parameters<typeof tourScrollTop>[0]> = {}) =>
    tourScrollTop({
      questionTop: 900,
      answerTop: 960,
      chipsBottom: 1300,
      viewHeight: 700,
      labelHeight: 30,
      composerHeight: 160,
      scrollTop: 0,
      ...over,
    });

  it('puts the turn’s line at the top when the turn and its chips fit above the composer', () => {
    expect(at()).toBe(900 - 30 - 12);
  });

  it('puts the answer at the top when the line would push the chips under the composer', () => {
    expect(at({ chipsBottom: 1400 })).toBe(960 - 30 - 12);
  });

  it('starts at the answer when even that leaves the chips below', () => {
    expect(at({ chipsBottom: 2000 })).toBe(960 - 30 - 12);
  });

  it('only brings the chips into view without a turn to show', () => {
    expect(at({ questionTop: null, answerTop: null })).toBe(1300 - (700 - 160 - 12));
    expect(at({ questionTop: null, answerTop: null, chipsBottom: 300 })).toBe(0);
  });
});
