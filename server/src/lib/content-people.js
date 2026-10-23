import * as cheerio from 'cheerio';
import { logger } from './logger.js';

/**
 * No invented people or quotes (Content Editor Quality spec §9, CE-044).
 * Every person's name and quoted sentence the Content Agent writes must be
 * in what it was given: the page, the brand, the brief, the rules, the
 * person's data (Sources) or Settings › Authors. One that isn't is taken
 * out and a placeholder stands in its place, for the person to fill (a
 * to-do in Quality). As the number guard (content-sources.js), it reads the
 * words, never the model's say-so.
 *
 * A name is read where a person is plainly meant: after Dr./Prof./Mr./Ms.,
 * next to a role ("CEO Jane Doe", "Jane Doe, head of sales", "Jane Doe
 * (CEO)"), or with a verb only people do ("Jane Doe said", "told Jane Doe",
 * "Ayşe Yılmaz'a göre"); a product or a company recommends, adds or
 * describes too ("Google Ads recommends"). A name or a quote is known when
 * what the agent was given has it as whole words ("Chen" isn't in
 * "kitchen"). A quoted sentence is two words or more in
 * quotation marks next to speech, four or more anywhere, or a blockquote or
 * <q>; a term in quotes ("AI visibility") is no quote. Headings are read
 * for quotes and speech only: their capitals aren't names.
 */

export const NAME_PLACEHOLDER = '[name of a real person]';
export const QUOTE_PLACEHOLDER = '[quote from a real person, with its source]';

/** A quote this short is a term in quotes, unless someone is said to say it. */
const MIN_QUOTE_WORDS = 4;

/**
 * Words as compared, whole: lowercased, with what isn't a letter, a mark or
 * a digit (quotes, apostrophes, punctuation, spaces) as one space ("O'Neil"
 * → "o neil", the same on both sides).
 */
const wordsOf = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();

/** What the agent was given, read as one text names and quotes are looked up in. */
export function knownPeople(...texts) {
  return { words: ` ${wordsOf(texts.filter(Boolean).join('\n'))} ` };
}

/** Whether what the agent was given has these words, whole: "Chen" isn't in "kitchen". */
const isKnown = (words, known) => {
  const needle = wordsOf(words);
  return needle.length > 0 && known.words.includes(` ${needle} `);
};

const wordCount = (text) => (String(text).match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []).length;

// A capitalised word of a name ("Ada", "McDonald", "O'Neil", "Jean-Luc"): one
// way to read it only (the lookahead checks it has a small letter), so a
// long word can't make the reading slow; an apostrophe only before a
// capital ("O'Neil", not "Yılmaz'a" or "Doe's"). Initials ("J. K.
// Rowling"), and particles between the words ("Ursula von der Leyen").
const WORD = String.raw`\p{Lu}(?=[\p{L}'’]*\p{Ll})(?:\p{L}|['’](?=\p{Lu}))+(?:-\p{L}+)?`;
const PARTICLE = String.raw`(?:von|van|der|den|de|del|della|di|da|du|la|le|al|bin|ibn|ten|ter)`;
const NAME = String.raw`(?<!\p{L})(?:(?:\p{Lu}\.\s?){1,3}\s?${WORD}|${WORD}(?:\s+(?:${PARTICLE}\s+){0,3}(?:\p{Lu}\.\s+)?${WORD}){1,2})(?!\p{L})`;

