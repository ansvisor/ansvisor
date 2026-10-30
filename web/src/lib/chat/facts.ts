import type { Json } from '@/types/supabase';

/**
 * Chat's fact check on its answers (CHAT-05 item 11, CHAT-20 §19
 * "Groundedness"): every figure in an answer must come from this run's
 * reads, the person's words or the chat so far. A figure that doesn't is
 * taken out and a placeholder put in its place ("[real metric]",
 * "[price]"), before the text reaches the browser, and the run records it.
 *
 * What a figure is, and the placeholders, mirror the Site Audit's
 * recommendation guard (server/src/lib/audit/recommendation-guard.js:
 * VALUE_RE, MASK_RE, PLACEHOLDER): the web can't import the API server's
 * code, so keep the two in sync (facts.test.ts checks the placeholders
 * against it). What differs is what counts as known: an answer works
 * figures out of what it read, so a figure is known when it is one read
 * (rounded as the answer writes it), a column's total or average, a list's
 * length, or, inside one row or one column, a difference, a percent change
 * or a share; small counts (0–10), numbering ("Step 2", "1."), dates,
 * times, this or last year and names with a number ("Claude 3.5") pass.
 * Pure.
 */

/** Mirrors recommendation-guard.js' PLACEHOLDER (the ones an answer uses). */
export const PLACEHOLDER = {
  metric: '[real metric]',
  price: '[price]',
  date: '[date]',
} as const;

// ─── What the run knows ─────────────────────────────────────────────────────

export interface KnownFigures {
  /** Every number read, said or worked out from a column. */
  values: ReadonlySet<number>;
  /** Numbers that belong together, a row's or a column's: what may be compared. */
  groups: readonly (readonly number[])[];
}

/** Values kept, at most, and groups: a run's reads are capped well under this. */
const MAX_VALUES = 20_000;
const MAX_GROUPS = 500;
const MAX_GROUP = 50;

const DIGITS = /\d+(?:[.,]\d+)*/g;

/** A digit group as a number: "1,234" → 1234, "12.5" → 12.5, "12,5" → 12.5 (a decimal comma). */
export function parseFigure(raw: string): number | null {
  let text = raw;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
  else if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',', '.');
  else if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(text)) text = text.replace(/\./g, '');
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * The figures a run may state: from its reads' JSON (numbers, numbers in
 * texts, list lengths, each column's total and average, rows and columns as
 * groups) and from texts (the question, the chat so far).
 */
export function knownFigures(sources: readonly unknown[]): KnownFigures {
  const values = new Set<number>();
  const groups: number[][] = [];
  const add = (n: number) => {
    if (Number.isFinite(n) && values.size < MAX_VALUES) values.add(n);
  };
  const addText = (text: string) => {
    for (const match of text.matchAll(DIGITS)) {
      const n = parseFigure(match[0]);
      if (n !== null) add(n);
    }
  };
  const group = (list: number[]) => {
    if (list.length > 1 && groups.length < MAX_GROUPS) groups.push(list.slice(0, MAX_GROUP));
  };
  const walk = (node: unknown, depth: number) => {
    if (typeof node === 'number') return add(node);
    if (typeof node === 'string') return addText(node);
    if (depth > 10 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      add(node.length);
      const columns = new Map<string, number[]>();
      for (const item of node) {
        walk(item, depth + 1);
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          for (const [key, field] of Object.entries(item)) {
            if (typeof field !== 'number' || !Number.isFinite(field)) continue;
            const column = columns.get(key) ?? [];
            column.push(field);
            columns.set(key, column);
          }
        }
      }
      for (const column of columns.values()) {
        const total = column.reduce((sum, n) => sum + n, 0);
        add(total);
        add(total / column.length);
        group([...column, total]);
      }
      return;
    }
    const siblings: number[] = [];
    for (const field of Object.values(node as Record<string, unknown>)) {
      if (typeof field === 'number' && Number.isFinite(field)) siblings.push(field);
      walk(field, depth + 1);
    }
    group(siblings);
  };
  for (const source of sources) walk(source, 0);
  return { values, groups };
}

// ─── Figures in an answer ───────────────────────────────────────────────────

