import { getDateRange } from '@/lib/date-range';

/**
 * Chat's date range (owner request 2026-11-11): the period a read covers
 * when the person's message names none. Asked once, before the first
 * analysis that reads data (the engine's own question card), then kept per
 * person (chat_user_prefs.date_range, 00528) for the main Chat and the side
 * panel alike, in every brand. A short message ("last 7d", "son 7d",
 * "varsayılanı 90d yap") changes it; a period inside a question ("how was
 * last week?") is used for that answer only.
 *
 * Its presets are the app's own (lib/date-range.ts getDateRange), so the
 * same preset covers the same days in Chat as on Visibility: "Last 30 days"
 * is today and the 29 days before, in whole UTC days; "Last 24 hours" is a
 * rolling window. Pure: the engine, the composer and Chat Settings read it.
 */

/** The ranges Chat offers, as the app's date control names them. */
export const RANGE_PRESETS = ['24h', '7d', '30d', '90d'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** A person's range: a preset, or a custom one as "YYYY-MM-DD/YYYY-MM-DD" (first and last day). */
export type ChatRange = RangePreset | `${string}/${string}`;

/** What a read takes when no range is set and nobody can be asked: the app's 30 days. */
export const FALLBACK_RANGE: RangePreset = '30d';

/** What the range card recommends with no page range: the app's pages' own default. */
export const RECOMMENDED_RANGE: RangePreset = '30d';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (at: Date | number) => new Date(at).toISOString().slice(0, 10);

/** A calendar day as written ("2026-10-01"), when it is one. */
function isDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(at) && dayOf(at) === value;
}

export const isRangePreset = (value: unknown): value is RangePreset =>
  typeof value === 'string' && (RANGE_PRESETS as readonly string[]).includes(value);

/**
 * A range as kept or sent, or null when it isn't one: a preset, or two days,
 * the first not after the second and, given `now`, neither after today.
 */
export function parseRange(value: unknown, now?: Date): ChatRange | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (isRangePreset(text)) return text;
  const [from, to, ...rest] = text.split('/');
  if (rest.length > 0 || !from || !to || !isDay(from) || !isDay(to)) return null;
  if (from > to || from < '2000-01-01') return null;
  if (now && to > dayOf(now)) return null;
  return `${from}/${to}`;
}

/** A custom range's two days; null for a preset. */
export function customDays(range: ChatRange): { from: string; to: string } | null {
  if (isRangePreset(range)) return null;
  const [from, to] = range.split('/');
  return { from, to };
}

/** The days a range covers, counting both ends; 1 for the last 24 hours. */
export function rangeDays(range: ChatRange): number {
  if (range === '24h') return 1;
  const custom = customDays(range);
  if (!custom) return Number.parseInt(range, 10);
  return Math.round((Date.parse(custom.to) - Date.parse(custom.from)) / DAY_MS) + 1;
}

/** A read's window: what goes in its date_from and date_to. */
export interface RangeWindow {
  dateFrom: string;
  dateTo: string;
}

/**
 * The window a range covers on `now`, as the app's pages read it
 * (getDateRange): a preset's whole UTC days (the 24 hours rolling), a
 * custom range's days as picked.
 */
export function rangeWindow(range: ChatRange, now: Date): RangeWindow {
  const custom = customDays(range);
  if (custom) return { dateFrom: custom.from, dateTo: custom.to };
  const window = getDateRange(range as RangePreset, { from: '', to: '' }, now);
  return {
    dateFrom: window.days?.dayFrom ?? window.dateFrom ?? dayOf(now.getTime() - DAY_MS),
    dateTo: window.days?.dayTo ?? dayOf(now),
  };
}

/**
 * The days back a read that takes `days` covers: the preset's, or a custom
 * range's from its first day to today, at most `max`.
 */
export function rangeDaysBack(range: ChatRange, now: Date, max: number): number {
  const custom = customDays(range);
  const days = custom
    ? Math.round((Date.parse(dayOf(now)) - Date.parse(custom.from)) / DAY_MS) + 1
    : rangeDays(range);
  return Math.max(1, Math.min(days, max));
}

// ─── In words ───────────────────────────────────────────────────────────────

/** A translator for the `chatRange` messages. */
export type RangeT = (key: string, values?: Record<string, string | number>) => string;

const short = (day: string, year: boolean) =>
  new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });

