/**
 * A person's Today and menu state on one brand (user_brand_state, 00529):
 * when they last opened each menu area, the Today focus they keep, and the
 * cards they hid or snoozed. Kept on the server, so it holds on every device.
 *
 * The pure half: the shapes, the names the database accepts, and how a row
 * is read and changed. The server actions in lib/actions/user-brand-state.ts
 * read and write the row as the person.
 */

/**
 * The menu areas a dot or Today compares with the person's last visit
 * (simplification plan §4). `content` is the exact /dashboard/content page;
 * `today` is Action Center › Today.
 */
export const NAV_AREAS = [
  'today',
  'action-center/actions',
  'insights',
  'mentions',
  'citations',
  'prompts/tracked',
  'prompts/suggestions',
  'traffic',
  'content',
] as const;

export type NavArea = (typeof NAV_AREAS)[number];

/** Today's focus holds 3 actions at most (00529 checks it too). */
export const FOCUS_MAX = 3;

/** Each jsonb column's cap in the database, as its text (00529). */
export const STATE_MAX_BYTES = 8192;

/** An action the person keeps in Today's focus, and when it took its slot. */
export interface FocusPin {
  id: string;
  addedAt: string;
}

/**
 * The person's state on a brand. `hidden` maps a card's key to the time it
 * shows again, or null when it is hidden for good; a key whose time has
 * passed is left out when read.
 */
export interface UserBrandState {
  navSeen: Partial<Record<NavArea, string>>;
  focus: FocusPin[];
  hidden: Record<string, string | null>;
}