// Mirrors recommendation-guard.js' MASK_RE: URLs, domains and placeholders stay as they are.
const PLACEHOLDER_SOURCE = String.raw`\[[A-Za-z][A-Za-z ]{1,38}\]`;
const MASK_RE = new RegExp(
  [
    String.raw`\bhttps?:\/\/[^\s"'<>)]+`,
    String.raw`\bwww\.[^\s"'<>)]+`,
    // Tried from a word's start only, so a long run of "a-a-a…" is read once, not once per letter.
    String.raw`(?<![\w.-])[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|ai|co|dev|app|edu|gov|info)\b(?:\/[^\s"'<>)]*)?`,
    PLACEHOLDER_SOURCE,
  ].join('|'),
  'gi',
);

const NUM = String.raw`\d+(?:[.,]\d+)*`;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;

// Mirrors recommendation-guard.js' VALUE_RE, with a time ("09:14") read as a date and ":" kept off a number.
const VALUE_RE = new RegExp(
  [
    `(?<date>\\b\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?(?![\\w-])|\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?(?:\\s+\\d{4})?\\b|\\b${MONTH}\\.?\\s+\\d{4}\\b|\\b\\d{1,2}:\\d{2}\\b)`,
    // A figure followed by its unit is tried from its first digit only (linear on "1.1.1…").
    `(?<price>[$€£¥₹₺]\\s?${NUM}(?:\\s?(?:k|m|bn)\\b)?|(?<![\\d.,])\\b${NUM}\\s?(?:usd|eur|gbp|try|dollars?|euros?|pounds?)\\b)`,
    `(?<percent>(?<![\\d.,])\\b${NUM}\\s?(?:%|percent\\b|per cent\\b))`,
    `(?<year>\\b(?:19|20)\\d{2}\\b)`,
    `(?<number>(?<![\\w.#/:-])${NUM}(?:\\s?[–-]\\s?${NUM})?(?:[kmx×+](?![a-z])|\\s?(?:million|billion|thousand)\\b)?(?![\\w%:]))`,
  ].join('|'),
  'gi',
);

// "Step 2", "Top 10", "#3": numbering, not data. "1." at a line's start too.
const NUMBERING_WORD_RE =
  /\b(?:step|part|phase|tier|level|top|no\.|number|rank(?:ed)?|position)\s*$/i;
const NUMBERING_AFTER_RE = /^[.)]\s/;
// "Claude 3.5", "GPT 4.1": a name's version, right after it.
const NAME_BEFORE_RE = /\b[A-Z][\w-]*\s$/;
const VERSION_RE = /^\d{1,2}\.\d{1,2}$/;

const SCALE: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  bn: 1e9,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
};

/** How many decimals a written figure has: none for thousands ("1,234", "1.234.567"). */
function decimalsOf(raw: string): number {
  if (/^\d{1,3}(?:,\d{3})+$/.test(raw) || /^\d{1,3}(?:\.\d{3}){2,}$/.test(raw)) return 0;
  return /[.,](\d+)$/.exec(raw)?.[1].length ?? 0;
}

/** A figure as the answer wrote it: its value and how closely it was rounded. */
function figuresOf(match: string): { value: number; tolerance: number }[] {
  const scaleWord = /(k|m|bn|thousand|million|billion)\b\s*$/i.exec(match)?.[1]?.toLowerCase();
  const scale = scaleWord ? SCALE[scaleWord] : 1;
  return [...match.matchAll(DIGITS)].flatMap((m) => {
    const value = parseFigure(m[0]);
    if (value === null) return [];
    const decimals = decimalsOf(m[0]);
    return [{ value: value * scale, tolerance: (0.5 / 10 ** decimals) * scale + 1e-9 }];
  });
}

/** Whether a figure is known, or worked out of known ones, at the answer's rounding. */
function isKnown(
  figure: { value: number; tolerance: number },
  known: KnownFigures,
  percent: boolean,
): boolean {
  const close = (x: number) => Math.abs(Math.abs(x) - figure.value) <= figure.tolerance;
  for (const x of known.values) {
    if (close(x)) return true;
    // A share read as a ratio: 0.42 is 42%.
    if (percent && Math.abs(x) <= 1 && close(x * 100)) return true;
  }
  for (const group of known.groups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        const [a, b] = [group[i], group[j]];
        if (close(a - b)) return true;
        if (percent && a !== 0 && (close(((b - a) / a) * 100) || close((b / a) * 100))) {
          return true;
        }
      }
    }
  }
  return false;
}