const ROLE_WORDS = [
  'ceo',
  'cto',
  'cfo',
  'coo',
  'cmo',
  'vp',
  'founder',
  'co-founder',
  'cofounder',
  'president',
  'chairman',
  'chairwoman',
  'director',
  'professor',
  'analyst',
  'researcher',
  'editor',
  'economist',
  'scientist',
  'consultant',
  'journalist',
  'spokesperson',
  'spokesman',
  'spokeswoman',
  'expert',
  'specialist',
  'strategist',
  'marketer',
  'engineer',
  'author',
  'advisor',
  'adviser',
  'coach',
  'designer',
  'developer',
  'writer',
  'owner',
  'officer',
  'executive',
  'manager',
  'lead',
  'chief',
  'head of',
  'vice president',
  'doctor',
  'physician',
  'lawyer',
  'attorney',
  'therapist',
  'nutritionist',
  'dietitian',
  'trainer',
  'chef',
  'barista',
  'gründer',
  'gründerin',
  'geschäftsführer',
  'geschäftsführerin',
  'kurucu',
  'uzman',
  'müdür',
  'direktör',
];
const ABBREVIATIONS = new Set(['ceo', 'cto', 'cfo', 'coo', 'cmo', 'vp']);
const spaced = (role) => role.replace(/ /g, String.raw`\s+`);
/** A role as written in a sentence: lowercase, or an abbreviation ("CEO"). */
const ROLE_LOWER = `(?:${ROLE_WORDS.map((r) => (ABBREVIATIONS.has(r) ? r.toUpperCase() : spaced(r))).join('|')})`;
/** A role in either case ("Head of Sales", "head of sales"). */
const ROLE_ANY = `(?:${ROLE_WORDS.map((r) =>
  ABBREVIATIONS.has(r) ? r.toUpperCase() : `[${r[0].toUpperCase()}${r[0]}]${spaced(r.slice(1))}`,
).join('|')})`;
/** Role words, to tell them from the name after them ("Founder Jane Doe"). */
const ROLE_SET = new Set(ROLE_WORDS.filter((r) => !r.includes(' ')));

/** Speech, read with a quote: whoever or whatever says it, it is a quote. */
const SPEECH = String.raw`(?:says|said|told|tells|explains|explained|notes|noted|writes|wrote|recalls|recalled|adds|added|argues|argued|believes|warns|warned|states|stated|puts it|put it|emphasi[sz]es|emphasi[sz]ed|suggests|suggested|recommends|recommended|advises|advised|points out|pointed out|shares|shared|observes|observed|insists|insisted|admits|admitted|comments|commented|agrees|agreed|claims|claimed|predicts|predicted|describes|described|sagt|sagte|meint|erklärt|dit|explique|dice|explica|afirma|söyledi|diyor|belirtti|açıkladı)`;
/**
 * Verbs said of people only, read with a name that has no honorific or role
 * ("Marco Rossi said"): the rest of SPEECH a product or a company does too
 * ("Google Ads recommends", "Microsoft Teams adds", "Product Hunt
 * describes"), so those read a name only with an honorific or a role.
 */
const PERSON_SPEECH = String.raw`(?:said|told|explained|recalled|admitted|insisted|argued|sagte|söyledi)`;

/**
 * Where a name plainly means a person: the name is the group "name", with
 * how many words it needs; `role` cues aren't read in headings.
 */
