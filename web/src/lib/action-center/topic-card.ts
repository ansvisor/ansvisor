import { isCardHidden, topicKey } from '@/lib/user-brand-state';

/**
 * "New area to track" on Action Center › Today (simplification
 * plan PR 17): one topic the brand doesn't track yet, when stored data makes
 * a strong case for it. Pure: the server action reads, this picks.
 *
 * A candidate comes from stored data only, never a model call:
 *   catalog       a catalog category no topic covers (topic_suggestions,
 *                 source catalog, 00525), strong with 3+ products
 *   search        3+ Search Console or Analytics prompt ideas under one
 *                 topic name the brand doesn't track
 *   business_hub  2+ ChatGPT Business Hub prompt ideas (00527) under one
 *                 discovery topic the brand doesn't track
 * Two more only add to why, and are never a card on their own:
 *   llm           a topic idea of the model's of the same name
 *   competitors   rivals AI answers named in the topic, where stored
 *                 answers exist for it
 * One card at a time; Not now snoozes its topic for the person for 30 days.
 */

/** A card only once the workspace is this many days old (its first brand). */
export const ACCOUNT_MIN_DAYS = 14;

/** Not now hides the topic this long. */
export const SNOOZE_DAYS = 30;

/** Prompts the card suggests, and the spots it says they need. */
export const TOPIC_PROMPTS = 5;

/** The least evidence each source needs for a card. */
export const STRONG = { catalogProducts: 3, searchIdeas: 3, businessHubIdeas: 2 } as const;

const DAY_MS = 86_400_000;

/** The source a card stands on, for events: the first strong one in this order. */
export type TopicSource = 'catalog' | 'search' | 'business_hub';

export interface TopicCandidate {
  /** The topic's name, case and spacing aside: what Not now keeps (topic:<key>). */
  key: string;
  /** The name the topic is made with. */
  name: string;
  source: TopicSource;
  catalog: { suggestionId: string; category: string; products: number } | null;
  search: { count: number; sources: ('gsc' | 'ga')[] } | null;
  businessHub: { count: number } | null;
  /** The model's topic idea of the same name, accepted with the topic. */
  llmSuggestionId: string | null;
  /** The brand's topic of that name, with no prompt tracked or waiting in it. */
  topicId: string | null;
  /** Rivals named in the topic's stored answers; empty when none are stored. */
  competitors: string[];
}

export interface TopicSuggestionRow {
  id: string;
  name: string;
  source: string;
  sourceData: unknown;
}

export interface PromptIdeaRow {
  id: string;
  topicId: string | null;
  topicName: string | null;
  source: string;
  /** Business Hub ideas stay 30 days; one past it no longer counts. */
  expiresAt: string | null;
}

export interface PickInput {
  /** The brand's open topic suggestions (status new). */
  topicSuggestions: TopicSuggestionRow[];
  /** The brand's open prompt ideas (status new) from gsc, ga and business_hub. */
  promptIdeas: PromptIdeaRow[];
  /** The brand's active topics. */
  topics: { id: string; name: string }[];
  /** Topics with a prompt tracked or waiting for a spot: covered already. */
  coveredTopicIds: ReadonlySet<string>;
  /** The person's hidden cards (user_brand_state.hidden). */
  hidden: Record<string, string | null>;
  now: Date;
}

/** A name as two are compared and Not now keeps it: trimmed, one space, lower case. */
export function nameKey(name: string): string {
  return name
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 120)
    .trim();
}

/** Whether the workspace is old enough for the card: its first brand at least 14 days ago. */
export function accountOldEnough(firstBrandAt: string | null, now: Date): boolean {
  if (!firstBrandAt) return false;
  const at = Date.parse(firstBrandAt);
  return Number.isFinite(at) && now.getTime() - at >= ACCOUNT_MIN_DAYS * DAY_MS;
}

/**
 * Whether it is the card's time: the person's Monday, under Last week, or
 * once today's focus is finished (read, and nothing open left in it).
 * `focus` is null while it reads or when it failed.
 */
export function topicCardTime(monday: boolean, focus: readonly unknown[] | null): boolean {
  return monday || (focus !== null && focus.length === 0);
}

/** When Not now hides the topic until. */
export function snoozeUntil(now: Date): Date {
  return new Date(now.getTime() + SNOOZE_DAYS * DAY_MS);
}

/**
 * Which of the card's prompts wait for a spot, by place: the ticked ones,
 * in order, past the spots left on the plan (each prompt the card adds
 * takes one, at the brand's location). None waits when the spots are
 * unlimited or unread (null).
 */
export function waitingMarks(
  count: number,
  ticked: ReadonlySet<number>,
  left: number | null,
): boolean[] {
  const marks: boolean[] = [];
  let place = 0;
  for (let i = 0; i < count; i++) {
    const on = ticked.has(i);
    marks.push(on && left !== null && place >= left);
    if (on) place += 1;
  }
  return marks;
}

