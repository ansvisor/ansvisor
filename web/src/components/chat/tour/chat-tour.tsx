'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useChatPanel } from '@/components/chat/panel/chat-panel-context';
import { currentFirstRun } from '@/hooks/use-first-run';
import { usePathname, useRouter } from '@/i18n/navigation';
import { endChatTour, showTourTopic } from '@/lib/actions/chat-tour';
import { track } from '@/lib/analytics';
import {
  nextTopicOf,
  TOUR_ACTION_TOPICS,
  TOUR_PAGES,
  TOUR_TOPICS,
  type TourFocus,
  type TourTopic,
  type TourVia,
} from '@/lib/chat/tour';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';
import { TOUR_CHIP, TOUR_CHIP_PRIMARY } from './tour-chip';

/**
 * Chat's product tour (owner decision 2026-11-06; mockups
 * chat-tour/2-visibility-with-panel and 3-prompts-with-panel): a topic opens
 * its page with Chat's side panel beside it, and the panel shows the tour's
 * chat ("Ansvisor tour", in the person's Chats) with the topic's scripted
 * turn. Under it: Next: {topic} →, the topic's own step in Chat (Prompts:
 * Suggest prompts for me, a normal run), Another topic and End the tour;
 * over it, "Ansvisor tour · n of 5". A question typed meanwhile goes to Chat
 * in the same chat. The tour runs where the panel does: with Ask Chat on
 * pages off for the person, it isn't offered.
 *
 * While the tour is on, every app page opens with the panel open on the
 * tour's chat, until the person closes the panel: then it stays closed
 * (kept in this browser) until they open it again or click a tour chip.
 */

/** Where the tour stands, as the dashboard reads it for the person (00486). */
export interface ChatTourSetup {
  /** The tour's chat; null before the tour, or once it is gone. */
  chatId: string | null;
  /** The topic it is on; null before it. */
  topic: TourTopic | null;
  /** It ended (End the tour). */
  finished: boolean;
}

export interface ChatTourState extends ChatTourSetup {
  /** The tour can run: Chat's side panel is on pages for the person. */
  available: boolean;
  /** A topic is on and the tour hasn't ended: the panel shows its chips. */
  active: boolean;
  /** A topic is opening, or the tour ending: the chips wait. */
  busy: boolean;
  /** Opens the topic's page with the panel on the tour's chat, its turn added. */
  show: (topic: TourTopic, via: TourVia) => Promise<void>;
  /** Ends the tour: its last line in the panel, and the welcome card gone. */
  end: () => Promise<void>;
}

const ChatTourContext = createContext<ChatTourState | null>(null);

/** The tour; null outside the dashboard (a test, the Chat flag off). */
export function useChatTour(): ChatTourState | null {
  return useContext(ChatTourContext);
}

/** localStorage: the tour chat whose panel the person closed, so pages leave it closed. */
export const TOUR_PANEL_CLOSED_KEY = 'aeo:chat-tour-panel-closed';

function panelClosedFor(chatId: string): boolean {
  try {
    return localStorage.getItem(TOUR_PANEL_CLOSED_KEY) === chatId;
  } catch {
    return false;
  }
}

function keepPanelClosed(chatId: string) {
  try {
    localStorage.setItem(TOUR_PANEL_CLOSED_KEY, chatId);
  } catch {
    // Storage blocked: the panel opens by itself again on the next visit.
  }
}

function forgetPanelClosed() {
  try {
    localStorage.removeItem(TOUR_PANEL_CLOSED_KEY);
  } catch {
    // Storage blocked: nothing kept.
  }
}