/** A custom range's two days in words ("Oct 1 – Oct 15"), with years when not this one. */
function customWords(custom: { from: string; to: string }, now: Date) {
  const year = String(now.getUTCFullYear());
  const years = !custom.from.startsWith(year) || !custom.to.startsWith(year);
  return { from: short(custom.from, years), to: short(custom.to, years) };
}

/**
 * A range in words: "Last 24 hours", "Last 7 days", "Oct 1 – Oct 15"; `as`
 * the card's first button for the page's own range ("This page's range:
 * last 7 days"), or the line under the message box ("Range: last 7 days").
 */
export function rangeWords(
  range: ChatRange,
  t: RangeT,
  { as, now = new Date() }: { as?: 'page' | 'line'; now?: Date } = {},
): string {
  const key = (name: 'day' | 'days' | 'custom') =>
    as ? `${as}${name[0].toUpperCase()}${name.slice(1)}` : name;
  const custom = customDays(range);
  if (custom) return t(key('custom'), customWords(custom, now));
  if (range === '24h') return t(key('day'));
  return t(key('days'), { days: rangeDays(range) });
}

/**
 * A range as the models are told it, in English: "the last 7 days", "the
 * last 24 hours", "Oct 1 to Oct 15". Never shown: the person reads the
 * answer, in their language.
 */
export function rangePhrase(range: ChatRange, now: Date = new Date()): string {
  const custom = customDays(range);
  if (custom) {
    const words = customWords(custom, now);
    return `${words.from} to ${words.to}`;
  }
  return range === '24h' ? 'the last 24 hours' : `the last ${rangeDays(range)} days`;
}

// ─── In a message ───────────────────────────────────────────────────────────

/** Words before a count that make it a period back from today. */
const PREFIX = String.raw`(?:(?:in\s+)?the\s+(?:last|past)|last|past|previous|prior|son|geçen|geçtiğimiz|önceki)`;
const COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  six: 6,
  twelve: 12,
  bir: 1,
  iki: 2,
  üç: 3,
  dört: 4,
  altı: 6,
};
const COUNT = String.raw`(\d{1,3}|${Object.keys(COUNT_WORDS).join('|')})`;
/** A unit, in English and Turkish (with the endings Turkish adds: "son 7 günde", "son 3 ayda"). */
const UNIT = String.raw`(h|hrs?|hours?|saat(?:te|tir|lik|in|ler)?|d|days?|gün(?:de|dür|lük|ün|ler|lerde|lerin|e)?|w|wks?|weeks?|hafta(?:da|dır|lık|nın|lar|ya|yı)?|mo|mos|months?|ay(?:da|dır|lık|ın|ı|lar|larda)?|quarters?|çeyrek(?:te|lik|in)?)`;
const EDGE_BEFORE = String.raw`(?<![\p{L}\d])`;
const EDGE_AFTER = String.raw`(?![\p{L}\d])`;

/** "last 7 days", "son 7d", "past two weeks", "7d", "24h", "3mo". */
const STRICT_COUNT = new RegExp(
  `${EDGE_BEFORE}(?:${PREFIX}\\s+${COUNT}\\s*-?\\s*${UNIT}|(\\d{1,3})(h|d|w|mo))${EDGE_AFTER}`,
  'iu',
);
/** In a short command only: a count and its unit without "last" ("use 90 days by default"). */
const LOOSE_COUNT = new RegExp(`${EDGE_BEFORE}(\\d{1,3})\\s*-?\\s*${UNIT}${EDGE_AFTER}`, 'iu');
/** Named periods: last week, last month, last quarter, yesterday, and their Turkish. */
const NAMED: { re: RegExp; days: number | 'yesterday' }[] = [
  {
    re: new RegExp(
      `${EDGE_BEFORE}(?:(?:last|past|previous)\\s+week|(?:geçen|geçtiğimiz|son|önceki)\\s+hafta(?:da|nın|ya|yı)?)${EDGE_AFTER}`,
      'iu',
    ),
    days: 7,
  },
  {
    re: new RegExp(
      `${EDGE_BEFORE}(?:(?:last|past|previous)\\s+month|(?:geçen|geçtiğimiz|son|önceki)\\s+ay(?:da|ın|ı)?)${EDGE_AFTER}`,
      'iu',
    ),
    days: 30,
  },
  {
    re: new RegExp(
      `${EDGE_BEFORE}(?:(?:last|past|previous)\\s+quarter|(?:geçen|geçtiğimiz|son|önceki)\\s+çeyrek(?:te|in)?)${EDGE_AFTER}`,
      'iu',
    ),
    days: 90,
  },
  { re: new RegExp(`${EDGE_BEFORE}(?:yesterday|dün)${EDGE_AFTER}`, 'iu'), days: 'yesterday' },
];

