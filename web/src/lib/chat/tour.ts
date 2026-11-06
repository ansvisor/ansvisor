/**
 * Chat's product tour (owner decision 2026-11-06): the topics Chat Home's
 * welcome card offers, in the order "Show me everything" walks them, and
 * the page each one opens. Their names are `chatTour.topics.{topic}` in
 * messages/en.json; chat_user_prefs.tour_topic (00486) keeps the same ids.
 * The tour's words are lib/chat/tour-script.ts's (server only).
 */

export const TOUR_TOPICS = [
  'visibility',
  'prompts',
  'positions',
  'content',
  'connections',
] as const;

export type TourTopic = (typeof TOUR_TOPICS)[number];

/** The page each topic opens. */
export const TOUR_PAGES: Readonly<Record<TourTopic, `/dashboard/${string}`>> = {
  visibility: '/dashboard/insights',
  prompts: '/dashboard/prompts',
  // Tracked Prompts' table, with its Positions column and the Locations view.
  positions: '/dashboard/prompts/tracked',
  // Content's first page: Opportunities.
  content: '/dashboard/content',
  connections: '/dashboard/settings/integrations',
};

/** Whether a value is one of the tour's topics. */
export function isTourTopic(value: unknown): value is TourTopic {
  return typeof value === 'string' && (TOUR_TOPICS as readonly string[]).includes(value);
}

/** How a topic was asked for: its chip (or Another topic), Next, or Show me everything. */
export const TOUR_VIAS = ['topic', 'next', 'everything'] as const;
export type TourVia = (typeof TOUR_VIAS)[number];

/** The topic after this one, for Next; null after the last. */
export function nextTopicOf(topic: TourTopic): TourTopic | null {
  return TOUR_TOPICS[TOUR_TOPICS.indexOf(topic) + 1] ?? null;
}

/**
 * A topic's own next step in Chat, as a chip beside Next: its message (and
 * label) is `chatTour.actions.{topic}`, and it starts a normal Chat run.
 */
export const TOUR_ACTION_TOPICS: readonly TourTopic[] = ['prompts'];

/**
 * The tour's topics a page of the app is about, in the tour's order: the
 * page a topic opens and the pages under it. Visibility's tabs (Mentions,
 * Citations) are Visibility's; every Prompts page is both Topics and
 * prompts and Positions and locations (they open the same table). None for
 * a page no topic explains.
 */
export function tourTopicsOfPath(pathname: string): TourTopic[] {
  const under = (root: string) => pathname === root || pathname.startsWith(`${root}/`);
  if (['/dashboard/insights', '/dashboard/mentions', '/dashboard/citations'].some(under)) {
    return ['visibility'];
  }
  if (under('/dashboard/prompts')) return ['prompts', 'positions'];
  if (under('/dashboard/content') && !under('/dashboard/content/editor')) return ['content'];
  if (under('/dashboard/settings/integrations')) return ['connections'];
  return [];
}

/** A tour turn in the tour's chat: its topic, and where its line and its answer are. */
export interface TourTurn {
  topic: TourTopic;
  /** The person's line ("Show me Visibility"), by its place in the chat. */
  question: number;
}

/**
 * What the side panel shows of the tour on a page (owner decision
 * 2026-11-06), from the tour's turns in the chat (`turns`, in order):
 *
 *   - `turn`: the page's topic was explained: the latest turn about it, which
 *     the panel brings into view and marks, with the chips under it (Next
 *     from that topic).
 *   - `unexplained`: the page is a topic not explained yet (reached from the
 *     menu): no other page's turn in focus, "Show me this page" at the end.
 *   - `newest`: a page no topic explains: the chat's newest turn, the chips
 *     from the topic the tour is on.
 */
export type TourFocus =
  | { kind: 'turn'; topic: TourTopic; question: number }
  | { kind: 'unexplained'; topic: TourTopic }
  | { kind: 'newest'; topic: TourTopic };

export function tourFocusOf({
  pathname,
  turns,
  current,
}: {
  pathname: string;
  turns: readonly TourTurn[];
  /** The topic the tour is on (chat_user_prefs.tour_topic). */
  current: TourTopic;
}): TourFocus {
  const topics = tourTopicsOfPath(pathname);
  if (topics.length === 0) return { kind: 'newest', topic: current };
  const latest = [...turns].reverse().find((turn) => topics.includes(turn.topic));
  if (latest) return { kind: 'turn', topic: latest.topic, question: latest.question };
  return { kind: 'unexplained', topic: topics[0] };
}