export function ChatTourProvider({
  initial,
  children,
}: {
  initial: ChatTourSetup;
  children: ReactNode;
}) {
  const t = useTranslations('chatTour');
  const panel = useChatPanel();
  const router = useRouter();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const [tour, setTour] = useState(initial);
  const [busy, setBusy] = useState(false);
  // One step at a time: a second click while one opens does nothing.
  const working = useRef(false);
  const available = !!panel?.setup.enabled;
  // The page on screen has the panel (not Chat's own pages, nor the Content Editor).
  const onPage = !!panel?.available;
  const panelOpen = !!panel?.open;
  const closes = panel?.closes ?? 0;
  const openChat = panel?.openChat;
  const active = tour.topic !== null && !tour.finished;
  // The person's closes the tour has answered: one after them leaves the panel closed.
  const respected = useRef(closes);

  // Open again (Ask Chat, Ctrl J, a tour chip): pages may open it by themselves again.
  useEffect(() => {
    if (!panelOpen) return;
    respected.current = closes;
    forgetPanelClosed();
  }, [panelOpen, closes]);

  // Closed by the person during the tour: kept, so a reload leaves it closed too.
  useEffect(() => {
    if (active && tour.chatId && closes > respected.current) keepPanelClosed(tour.chatId);
  }, [active, closes, tour.chatId]);

  // Every page during the tour opens with the panel on the tour's chat. It
  // reads the chat with its own request, beside the page's reads.
  useEffect(() => {
    if (!active || !onPage || panelOpen || !tour.chatId || !openChat) return;
    if (closes > respected.current || panelClosedFor(tour.chatId)) return;
    openChat(tour.chatId);
  }, [active, onPage, panelOpen, closes, tour.chatId, openChat]);

  const show = useCallback(
    async (topic: TourTopic, via: TourVia) => {
      if (working.current) return;
      working.current = true;
      setBusy(true);
      // What a page watching the brand's first run saw of it, read at no cost.
      const run = currentFirstRun(brandId);
      const firstRun = run
        ? {
            minutes: run.left
              ? 'hours' in run.left
                ? run.left.hours * 60
                : run.left.minutes
              : null,
          }
        : null;
      const result = await showTourTopic({ topic, via, brandId, firstRun }).catch(() => ({
        ok: false as const,
      }));
      working.current = false;
      setBusy(false);
      if (!result.ok || !result.chatId) {
        toast.error(t('failed'));
        return;
      }
      track('chat_tour_topic', { topic, via });
      // A tour chip opens the panel again, whatever the person did with it.
      respected.current = closes;
      forgetPanelClosed();
      setTour({ chatId: result.chatId, topic, finished: false });
      router.push(TOUR_PAGES[topic]);
      // The panel opens with the page, on the tour's chat read again.
      openChat?.(result.chatId);
    },
    [brandId, closes, openChat, router, t],
  );

  const end = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const result = await endChatTour().catch(() => ({ ok: false as const }));
    working.current = false;
    setBusy(false);
    if (!result.ok) {
      toast.error(t('failed'));
      return;
    }
    track('chat_tour_ended', { topic: tour.topic });
    forgetPanelClosed();
    setTour((was) => ({ ...was, chatId: result.chatId, finished: true }));
    if (result.chatId) openChat?.(result.chatId);
  }, [openChat, t, tour.topic]);

  const value = useMemo<ChatTourState>(
    () => ({ ...tour, available, active, busy, show, end }),
    [tour, available, active, busy, show, end],
  );
  return <ChatTourContext.Provider value={value}>{children}</ChatTourContext.Provider>;
}

/** "Ansvisor tour · 2 of 5" over the tour's chat in the panel, kept in view as it scrolls. */
export function TourLabel({ topic }: { topic: TourTopic }) {
  const t = useTranslations('chatTour');
  return (
    <p
      data-slot="tour-label"
      className="sticky top-0 z-10 m-0 bg-background px-4 pt-3 pb-1 text-[11px] tracking-[.4px] text-muted-foreground uppercase"
    >
      {t('label', { n: TOUR_TOPICS.indexOf(topic) + 1, total: TOUR_TOPICS.length })}
    </p>
  );
}

/** Space kept between the panel's edges (its label, its composer) and what is brought into view. */
const SCROLL_PAD = 12;

/**
 * Where the panel's chat scrolls to show a tour turn: its line at the top
 * when the turn and its chips fit above the composer, else its answer at
 * the top while the chips still fit, else the answer's start. Without a
 * turn to show (`turnTop` null), just far enough for the chips. All in the
 * scrolling chat's own coordinates.
 */
export function tourScrollTop({
  questionTop,
  answerTop,
  chipsBottom,
  viewHeight,
  labelHeight,
  composerHeight,
  scrollTop,
}: {
  questionTop: number | null;
  answerTop: number | null;
  chipsBottom: number;
  viewHeight: number;
  labelHeight: number;
  composerHeight: number;
  scrollTop: number;
}): number {
  // The least scroll that shows the chips above the composer.
  const lowest = chipsBottom - (viewHeight - composerHeight - SCROLL_PAD);
  if (answerTop === null) return Math.max(scrollTop, lowest, 0);
  const top = (y: number) => Math.max(0, y - labelHeight - SCROLL_PAD);
  if (questionTop !== null && lowest <= top(questionTop)) return top(questionTop);
  return top(answerTop);
}

