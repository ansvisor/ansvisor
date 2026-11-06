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
