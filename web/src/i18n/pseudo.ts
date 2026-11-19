/**
 * Pseudo-locale (LOC phase C): English made ~35% longer, with accents, so a
 * screen shows what a long language (German) would clip or overflow, and any
 * text that didn't go through a message key stays plain English.
 *
 * "Save changes" → "[!! Šàvvé çhàñgéš !!]". ICU syntax is left alone: {name}
 * placeholders, the plural/select keywords and the # of a plural, number and
 * date arguments, <b>tags</b>, and '{quoted}' text. Only the words change.
 */

/** Wrapper that marks a pseudo-localized message. */
export const PSEUDO_OPEN = '[!! ';
export const PSEUDO_CLOSE = ' !!]';

/** How much longer the words become. */
export const PSEUDO_EXPANSION = 0.35;

const LOWER = 'àƀçðéƒĝĥïĵķļɱñöþǫŕšţüṽŵẋýž';
const UPPER = 'ÀƁÇÐÈƑĜĤÏĴĶĻṀÑÖÞǪŔŠŢÜṼŴẊÝŽ';

const ACCENTS: Record<string, string> = {};
for (let i = 0; i < 26; i++) {
  ACCENTS[String.fromCharCode(97 + i)] = LOWER[i];
  ACCENTS[String.fromCharCode(65 + i)] = UPPER[i];
}

/** A run of plain words: accented, and some letters doubled to add ~35%. */
function pseudoWords(text: string): string {
  const letters = [...text].filter((ch) => ch in ACCENTS).length;
  if (letters === 0) return text;
  const extra = Math.round(letters * PSEUDO_EXPANSION);
  let out = '';
  let seen = 0;
  let added = 0;
  for (const ch of text) {
    const accented = ACCENTS[ch];
    if (!accented) {
      out += ch;
      continue;
    }
    out += accented;
    seen += 1;
    // Spread the doubled letters evenly through the run.
    if (added < extra && Math.floor((seen * extra) / letters) > added) {
      out += accented.toLowerCase();
      added += 1;
    }
  }
  return out;
}

const BRANCHING = new Set(['plural', 'select', 'selectordinal']);

/** The index of the } closing the { at `open`, apostrophe-quoted text skipped; -1 if none. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && (text[i + 1] === '{' || text[i + 1] === '}')) {
      const end = text.indexOf("'", i + 1);
      if (end === -1) return -1;
      i = end;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The text of an ICU message, words changed and syntax kept (no wrapper). */
function transform(text: string): string {
  let out = '';
  let run = '';
  const flush = () => {
    out += pseudoWords(run);
    run = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // '' is a literal apostrophe; '{ … }' is quoted text: both kept as written.
    if (ch === "'") {
      if (text[i + 1] === "'") {
        run += "''";
        i += 2;
        continue;
      }
      if (text[i + 1] === '{' || text[i + 1] === '}' || text[i + 1] === '<') {
        const end = text.indexOf("'", i + 1);
        if (end !== -1) {
          flush();
          out += text.slice(i, end + 1);
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === '{') {
      const close = closingBrace(text, i);
      if (close === -1) {
        run += text.slice(i);
        break;
      }
      flush();
      out += argument(text.slice(i + 1, close));
      i = close + 1;
      continue;
    }
    if (ch === '<') {
      const tag = /^<\/?[A-Za-z][\w.-]*(\s[^<>]*)?\/?>/.exec(text.slice(i));
      if (tag) {
        flush();
        out += tag[0];
        i += tag[0].length;
        continue;
      }
    }
    run += ch;
    i += 1;
  }
  flush();
  return out;
}

/** The inside of a { … }: name and kind kept, a plural's or select's branches transformed. */
function argument(inner: string): string {
  const head = /^(\s*[^,\s]+\s*),(\s*)([A-Za-z]+)(\s*)(,?)/.exec(inner);
  if (!head || !BRANCHING.has(head[3])) return `{${inner}}`;
  let rest = inner.slice(head[0].length);
  let out = head[0];
  const offset = /^\s*offset:\s*\d+/.exec(rest);
  if (offset) {
    out += offset[0];
    rest = rest.slice(offset[0].length);
  }
  while (rest.length) {
    const option = /^(\s*[^\s{]+\s*)\{/.exec(rest);
    if (!option) {
      out += rest;
      break;
    }
    const open = option[0].length - 1;
    const close = closingBrace(rest, open);
    if (close === -1) {
      out += rest;
      break;
    }
    out += `${option[1]}{${transform(rest.slice(open + 1, close))}}`;
    rest = rest.slice(close + 1);
  }
  return `{${out}}`;
}

/** One message in the pseudo-language, wrapped so it stands out. */
export function pseudoLocalizeMessage(message: string): string {
  return `${PSEUDO_OPEN}${transform(message)}${PSEUDO_CLOSE}`;
}

/** A whole messages tree, every string pseudo-localized; the shape is kept. */
export function pseudoLocalize<T>(messages: T): T {
  if (typeof messages === 'string') return pseudoLocalizeMessage(messages) as T;
  if (Array.isArray(messages)) return messages.map((item) => pseudoLocalize(item)) as T;
  if (messages && typeof messages === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(messages as Record<string, unknown>)) {
      out[key] = pseudoLocalize(value);
    }
    return out as T;
  }
  return messages;
}