/** Brings the tour's turn and its chips into view in the panel's chat. */
function scrollToTurn(chips: HTMLElement, withTurn: boolean) {
  const view = chips.closest<HTMLElement>('[data-slot="panel-scroll"]');
  if (!view) return;
  const slot = chips.closest('li');
  const answer = withTurn ? slot?.previousElementSibling : null;
  const question = answer?.previousElementSibling ?? null;
  const origin = view.getBoundingClientRect().top - view.scrollTop;
  const y = (el: Element | null | undefined) =>
    el ? el.getBoundingClientRect().top - origin : null;
  view.scrollTop = tourScrollTop({
    questionTop: y(question),
    answerTop: y(answer),
    chipsBottom: chips.getBoundingClientRect().bottom - origin,
    viewHeight: view.clientHeight,
    labelHeight: view.querySelector<HTMLElement>('[data-slot="tour-label"]')?.offsetHeight ?? 0,
    composerHeight:
      view.querySelector<HTMLElement>('[data-slot="thread-composer"]')?.offsetHeight ?? 0,
    scrollTop: view.scrollTop,
  });
}

/**
 * The tour's chips beside the turn about the page on screen (`focus`,
 * tourFocusOf): Next: {topic} → (End the tour after the last), the topic's
 * own step in Chat, Another topic (the other topics, to pick one) and End
 * the tour; on a topic's page not explained yet, Show me this page in
 * Next's place. The turn and the chips come into view above the composer as
 * the panel opens, the page changes or a turn comes. `send` asks Chat in
 * this chat, as the box does.
 */
export function TourControls({
  focus,
  send,
  disabled = false,
}: {
  focus: TourFocus;
  send: (message: string) => void;
  /** Chat is paused (the AI limit): the topic's step in Chat waits. */
  disabled?: boolean;
}) {
  const t = useTranslations('chatTour');
  const tour = useChatTour();
  const panelOpen = !!useChatPanel()?.open;
  const pathname = usePathname();
  const [picking, setPicking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const unexplained = focus.kind === 'unexplained';
  const topic = focus.topic;
  const next = unexplained ? null : nextTopicOf(topic);
  const busy = !!tour?.busy;
  const turnKey = focus.kind === 'turn' ? focus.question : -1;

  // In view as the panel opens, the page changes or a turn comes, after the panel lays out.
  useEffect(() => {
    if (!panelOpen || !root.current) return;
    const el = root.current;
    const frame = requestAnimationFrame(() => scrollToTurn(el, turnKey >= 0));
    return () => cancelAnimationFrame(frame);
  }, [panelOpen, pathname, turnKey]);

  // The other topics, once listed: the chips' end in view.
  useEffect(() => {
    if (!picking || !root.current) return;
    scrollToTurn(root.current, false);
  }, [picking]);

  if (!tour) return null;
  return (
    <div ref={root} data-slot="tour-controls" className="flex flex-col gap-2 pb-1">
      <div className="flex flex-wrap gap-1.5">
        {unexplained && (
          <button
            type="button"
            data-action="tour.showPage"
            disabled={busy}
            onClick={() => void tour.show(topic, 'topic')}
            className={cn(TOUR_CHIP, TOUR_CHIP_PRIMARY)}
          >
            {t('showPage')}
          </button>
        )}
        {next && (
          <button
            type="button"
            data-action="tour.next"
            disabled={busy}
            onClick={() => void tour.show(next, 'next')}
            className={cn(TOUR_CHIP, TOUR_CHIP_PRIMARY)}
          >
            {t('next', { topic: t(`topics.${next}`) })}
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        )}
        {!unexplained && TOUR_ACTION_TOPICS.includes(topic) && (
          <button
            type="button"
            data-action="tour.topicAction"
            disabled={busy || disabled}
            onClick={() => {
              track('chat_tour_action', { topic });
              send(t(`actions.${topic as 'prompts'}`));
            }}
            className={TOUR_CHIP}
          >
            {t(`actions.${topic as 'prompts'}`)}
          </button>
        )}
        <button
          type="button"
          data-action="tour.another"
          aria-expanded={picking}
          disabled={busy}
          onClick={() => setPicking((was) => !was)}
          className={cn(TOUR_CHIP, picking && 'bg-muted')}
        >
          {t('another')}
        </button>
        <button
          type="button"
          data-action="tour.end"
          disabled={busy}
          onClick={() => void tour.end()}
          className={cn(TOUR_CHIP, !next && !unexplained && TOUR_CHIP_PRIMARY)}
        >
          {t('end')}
        </button>
      </div>
      {picking && (
        <div role="group" aria-label={t('anotherLabel')} className="flex flex-wrap gap-1.5">
          {TOUR_TOPICS.filter((other) => other !== topic).map((other) => (
            <button
              key={other}
              type="button"
              data-action="tour.pick"
              data-topic={other}
              disabled={busy}
              onClick={() => {
                setPicking(false);
                void tour.show(other, 'topic');
              }}
              className={TOUR_CHIP}
            >
              {t(`topics.${other}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