/** The range of the last `days` days, as the app's presets cut them where one fits. */
function lastDays(days: number, now: Date): ChatRange {
  if (days <= 1) return '24h';
  if (days === 7) return '7d';
  if (days === 30) return '30d';
  if (days === 90) return '90d';
  const n = Math.min(days, 731);
  return `${dayOf(now.getTime() - (n - 1) * DAY_MS)}/${dayOf(now)}`;
}

function countRange(count: string, unit: string, now: Date): ChatRange | null {
  const n = /^\d+$/.test(count) ? Number(count) : COUNT_WORDS[count.toLowerCase()];
  if (!n || n < 1) return null;
  const u = unit.toLowerCase();
  if (/^(h|hrs?|hours?|saat)/.test(u)) return n <= 24 ? '24h' : lastDays(Math.ceil(n / 24), now);
  if (/^(d|days?|gün)/.test(u)) return lastDays(n, now);
  if (/^(w|wks?|weeks?|hafta)/.test(u)) return lastDays(7 * n, now);
  if (/^(quarters?|çeyrek)/.test(u)) return lastDays(90 * n, now);
  if (/^(mo|mos|months?|ay)/.test(u)) return lastDays(30 * n, now);
  return null;
}

interface Found {
  range: ChatRange;
  start: number;
  end: number;
}

function findRange(text: string, now: Date, loose: boolean): Found | null {
  const found: Found[] = [];
  const counted = STRICT_COUNT.exec(text);
  if (counted) {
    const range = counted[1]
      ? countRange(counted[1], counted[2], now)
      : countRange(counted[3], counted[4], now);
    if (range) found.push({ range, start: counted.index, end: counted.index + counted[0].length });
  }
  for (const named of NAMED) {
    const m = named.re.exec(text);
    if (!m) continue;
    const range: ChatRange =
      named.days === 'yesterday'
        ? `${dayOf(now.getTime() - DAY_MS)}/${dayOf(now.getTime() - DAY_MS)}`
        : lastDays(named.days, now);
    found.push({ range, start: m.index, end: m.index + m[0].length });
  }
  if (found.length === 0 && loose) {
    const m = LOOSE_COUNT.exec(text);
    const range = m ? countRange(m[1], m[2], now) : null;
    if (m && range) found.push({ range, start: m.index, end: m.index + m[0].length });
  }
  // The first one written.
  return found.sort((a, b) => a.start - b.start)[0] ?? null;
}

/**
 * A period a message names, as a range: "last 7 days", "son 30 gün", "past
 * two weeks", "7d", "last week", "geçen ay", "yesterday"; null when it names
 * none. A count needs "last" (or its like) unless written short ("7d"), so
 * "a 30-day plan" is no period. Rounded to the app's presets where one
 * fits: "last week" is the last 7 days.
 */
export function rangeInText(text: string, now: Date): ChatRange | null {
  return findRange(text, now, false)?.range ?? null;
}

/** Words that ask nothing in a range command: "use", "son", "varsayılanı … yap". */
const FILLER = new Set([
  // English
  'last',
  'past',
  'the',
  'use',
  'using',
  'set',
  'switch',
  'change',
  'make',
  'it',
  'to',
  'as',
  'my',
  'default',
  'by',
  'from',
  'now',
  'on',
  'please',
  'pls',
  'range',
  'date',
  'dates',
  'period',
  'ok',
  'okay',
  'instead',
  'for',
  'all',
  'answers',
  'and',
  'then',
  'go',
  'with',
  'chat',
  // Turkish
  'son',
  'varsayılan',
  'varsayılanı',
  'varsayılanım',
  'varsayılanımı',
  'varsayılanın',
  'olarak',
  'yap',
  'yapalım',
  'yapın',
  'değiştir',
  'değiştirelim',
  'kullan',
  'kullanalım',
  'ayarla',
  'lütfen',
  'aralık',
  'aralığı',
  'aralığını',
  'aralığım',
  'tarih',
  'tarihi',
  'bundan',
  'sonra',
  'böyle',
  'şimdi',
  'tamam',
  'olsun',
  'bunu',
  'ile',
  'için',
  'geç',
  'geçelim',
  'bana',
  'göre',
  'de',
  'da',
]);