const NAME_CUES = [
  // "Dr. Jane Doe", "Dr. Doe": the honorific goes with the name.
  {
    re: new RegExp(
      String.raw`(?<!\p{L})(?:Dr|Prof|Mr|Mrs|Ms|Mx)\.\s*(?<name>${WORD}(?:\s+${WORD}){0,2})(?!\p{L})`,
      'gu',
    ),
    words: 1,
    honorific: true,
  },
  {
    re: new RegExp(String.raw`(?<!\p{L})(?:Dr|Prof|Mr|Mrs|Ms|Mx)\s+(?<name>${NAME})`, 'gu'),
    words: 2,
    honorific: true,
  },
  // "CEO Jane Doe", "SEO expert Sarah Chen".
  {
    re: new RegExp(String.raw`(?<!\p{L})${ROLE_LOWER}\s+(?<name>${NAME})`, 'gu'),
    words: 2,
    role: true,
  },
  // "Jane Doe, head of sales", "Sarah Chen, a marketing strategist at Acme".
  {
    re: new RegExp(String.raw`(?<name>${NAME}),\s+(?:[\p{L}-]+\s+){0,3}${ROLE_ANY}(?!\p{L})`, 'gu'),
    words: 2,
    role: true,
  },
  // "Jane Doe (CEO of Acme)".
  {
    re: new RegExp(
      String.raw`(?<name>${NAME})\s*\(\s*(?:[\p{L}-]+\s+){0,2}${ROLE_ANY}(?!\p{L})`,
      'gu',
    ),
    words: 2,
    role: true,
  },
  // "Sarah, our head of growth", at a sentence's start: a single name.
  {
    re: new RegExp(
      String.raw`(?<=^|[.!?]\s+|[“"]\s*)(?<name>${WORD}),\s+(?:our|the|a|an|their|its)\s+(?:[\p{L}-]+\s+){0,3}${ROLE_ANY}(?!\p{L})`,
      'gu',
    ),
    words: 1,
    role: true,
  },
  // "Jane Doe said", "Anna Schmidt sagte".
  { re: new RegExp(String.raw`(?<name>${NAME})\s+${PERSON_SPEECH}(?!\p{L})`, 'gu'), words: 2 },
  // "said Jane Doe.", "told by Jane Doe," — a name the sentence stops at.
  // "According to" isn't read: it goes with a tool as well ("according to
  // Google Analytics"), and with a role a name is read all the same.
  {
    re: new RegExp(
      String.raw`(?<!\p{L})${PERSON_SPEECH}(?:\s+by)?\s+(?<name>${NAME})(?=\s*(?:[.,;:!?)]|$))`,
      'gu',
    ),
    words: 2,
  },
  // "Ayşe Yılmaz'a göre".
  {
    re: new RegExp(String.raw`(?<name>${NAME})['’](?:a|e|ya|ye)\s+göre(?!\p{L})`, 'gu'),
    words: 2,
  },
];

/** Capitalised words that start a sentence, not a name ("The team said", "As Ada says"). */
const NOT_NAMES = new Set(
  (
    'the this that these those our your their his her its a an every each some most many one we they it ' +
    'as when if but and so then while because after before like unlike for in on at by with from to of ' +
    'also yet still now here there what why how who where which'
  ).split(' '),
);
/** A name after these is a place ("In Silicon Valley, the founder…"). */
const PLACE_BEFORE = new Set(
  'in at on from across near around throughout within inside outside into'.split(' '),
);
/** A name ending so is a publication or a body, not a person ("Search Engine Land"). */
const NOT_PEOPLE = new Set(
  (
    'research review journal land institute university times post news magazine report group inc ' +
    'labs media press daily weekly today central console insights foundation association council ' +
    'agency bureau center centre school academy college team blog'
  ).split(' '),
);

/**
 * A name as matched, without the sentence words, adverbs and roles before
 * it: its start in the match and its words, or null when what is left
 * isn't a person's name, or all or a part of it is known.
 */
function personIn(name, minWords, known) {
  const words = name.split(/\s+/);
  let start = 0;
  while (words.length) {
    const lower = words[0].toLowerCase();
    if (PLACE_BEFORE.has(lower)) return null;
    if (!NOT_NAMES.has(lower) && !ROLE_SET.has(lower) && !/^\p{L}+ly$/u.test(lower)) break;
    start = name.indexOf(words[1] ?? '', start + words[0].length);
    words.shift();
  }
  if (words.length < minWords) return null;
  if (NOT_PEOPLE.has(words.at(-1).toLowerCase())) return null;
  // The person's own name may be all or the end of it ("Recently Jane Doe").
  for (let i = 0; words.length - i >= minWords; i++) {
    if (isKnown(words.slice(i).join(' '), known)) return null;
  }
  return { start, name: name.slice(start) };
}

/**
 * A quoted sentence: in curly, low-high, angle or straight quotation marks
 * (a straight one not after a number: 27" is inches), or in curly single
 * ones around words (not an apostrophe's).
 */
