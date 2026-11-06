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
import { useRouter } from '@/i18n/navigation';
import { endChatTour, showTourTopic } from '@/lib/actions/chat-tour';
import { track } from '@/lib/analytics';
import {
  nextTopicOf,
  TOUR_ACTION_TOPICS,
  TOUR_PAGES,
  TOUR_TOPICS,
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
  const openChat = panel?.openChat;

  const show = useCallback(
    async (topic: TourTopic, via: TourVia) => {
      if (working.current) return;
      working.current = true;
      setBusy(true);
      const result = await showTourTopic({ topic, via, brandId }).catch(() => ({
        ok: false as const,
      }));
      working.current = false;
      setBusy(false);
      if (!result.ok || !result.chatId) {
        toast.error(t('failed'));
        return;
      }
      track('chat_tour_topic', { topic, via });
      setTour({ chatId: result.chatId, topic, finished: false });
      router.push(TOUR_PAGES[topic]);
      // The panel opens with the page, on the tour's chat read again.
      openChat?.(result.chatId);
    },
    [brandId, openChat, router, t],
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
    setTour((was) => ({ ...was, chatId: result.chatId, finished: true }));
    if (result.chatId) openChat?.(result.chatId);
  }, [openChat, t, tour.topic]);

  const value = useMemo<ChatTourState>(
    () => ({
      ...tour,
      available,
      active: tour.topic !== null && !tour.finished,
      busy,
      show,
      end,
    }),
    [tour, available, busy, show, end],
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

/**
 * The tour's chips under the latest turn: Next: {topic} → (End the tour
 * after the last), the topic's own step in Chat, Another topic (the other
 * topics, to pick one) and End the tour. Brought into view as a topic
 * opens, above the panel's composer that sits over the chat's bottom. `send`
 * asks Chat in this chat, as the box does.
 */
export function TourControls({
  topic,
  send,
  disabled = false,
}: {
  topic: TourTopic;
  send: (message: string) => void;
  /** Chat is paused (the AI limit): the topic's step in Chat waits. */
  disabled?: boolean;
}) {
  const t = useTranslations('chatTour');
  const tour = useChatTour();
  const [picking, setPicking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const next = nextTopicOf(topic);
  const busy = !!tour?.busy;

  // In view as a topic opens, and with the other topics once they are listed.
  useEffect(() => {
    root.current?.scrollIntoView?.({ block: 'nearest' });
  }, [topic, picking]);

  if (!tour) return null;
  return (
    <div ref={root} data-slot="tour-controls" className="flex scroll-mb-48 flex-col gap-2 pb-1">
      <div className="flex flex-wrap gap-1.5">
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
        {TOUR_ACTION_TOPICS.includes(topic) && (
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
          className={cn(TOUR_CHIP, !next && TOUR_CHIP_PRIMARY)}
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