/** The row's columns as the database keeps them. */
export interface UserBrandStateRow {
  nav_seen?: unknown;
  focus?: unknown;
  hidden?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The cards a person can hide, by key:
 *   setup          "Finish setting up" (someone who isn't an admin or manager)
 *   prompts_check  a brand's first day: "Check the prompts we track"
 *   topic:<key>    "New area to track", Not now; the key names the topic:
 *                  1–120 characters, no control characters, trimmed
 *   skip:<id>      a focus card's "Skip for now"; the id is the action's
 */
const HIDDEN_KEY =
  /^(?:setup|prompts_check|topic:[^\s\p{Cc}](?:[^\p{Cc}]{0,118}[^\s\p{Cc}])?|skip:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;

export function isNavArea(value: unknown): value is NavArea {
  return typeof value === 'string' && (NAV_AREAS as readonly string[]).includes(value);
}

export function isHiddenKey(value: unknown): value is string {
  return typeof value === 'string' && HIDDEN_KEY.test(value);
}

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** The key a focus card's "Skip for now" hides. */
export const skipKey = (actionId: string) => `skip:${actionId.toLowerCase()}`;

/** The key "New area to track"'s Not now snoozes. */
export const topicKey = (key: string) => `topic:${key.trim()}`;

/** A time as the database keeps it (ISO, UTC), or null when it isn't one. */
export function isoTime(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The menu areas the row names, with a readable time; anything else is left out. */
export function readNavSeen(value: unknown): UserBrandState['navSeen'] {
  if (!isObject(value)) return {};
  const seen: UserBrandState['navSeen'] = {};
  for (const [area, at] of Object.entries(value)) {
    const time = isoTime(at);
    if (isNavArea(area) && time) seen[area] = time;
  }
  return seen;
}

/** The focus the row keeps: up to 3 actions, each once, with a readable time. */
export function readFocus(value: unknown): FocusPin[] {
  if (!Array.isArray(value)) return [];
  const pins: FocusPin[] = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const addedAt = isoTime(item.added_at);
    if (!isUuid(item.id) || !addedAt) continue;
    const id = item.id.toLowerCase();
    if (pins.some((pin) => pin.id === id)) continue;
    pins.push({ id, addedAt });
    if (pins.length === FOCUS_MAX) break;
  }
  return pins;
}

/** The cards hidden at `now`: for good (null), or until a time still ahead. */
export function readHidden(value: unknown, now: Date): UserBrandState['hidden'] {
  if (!isObject(value)) return {};
  const hidden: UserBrandState['hidden'] = {};
  for (const [key, until] of Object.entries(value)) {
    if (!isHiddenKey(key)) continue;
    if (until === null) hidden[key] = null;
    else {
      const time = isoTime(until);
      if (time && Date.parse(time) > now.getTime()) hidden[key] = time;
    }
  }
  return hidden;
}

/** The person's state from their row (none yet: the empty state). */
export function parseUserBrandState(
  row: UserBrandStateRow | null | undefined,
  now: Date,
): UserBrandState {
  if (!row) return { navSeen: {}, focus: [], hidden: {} };
  return {
    navSeen: readNavSeen(row.nav_seen),
    focus: readFocus(row.focus),
    hidden: readHidden(row.hidden, now),
  };
}

/** Whether the card is hidden at `now`. */
export function isCardHidden(
  hidden: UserBrandState['hidden'],
  key: string,
  now: Date = new Date(),
): boolean {
  if (!(key in hidden)) return false;
  const until = hidden[key];
  return until === null || Date.parse(until) > now.getTime();
}

/**
 * nav_seen's other keys (the pages' own dots, components/layout/page-dot.tsx):
 * when the person last looked at a part of a page, or opened one action.
 *   audit/auto           the Audit page, for its Auto-audit line
 *   audit/opportunities  the Audit page's Opportunities tab
 *   action:<id>          an action's drawer
 */
export const PAGE_SEEN_KEYS = ['audit/auto', 'audit/opportunities'] as const;
export type PageSeenKey = (typeof PAGE_SEEN_KEYS)[number];

const ACTION_SEEN_KEY = /^action:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The key an action's drawer keeps its last opening under. */
export const actionSeenKey = (actionId: string) => `action:${actionId.toLowerCase()}`;

export function isSeenKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ((PAGE_SEEN_KEYS as readonly string[]).includes(value) || ACTION_SEEN_KEY.test(value))
  );
}

/**
 * An action's opening is kept this long, and for this many actions at most,
 * so nav_seen stays small (about 5 KB of its 8). An action's green dot only
 * compares an outcome measured within as long (ITEM_SEEN_DAYS): one opened
 * before that was opened before the outcome too.
 */
export const ITEM_SEEN_DAYS = 30;
export const ITEM_SEEN_MAX = 60;

/** The page keys the row names, with a readable time; anything else is left out. */
export function readSeenKeys(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  const seen: Record<string, string> = {};
  for (const [key, at] of Object.entries(value)) {
    const time = isoTime(at);
    if (isSeenKey(key) && time) seen[key] = time;
  }
  return seen;
}

/** The page keys, less actions opened over ITEM_SEEN_DAYS ago or beyond the newest ITEM_SEEN_MAX. */
function prunedSeenKeys(seen: Record<string, string>, now: Date): Record<string, string> {
  const since = now.getTime() - ITEM_SEEN_DAYS * 24 * 60 * 60_000;
  const actions = Object.keys(seen)
    .filter((key) => key.startsWith('action:') && Date.parse(seen[key]) >= since)
    .sort((a, b) => Date.parse(seen[b]) - Date.parse(seen[a]))
    .slice(0, ITEM_SEEN_MAX);
  const kept: Record<string, string> = {};
  for (const key of Object.keys(seen)) {
    if (!key.startsWith('action:') || actions.includes(key)) kept[key] = seen[key];
  }
  return kept;
}

/** nav_seen with `area` seen at `at`; the page keys stay. */
export function withSeen(current: unknown, area: NavArea, at: Date): Record<string, string> {
  return { ...readSeenKeys(current), ...readNavSeen(current), [area]: at.toISOString() };
}

/** nav_seen with the page key `key` seen at `at`; the menu areas stay. */
export function withSeenKey(current: unknown, key: string, at: Date): Record<string, string> {
  const seen = prunedSeenKeys({ ...readSeenKeys(current), [key]: at.toISOString() }, at);
  return { ...readNavSeen(current), ...seen };
}

/** The focus as the database keeps it. */
export function focusColumn(pins: readonly FocusPin[]): { id: string; added_at: string }[] {
  return pins.map((pin) => ({ id: pin.id, added_at: pin.addedAt }));
}

/**
 * The bytes a flat object of short strings takes as jsonb text, at most:
 * PostgreSQL writes `{"a": "b", "c": null}`, a space after each colon and
 * comma that JSON.stringify leaves out.
 */
export function jsonbTextBytes(value: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(value)).length + 2 * Object.keys(value).length;
}

/** Soonest first; hidden for good last. */
function soonestFirst(a: string | null, b: string | null): number {
  const at = (until: string | null) => (until === null ? Infinity : Date.parse(until));
  return at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1;
}

/**
 * hidden with `key` hidden until `until` (null: for good). What has expired
 * goes; when the rest would pass the database's cap, the cards that show
 * again soonest go first, then those hidden for good. `key` itself stays.
 */
export function withHidden(
  current: unknown,
  key: string,
  until: string | null,
  now: Date,
): Record<string, string | null> {
  const hidden = { ...readHidden(current, now), [key]: until };
  const others = Object.keys(hidden)
    .filter((other) => other !== key)
    .sort((a, b) => soonestFirst(hidden[a], hidden[b]));
  while (jsonbTextBytes(hidden) > STATE_MAX_BYTES && others.length > 0) {
    delete hidden[others.shift()!];
  }
  return hidden;
}