const QUOTES = [
  /“([^“”]{1,800})”/g,
  /„([^„“”]{1,800})[“”]/g,
  /«([^«»]{1,800})»/g,
  /(?<![\p{L}\p{N}])"([^"\n]{1,800})"(?![\p{L}\p{N}])/gu,
  /(?<!\p{L})‘([^‘]{1,800}?)’(?!\p{L})/gu,
];
/** Speech right after a quote ("…,” said Jane Doe") or right before it ("Jane Doe said: “…"). */
const SPOKEN_AFTER = new RegExp(
  String.raw`^[,.!?]?\s*(?:${SPEECH}(?!\p{L})|${NAME}\s+${SPEECH}(?!\p{L}))`,
  'u',
);
const SPOKEN_BEFORE = new RegExp(String.raw`${SPEECH}[,:]?\s*$`, 'u');

/** A placeholder the agent left, or one put in: never read again. */
const BRACKETS = /\[[^\]]*\]/g;

/**
 * The names and quoted sentences in a text that what the agent was given
 * doesn't have, as edits { start, end, text } (the placeholder), in order
 * and apart. A heading's role cues aren't read: its capitals aren't names.
 */
export function peopleEdits(text, known, { heading = false } = {}) {
  const s = String(text ?? '');
  // Placeholders aren't read: blanked out, with their places kept.
  const read = s.replace(BRACKETS, (m) => ' '.repeat(m.length));
  const edits = [];
  const free = (start, end) => edits.every((e) => end <= e.start || start >= e.end);

  for (const pattern of QUOTES) {
    for (const m of read.matchAll(pattern)) {
      const end = m.index + m[0].length;
      // The words as written, a placeholder in them too.
      const inner = s.slice(m.index + 1, end - 1);
      const words = wordCount(inner);
      if (words < 2) continue;
      const spoken =
        SPOKEN_AFTER.test(read.slice(end, end + 80)) ||
        SPOKEN_BEFORE.test(read.slice(Math.max(0, m.index - 40), m.index));
      if ((words < MIN_QUOTE_WORDS && !spoken) || isKnown(inner, known)) continue;
      if (free(m.index, end)) edits.push({ start: m.index, end, text: QUOTE_PLACEHOLDER });
    }
  }
  for (const cue of NAME_CUES) {
    if (heading && cue.role) continue;
    for (const m of read.matchAll(cue.re)) {
      const at = m.index + m[0].indexOf(m.groups.name);
      const person = personIn(m.groups.name, cue.words, known);
      if (!person) continue;
      const start = cue.honorific ? m.index : at + person.start;
      const end = at + person.start + person.name.length;
      if (free(start, end)) edits.push({ start, end, text: NAME_PLACEHOLDER });
    }
  }
  return edits.sort((a, b) => a.start - b.start);
}

/** A text with each unknown name and quote put as a placeholder, and the edits made. */
export function guardPeople(text, known, options) {
  const s = String(text ?? '');
  const edits = peopleEdits(s, known, options);
  let out = '';
  let at = 0;
  for (const e of edits) {
    out += s.slice(at, e.start) + e.text;
    at = e.end;
  }
  return { text: out + s.slice(at), edits };
}

/** Tags whose text a page's placeholders never touch: code and what isn't words. */
const KEPT_AS_IS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'textarea',
  'code',
  'pre',
]);
/** Tags that hold a line of their own: the text in one is read together. */
const BLOCKS = new Set(
  (
    'p li ul ol dl dd dt h1 h2 h3 h4 h5 h6 blockquote figure figcaption table thead tbody tfoot tr ' +
    'td th caption div section article aside header footer main details summary'
  ).split(' '),
);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** The text nodes under a node, in order: its words as htmlText reads them. */
function textNodes($, el) {
  const out = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') out.push(node);
      else if (node.type === 'tag' && !KEPT_AS_IS.has(node.name)) walk(node.children ?? []);
    }
  };
  walk($(el).contents().get());
  return out;
}

/**
 * An HTML page or insert with each unknown name and quote put as a
 * placeholder, in its words only. A blockquote or <q> is a quote whatever
 * its marks: one whose words aren't known becomes one placeholder, and an
 * unknown name in its cite one too. Each line's text is read together,
 * across the bold and the links in it. Returns the HTML (as it was when
 * nothing is put) and how many were put in.
 */
