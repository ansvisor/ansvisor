import { cleanPromptText } from '@/lib/prompt-text';

/** How many prompts Generate by topic asks for each topic, as the API writes them. */
export const PROMPTS_PER_TOPIC = 5;

/** One prompt written for a topic, as Generate by topic lists it for review. */
export interface TopicPromptItem {
  /** Unique within a round of generation, so a new round starts every row afresh. */
  key: string;
  topicId: string;
  /** The topic's name, as the brand keeps it: the prompt is saved under it. */
  topic: string;
  /** The text to save: as written, or as edited. */
  text: string;
  /** The text as written, to tell an edited one. */
  original: string;
  /** Ticked: Add selected saves it. Every row starts ticked. */
  on: boolean;
}

const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The API's per-topic groups as rows to review, each under the brand's own
 * topic it was asked for: matched by name, case and spacing aside, else by
 * its place when every topic came back (the API answers in the order asked).
 * A group that matches no topic is left out rather than saved under a name
 * the brand doesn't have. At most PROMPTS_PER_TOPIC a topic, empty ones left out.
 */
export function matchTopicPrompts(
  topics: readonly { id: string; name: string }[],
  groups: readonly { topic: string; prompts: readonly string[] }[],
  round: number = Date.now(),
): TopicPromptItem[] {
  const byName = new Map(topics.map((topic) => [nameKey(topic.name), topic]));
  const used = new Set<string>();
  const items: TopicPromptItem[] = [];
  groups.forEach((group, i) => {
    const topic =
      byName.get(nameKey(String(group.topic ?? ''))) ??
      (groups.length === topics.length ? topics[i] : undefined);
    if (!topic || used.has(topic.id)) return;
    used.add(topic.id);
    const texts = (Array.isArray(group.prompts) ? group.prompts : [])
      .map(cleanPromptText)
      .filter((text): text is string => text !== null)
      .slice(0, PROMPTS_PER_TOPIC);
    texts.forEach((text, j) => {
      items.push({
        key: `${round}:${topic.id}:${j}`,
        topicId: topic.id,
        topic: topic.name,
        text,
        original: text,
        on: true,
      });
    });
  });
  return items;
}
