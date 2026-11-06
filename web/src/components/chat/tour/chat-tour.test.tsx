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

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => nav }));
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

const { ChatTourProvider, TourControls, TourLabel, useChatTour } = await import('./chat-tour');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CHAT = '44444444-4444-4444-8444-444444444444';
const openChat = vi.fn();

const panel = (enabled = true) =>
  ({
    setup: { enabled } as ChatPanelSetup,
    available: false,
    open: false,
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
    await render(<TourControls topic="visibility" send={vi.fn()} />, {
      initial: { chatId: CHAT, topic: 'visibility', finished: false },
    });
    expect(chips()).toEqual(['Next: Topics and prompts', 'Another topic', 'End the tour']);
    await click('[data-action="tour.next"]');
    expect(actions.showTourTopic).toHaveBeenCalledWith({
      topic: 'prompts',
      via: 'next',
      brandId: 'brand-1',
    });
    expect(nav.push).toHaveBeenCalledWith('/dashboard/prompts');
  });

  it("offers Prompts' own step, which asks Chat in the same chat", async () => {
    const send = vi.fn();
    await render(<TourControls topic="prompts" send={send} />, {
      initial: { chatId: CHAT, topic: 'prompts', finished: false },
    });
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
    await render(<TourControls topic="prompts" send={vi.fn()} disabled />, {
      initial: { chatId: CHAT, topic: 'prompts', finished: false },
    });
    expect((q('[data-action="tour.topicAction"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists the other topics on Another topic, and opens the one picked', async () => {
    await render(<TourControls topic="content" send={vi.fn()} />, {
      initial: { chatId: CHAT, topic: 'content', finished: false },
    });
    await click('[data-action="tour.another"]');
    expect(
      [...host.querySelectorAll('[data-action="tour.pick"]')].map((b) => b.textContent),
    ).toEqual(['Visibility', 'Topics and prompts', 'Positions and locations', 'Connections']);
    await click('[data-topic="positions"]');
    expect(actions.showTourTopic).toHaveBeenCalledWith({
      topic: 'positions',
      via: 'topic',
      brandId: 'brand-1',
    });
    expect(nav.push).toHaveBeenCalledWith('/dashboard/prompts/tracked');
  });

  it('makes End the tour the next step after the last topic', async () => {
    await render(<TourControls topic="connections" send={vi.fn()} />, {
      initial: { chatId: CHAT, topic: 'connections', finished: false },
    });
    expect(chips()).toEqual(['Another topic', 'End the tour']);
    expect(q('[data-action="tour.end"]')?.className).toContain('bg-foreground');
    await click('[data-action="tour.end"]');
    expect(actions.endChatTour).toHaveBeenCalledTimes(1);
  });
});