export function guardPeopleInHtml(html, known) {
  const $ = cheerio.load(html || '', null, false);
  let count = 0;
  $('blockquote, q').each((_, el) => {
    // Its words, without the cite that says whose they are.
    const words = textNodes($, el)
      .filter((n) => !$(n).closest('cite, footer').length)
      .map((n) => n.data)
      .join(' ');
    if (wordCount(words) >= 2 && !isKnown(words, known)) {
      if (el.name === 'q') $(el).replaceWith(QUOTE_PLACEHOLDER);
      else $(el).html(`<p>${QUOTE_PLACEHOLDER}</p>`);
      count += 1;
      return;
    }
    $(el)
      .find('cite, footer')
      .each((__, by) => {
        const name = textNodes($, by)
          .map((n) => n.data)
          .join(' ');
        const words = wordCount(name);
        if (words && words <= 6 && !isKnown(name, known)) {
          $(by).text(NAME_PLACEHOLDER);
          count += 1;
        }
      });
  });

  // A line: its own text nodes and its inline tags', in order, read as one.
  const line = (nodes, heading) => {
    if (!nodes.length) return;
    const joined = nodes.map((n) => n.data).join('');
    const edits = peopleEdits(joined, known, { heading });
    if (!edits.length) return;
    count += edits.length;
    const starts = [];
    let at = 0;
    for (const n of nodes) {
      starts.push(at);
      at += n.data.length;
    }
    // From the end, so the places before stay put. The placeholder goes in
    // the node the edit starts in; the rest of its words are cut.
    for (const e of [...edits].reverse()) {
      nodes.forEach((n, i) => {
        const from = starts[i];
        const to = from + n.data.length;
        if (to <= e.start || from >= e.end) return;
        const head = n.data.slice(0, Math.max(0, e.start - from));
        const tail = n.data.slice(Math.min(n.data.length, e.end - from));
        n.data = head + (e.start >= from ? e.text : '') + tail;
      });
    }
  };
  // An inline tag's text, with any line inside it read on its own.
  const inlineText = (el) => {
    const out = [];
    for (const node of $(el).contents().get()) {
      if (node.type === 'text') out.push(node);
      else if (node.type !== 'tag' || KEPT_AS_IS.has(node.name)) continue;
      else if (BLOCKS.has(node.name)) walk(node, HEADINGS.has(node.name));
      else out.push(...inlineText(node));
    }
    return out;
  };
  const walk = (el, heading) => {
    let run = [];
    for (const node of $(el).contents().get()) {
      if (node.type === 'text') run.push(node);
      else if (node.type !== 'tag' || KEPT_AS_IS.has(node.name)) continue;
      else if (BLOCKS.has(node.name)) {
        line(run, heading);
        run = [];
        walk(node, HEADINGS.has(node.name));
      } else run.push(...inlineText(node));
    }
    line(run, heading);
  };
  walk($.root(), false);
  if (!count) return { html, count };
  // A link or a bold whose words all went with a name or a quote goes too.
  $('a, strong, em, b, i, u, s, span, mark, small, sup, sub').each((_, el) => {
    if (!$(el).text() && !$(el).find('img, br').length) $(el).remove();
  });
  return { html: $.html(), count };
}

/**
 * The words of the workspace's authors (Settings › Authors): names, titles
 * and bios a page may name them by. One that can't be read (content_authors
 * not there yet, a failed read) is logged and reads as none: the run goes
 * on, and an author's name it writes becomes a placeholder like any other.
 */
export async function authorWords(db, organizationId, log = logger) {
  try {
    const { data, error } = await db
      .from('content_authors')
      .select('name, title, bio')
      .eq('organization_id', organizationId);
    if (error) throw error;
    return (data ?? []).flatMap((a) => [a.name, a.title, a.bio]).filter(Boolean);
  } catch (err) {
    log.warn({ err, organizationId }, '[content-people] authors not read');
    return [];
  }
}
