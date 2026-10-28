/**
 * The longest a topic's name may be. Setup's prompt generation takes topics
 * up to this many characters (server/src/lib/brand-setup-input.js, #1611
 * follow-up), and a topic is a few words, so the Topics pages stop there and
 * the actions refuse more: a longer name would make Generate fail.
 */
export const TOPIC_NAME_CHARS = 100;

/** Whether a topic name, trimmed, fits. */
export const topicNameFits = (name: string) => name.trim().length <= TOPIC_NAME_CHARS;