/**
 * Words that make a message about the default range, whatever else it says:
 * "by default", "as my default", "make … the default", "varsayılan",
 * "bundan sonra". Not "default" alone, which a question about data may hold.
 */
const DEFAULT_WORDS =
  /\bby default\b|\bas (?:my |the )?default\b|\bdefault (?:date )?(?:range|period)\b|\b(?:make|set|change|switch)\b[^.?!]{0,30}\bdefault\b|\bfrom now on\b|varsay[ıi]lan|bundan (?:sonra|böyle)/iu;

/**
 * A message that changes the person's default range: a range with nothing
 * else that asks ("last 7d", "son 7d", "varsayılanı 90d yap", "use 90 days
 * by default"), `alone`; or one that names the default and asks something
 * more ("make 7d the default and show visibility"). Null otherwise: a
 * question with a period in it uses it once.
 */
export function rangeCommand(text: string, now: Date): { range: ChatRange; alone: boolean } | null {
  if (text.length > 200) return null;
  const found = findRange(text, now, true);
  if (!found) return null;
  const rest = `${text.slice(0, found.start)} ${text.slice(found.end)}`.toLowerCase();
  const words = rest.split(/[^\p{L}\d']+/u).filter(Boolean);
  if (words.every((word) => FILLER.has(word))) return { range: found.range, alone: true };
  return DEFAULT_WORDS.test(text) ? { range: found.range, alone: false } : null;
}

// ─── The page's range ───────────────────────────────────────────────────────

/**
 * The range a page has selected, from the side panel's date chip
 * (page-context.ts contextChips: "7d/" for a preset, "2026-10-01/2026-10-15"
 * for a custom range); null for none, All time, or one Chat doesn't offer.
 */
export function pageRangeOf(
  chips: readonly { key: string; value?: string }[] | undefined,
  now: Date,
): ChatRange | null {
  const value = chips?.find((chip) => chip.key === 'dates')?.value;
  if (!value) return null;
  const [from, to = ''] = value.split('/');
  if (!to) return isRangePreset(from) ? from : null;
  return parseRange(`${from}/${to}`, now);
}

/** One button of the range card: a range, and whether it is the page's. */
export interface RangeOption {
  range: ChatRange;
  page: boolean;
}

/**
 * The range card's buttons (Custom aside, its own row): the page's range
 * first when the side panel is on a page that has one, then the presets
 * (the page's own one left out, as it is the first), at most 5.
 */
export function rangeOptions(page: ChatRange | null): RangeOption[] {
  const presets = RANGE_PRESETS.filter((preset) => preset !== page).map((range) => ({
    range,
    page: false,
  }));
  return page ? [{ range: page, page: true }, ...presets] : presets;
}

// ─── What the models are told ───────────────────────────────────────────────

/**
 * The confirmation's short ranges, as the person may write them: what the
 * fact check knows as said (facts.ts), so "last 24h" isn't taken for a
 * figure the data doesn't hold.
 */
export const RANGE_EXAMPLES = "'last 30d', 'last 7d', 'last 24h'";

/**
 * The writer's line after a pick on the range card (the owner's words,
 * 2026-11-11); `phrase` is rangePhrase's.
 */
export function rangeChosenNote(phrase: string): string {
  return `The person just picked ${phrase} on the date range card. The app kept it as their default, for this chat and every later one, and every read in this answer used it. Start your answer with this, in the person's language (in Turkish the examples read 'son 30d', 'son 7d', 'son 24h'): "From now on I'll use ${phrase} by default. To change it, just write ${RANGE_EXAMPLES}: I'll switch the default right away and answer." Then answer their question over that range.`;
}

/** The writer's line after a message that changed the default; `phrase` is rangePhrase's. */
export function rangeCommandNote(phrase: string, alone: boolean): string {
  const kept = `The person's message changes their default date range to ${phrase}; the app kept it, and every read in this answer used it.`;
  return alone
    ? `${kept} Start with one short line, in the language of their messages in this chat, saying that from now on you use ${phrase} by default. Their message asks nothing else: when an earlier message in this chat asked about their data, answer that question again over the new range; when none did, that line is the whole answer.`
    : `${kept} Start with one short line, in their language, saying that from now on you use ${phrase} by default, then answer the rest of their message.`;
}

/** The reader's line when a message only changed the default range. */
export const RANGE_COMMAND_READ_NOTE =
  "The person's message only changes their default date range, which the app kept and applies to every read. When an earlier message in this chat asked about their data, read again what that question needs; when none did, read nothing.";