/** A catalog suggestion's category and products, in the shape 00525 keeps it. */
function catalogOf(data: unknown): { category: string; products: number } | null {
  if (typeof data !== 'object' || data === null) return null;
  const { category, products } = data as { category?: unknown; products?: unknown };
  if (typeof category !== 'string' || !category.trim()) return null;
  const count = Number(products);
  return { category: category.trim(), products: Number.isFinite(count) ? count : 0 };
}

interface Draft {
  key: string;
  name: string | null;
  catalog: TopicCandidate['catalog'];
  search: { count: number; sources: Set<'gsc' | 'ga'> };
  businessHub: number;
  llmSuggestionId: string | null;
  topicIds: Set<string>;
}

const strength = (c: TopicCandidate) => [c.catalog, c.search, c.businessHub].filter(Boolean).length;
const weight = (c: TopicCandidate) =>
  (c.catalog?.products ?? 0) + (c.search?.count ?? 0) + (c.businessHub?.count ?? 0);

/**
 * Every strong candidate the brand has, best first: the most strong sources,
 * then one the model also had as an idea, then the most evidence (products
 * and ideas), then by name. A topic the brand tracks or keeps waiting is
 * left out, by name or by the ideas' topic, and so is one the person
 * snoozed. Competitors are read afterwards, for the one picked.
 */
export function topicCandidates(input: PickInput): TopicCandidate[] {
  const drafts = new Map<string, Draft>();
  const draft = (name: string): Draft | null => {
    const key = nameKey(name);
    if (!key) return null;
    let found = drafts.get(key);
    if (!found) {
      found = {
        key,
        name: null,
        catalog: null,
        search: { count: 0, sources: new Set() },
        businessHub: 0,
        llmSuggestionId: null,
        topicIds: new Set(),
      };
      drafts.set(key, found);
    }
    return found;
  };
  const nameOf = (d: Draft, name: string) => {
    d.name ??= name.replace(/\s+/g, ' ').trim();
  };

  for (const row of input.topicSuggestions) {
    if (row.source !== 'catalog') continue;
    const catalog = catalogOf(row.sourceData);
    const d = catalog ? draft(row.name) : null;
    if (!d || !catalog || (d.catalog && d.catalog.products >= catalog.products)) continue;
    nameOf(d, row.name);
    d.catalog = { suggestionId: row.id, ...catalog };
  }

  const now = input.now.getTime();
  for (const idea of input.promptIdeas) {
    if (!idea.topicName) continue;
    if (idea.topicId && input.coveredTopicIds.has(idea.topicId)) continue;
    const d =
      idea.source === 'gsc' || idea.source === 'ga' || idea.source === 'business_hub'
        ? draft(idea.topicName)
        : null;
    if (!d) continue;
    if (idea.source === 'business_hub') {
      if (idea.expiresAt && Date.parse(idea.expiresAt) <= now) continue;
      d.businessHub += 1;
    } else {
      d.search.count += 1;
      d.search.sources.add(idea.source as 'gsc' | 'ga');
    }
    nameOf(d, idea.topicName);
    if (idea.topicId) d.topicIds.add(idea.topicId);
  }

  // The model's ideas only add to a candidate the stored data made.
  for (const row of input.topicSuggestions) {
    if (row.source !== 'llm') continue;
    const d = drafts.get(nameKey(row.name));
    if (d && !d.llmSuggestionId) d.llmSuggestionId = row.id;
  }

  const topicByKey = new Map(input.topics.map((t) => [nameKey(t.name), t.id]));
  const candidates: TopicCandidate[] = [];
  for (const d of drafts.values()) {
    const named = topicByKey.get(d.key);
    if (named) d.topicIds.add(named);
    if ([...d.topicIds].some((id) => input.coveredTopicIds.has(id))) continue;
    if (isCardHidden(input.hidden, topicKey(d.key), input.now)) continue;
    const catalog = d.catalog && d.catalog.products >= STRONG.catalogProducts ? d.catalog : null;
    const search =
      d.search.count >= STRONG.searchIdeas
        ? { count: d.search.count, sources: [...d.search.sources].sort() }
        : null;
    const businessHub = d.businessHub >= STRONG.businessHubIdeas ? { count: d.businessHub } : null;
    const source: TopicSource | null = catalog
      ? 'catalog'
      : search
        ? 'search'
        : businessHub
          ? 'business_hub'
          : null;
    if (!source) continue;
    candidates.push({
      key: d.key,
      name: d.name ?? d.key,
      source,
      catalog,
      search,
      businessHub,
      llmSuggestionId: d.llmSuggestionId,
      // The brand's topic of that name first: it is the one the prompts go under.
      topicId: named ?? [...d.topicIds][0] ?? null,
      competitors: [],
    });
  }
  return candidates.sort(
    (a, b) =>
      strength(b) - strength(a) ||
      Number(Boolean(b.llmSuggestionId)) - Number(Boolean(a.llmSuggestionId)) ||
      weight(b) - weight(a) ||
      a.key.localeCompare(b.key),
  );
}

/** The card's one candidate, or null when the brand has no strong one. */
export function pickTopicCandidate(input: PickInput): TopicCandidate | null {
  return topicCandidates(input)[0] ?? null;
}