/** How far either side of a figure its rules read ("Step", "Claude", "1." at a line's start). */
const AROUND = 80;

export interface FactCheck {
  /** The text with figures not in the data replaced. */
  text: string;
  /** Figures checked (beyond small counts, numbering, dates). */
  checked: number;
  /** The figures taken out, as written. */
  replaced: string[];
}

/** Runs `fn` on the stretches of `text` outside URLs, domains and placeholders. */
function outsideMasks(text: string, fn: (chunk: string, offset: number) => string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(MASK_RE)) {
    out += fn(text.slice(last, m.index), last);
    out += m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last), last);
}

/**
 * The text with each figure the run doesn't know replaced by a placeholder.
 * `before` and `after` are the text around it (already sent, still held):
 * read for context, never changed.
 */
export function checkFigures(
  text: string,
  known: KnownFigures,
  context: { before?: string; after?: string; now?: Date } = {},
): FactCheck {
  const before = context.before ?? '';
  const after = context.after ?? '';
  const year = (context.now ?? new Date()).getUTCFullYear();
  let checked = 0;
  const replaced: string[] = [];
  // What was sent is read with the text, so a link, "#12" or "Oct 17" cut
  // across two chunks reads as one; only `text`'s own figures change.
  const full = before + text;
  const from = before.length;
  const out = outsideMasks(full, (chunk, offset) =>
    chunk.replace(VALUE_RE, (match, ...args) => {
      const groups = args.at(-1) as Record<string, string | undefined>;
      const at = offset + (args.at(-3) as number);
      if (at < from) return match;
      // The rules read a few words either side, so a long text stays linear.
      const lead = full.slice(Math.max(0, at - AROUND), at);
      const end = at + match.length;
      const tail = full.slice(end, end + AROUND) + after.slice(0, AROUND);
      if (groups.date) return match;
      if (groups.year && !groups.number) {
        const y = Number(match);
        if (y === year || y === year - 1 || known.values.has(y)) return match;
        checked += 1;
        replaced.push(match);
        return PLACEHOLDER.date;
      }
      const figures = figuresOf(match);
      const percent = !!groups.percent;
      if (groups.number) {
        if (figures.every((f) => Number.isInteger(f.value) && f.value <= 10)) return match;
        const line = lead.slice(lead.lastIndexOf('\n') + 1);
        if (NUMBERING_WORD_RE.test(lead)) return match;
        if (/^\s*$/.test(line) && NUMBERING_AFTER_RE.test(tail)) return match;
        if (NAME_BEFORE_RE.test(lead) && VERSION_RE.test(match)) return match;
      }
      checked += 1;
      if (figures.every((f) => isKnown(f, known, percent))) return match;
      replaced.push(match);
      return groups.price ? PLACEHOLDER.price : PLACEHOLDER.metric;
    }),
  );
  return { text: out.slice(from), checked, replaced };
}

/** Where a streamed text may be cut so no figure is checked without what follows it. */
export const FIGURE_CONTEXT = 16;

/**
 * The most a stream holds back (a uuid, or a figure and its unit, fit well
 * inside), so each check reads a short text however long the answer runs.
 */
export const HOLD_MAX = 120;

/**
 * The start of a figure still near the end of `text`: hold from there until
 * FIGURE_CONTEXT more characters come, so the figure is checked whole and
 * with its unit ("12" + "%", "1.2" + "k"). Null when nothing needs holding.
 */
export function figureHold(text: string): number | null {
  let last = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    if (/\d/.test(text[i])) {
      last = i;
      break;
    }
  }
  if (last < 0 || text.length - last - 1 >= FIGURE_CONTEXT) return null;
  let start = last;
  while (start > 0 && /[\d.,$€£¥₹₺\s–-]/.test(text[start - 1])) start -= 1;
  // The words before it ("Step", "Oct") are read from what was sent; spaces stay with them.
  while (start < last && /\s/.test(text[start])) start += 1;
  return start;
}

/** The figures a run's reads and messages make known: what checkFigures checks against. */
export function figuresOfRun(parts: {
  question: string;
  history: readonly unknown[];
  reads: readonly Json[];
}): KnownFigures {
  return knownFigures([parts.question, ...parts.history, ...parts.reads]);
}
