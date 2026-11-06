/**
 * A Library skill's front matter in the YAML its authors write (owner,
 * 2026-11-05: "teach the front-matter reader multi-line YAML… a safe YAML
 * subset, not arbitrary YAML"), turned into the one-line form the format
 * reader takes (format.ts): each value on one line, quoted, and metadata
 * one level deep. Only for skills added from the Library (import.ts's
 * `library`); uploads, GitHub imports and Ansvisor's own skills keep the
 * strict form.
 *
 * The subset, block style only:
 *   - `key: value` with a plain, 'single' or "double" quoted value, which
 *     may go on over the lines under it;
 *   - block scalars: `|` and `>`, with `-` or `+`;
 *   - a nested mapping or a `- item` list under a key;
 *   - `[a, b]` lists of plain or quoted items on one line, and a one-line
 *     `{…}` or `[…]` that is JSON (read with JSON.parse);
 *   - comments.
 *
 * Anchors, aliases and tags (`&`, `*`, `!`), other `{…}` maps, `?` keys, tabs,
 * duplicate keys, more than 300 lines or 6 levels are refused: the reader
 * answers null and the strict reader says what is wrong. Metadata that
 * isn't text or a list of text (deeper maps, lists of maps) is dropped and
 * named, for the removed list a review shows. Pure: no dependency.
 */

/** What the subset reads a value as. */
type Node = string | Node[] | { [key: string]: Node };

/** The top-level keys a SKILL.md keeps as text (format.ts FIELDS but metadata). */
const TEXT_FIELDS = new Set(['name', 'description', 'license', 'compatibility']);

const MAX_LINES = 300;
const MAX_DEPTH = 6;

class Unsupported extends Error {}

interface Line {
  indent: number;
  text: string;
}

const KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?: (.*)|)$/;

/** A plain value without its trailing ` # comment`. */
const plain = (text: string) => text.replace(/\s+#.*$/, '').trim();

/** A double-quoted YAML string's text: JSON's escapes, and a line break folded to a space. */
function doubleQuoted(raw: string): string {
  const folded = raw.replace(/\s*\n\s*/g, ' ');
  try {
    return JSON.parse(folded) as string;
  } catch {
    // YAML's own escapes (\x41, \e, \/ and the like) aren't in this subset.
    throw new Unsupported('double-quoted text');
  }
}

/** A single-quoted YAML string's text: '' is ', a line break folds to a space. */
const singleQuoted = (raw: string) =>
  raw
    .slice(1, -1)
    .replace(/\s*\n\s*/g, ' ')
    .replace(/''/g, "'");

/** The end of a quoted string that starts at `at` (its opening quote), or -1. */
function closingQuote(text: string, at: number): number {
  const quote = text[at];
  for (let i = at + 1; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === quote) {
      if (quote === "'" && text[i + 1] === "'") {
        i++;
        continue;
      }
      return i;
    }
  }
  return -1;
}

/** A one-line JSON value as the subset reads it (numbers and booleans as text), or null. */
function fromJson(text: string): Node | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const node = (v: unknown, depth: number): Node => {
    if (depth > MAX_DEPTH) throw new Unsupported('too deep');
    if (v === null) return '';
    if (Array.isArray(v)) return v.map((item) => node(item, depth + 1));
    if (typeof v === 'object') {
      const out: { [key: string]: Node } = Object.create(null) as { [key: string]: Node };
      for (const [key, item] of Object.entries(v as Record<string, unknown>)) {
        out[key] = node(item, depth + 1);
      }
      return out;
    }
    return String(v);
  };
  return node(value, 0);
}

/** A `[a, "b", 'c']` list on one line: its items as text. */
function flowList(raw: string): string[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === '') return [];
  if (/[[\]{}]/.test(inner.replace(/"(?:\\.|[^"\\])*"|'(?:''|[^'])*'/g, ''))) {
    throw new Unsupported('nested flow collection');
  }
  const items: string[] = [];
  let at = 0;
  while (at < inner.length) {
    while (inner[at] === ' ') at++;
    if (inner[at] === '"' || inner[at] === "'") {
      const end = closingQuote(inner, at);
      if (end < 0) throw new Unsupported('unclosed quote');
      const raw = inner.slice(at, end + 1);
      items.push(raw[0] === '"' ? doubleQuoted(raw) : singleQuoted(raw));
      at = end + 1;
      while (inner[at] === ' ') at++;
      if (at < inner.length && inner[at] !== ',') throw new Unsupported('flow list');
      at++;
    } else {
      const comma = inner.indexOf(',', at);
      const end = comma < 0 ? inner.length : comma;
      items.push(inner.slice(at, end).trim());
      at = end + 1;
    }
  }
  return items.filter((item) => item !== '');
}

class Reader {
  private at = 0;
  constructor(private readonly lines: Line[]) {}

  /** The next line that isn't blank or a comment, or null. */
  private peek(): Line | null {
    while (this.at < this.lines.length) {
      const line = this.lines[this.at];
      if (line.text === '' || line.text.startsWith('#')) this.at++;
      else return line;
    }
    return null;
  }

  /** A mapping whose keys sit at `indent`. */
  mapping(indent: number, depth: number): { [key: string]: Node } {
    if (depth > MAX_DEPTH) throw new Unsupported('too deep');
    const out: { [key: string]: Node } = Object.create(null) as { [key: string]: Node };
    for (let line = this.peek(); line && line.indent === indent; line = this.peek()) {
      const field = KEY.exec(line.text);
      if (!field) throw new Unsupported('not a key: value line');
      const [, key, rest = ''] = field;
      if (Object.hasOwn(out, key)) throw new Unsupported('a key twice');
      this.at++;
      out[key] = this.value(rest, indent, depth);
    }
    const next = this.peek();
    if (next && next.indent > indent) throw new Unsupported('indented unlike the keys before it');
    return out;
  }

  /** A `- item` list whose dashes sit at `indent`. */
  private list(indent: number, depth: number): Node[] {
    if (depth > MAX_DEPTH) throw new Unsupported('too deep');
    const out: Node[] = [];
    for (let line = this.peek(); line && line.indent === indent; line = this.peek()) {
      const item = /^-(?: (.*)|)$/.exec(line.text);
      if (!item) break;
      const rest = item[1] ?? '';
      this.at++;
      if (KEY.test(rest.trim()) && !/^["'[]/.test(rest.trim())) {
        // `- key: value`, the item a mapping whose keys line up under the first one.
        const keyIndent = indent + 2 + (rest.length - rest.trimStart().length);
        this.at--;
        this.lines[this.at] = { indent: keyIndent, text: rest.trim() };
        out.push(this.mapping(keyIndent, depth + 1));
      } else {
        out.push(this.value(rest, indent, depth));
      }
    }
    return out;
  }

  /** The lines under a key that sit deeper than it: a block scalar's or a plain value's. */
  private deeper(indent: number): Line[] {
    const out: Line[] = [];
    while (this.at < this.lines.length) {
      const line = this.lines[this.at];
      if (line.text !== '' && line.indent <= indent) break;
      out.push(line);
      this.at++;
    }
    while (out.length > 0 && out[out.length - 1].text === '') out.pop();
    return out;
  }

  /** A key's value: what follows its colon, and the lines under it. */
  private value(rest: string, indent: number, depth: number): Node {
    const text = rest.trim();
    // A one-line `{…}` or `[…]` that is JSON, as many skills write metadata: read as JSON.
    if (/^[[{]/.test(text)) {
      const json = fromJson(text);
      if (json !== null) return json;
    }
    if (/^[&*!?{%@`]/.test(text)) throw new Unsupported('anchor, alias, tag or flow map');
    if (text === '' || text.startsWith('#')) {
      const next = this.peek();
      if (!next || next.indent < indent || (next.indent === indent && !next.text.startsWith('-'))) {
        return '';
      }
      if (next.text.startsWith('- ') || next.text === '-') return this.list(next.indent, depth + 1);
      if (next.indent === indent) return '';
      return this.mapping(next.indent, depth + 1);
    }
    const block = /^([|>])([+-]?)(\d?)(?:\s+#.*)?$/.exec(text);
    if (block) {
      const lines = this.deeper(indent);
      const first = lines.find((line) => line.text !== '');
      const base = block[3] ? indent + Number(block[3]) : (first?.indent ?? indent + 1);
      const own = lines.map((line) =>
        line.text === '' ? '' : `${' '.repeat(Math.max(0, line.indent - base))}${line.text}`,
      );
      if (block[1] === '|') return own.join('\n').trimEnd();
      // Folded: lines join with a space, a blank line stays a line break.
      return own
        .join('\n')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.replace(/\n(?! )/g, ' '))
        .join('\n')
        .trimEnd();
    }
    if (text.startsWith('"') || text.startsWith("'")) {
      // A quoted value may go on over the lines under it.
      let raw = text;
      while (closingQuote(raw, 0) < 0) {
        if (this.at >= this.lines.length) throw new Unsupported('unclosed quote');
        const line = this.lines[this.at++];
        raw += `\n${line.text}`;
      }
      const end = closingQuote(raw, 0);
      const after = raw.slice(end + 1).trim();
      if (after !== '' && !after.startsWith('#')) throw new Unsupported('text after the quote');
      const quoted = raw.slice(0, end + 1);
      return quoted[0] === '"' ? doubleQuoted(quoted) : singleQuoted(quoted);
    }
    if (text.startsWith('[')) {
      if (!plain(text).endsWith(']')) throw new Unsupported('a list over several lines');
      return flowList(plain(text));
    }
    // A plain value, and its lines under it, folded with spaces.
    const more = this.deeper(indent)
      .map((line) => line.text)
      .filter((line) => line !== '' && !line.startsWith('#'));
    return [plain(text), ...more.map(plain)].join(' ').trim();
  }
}

/** A list of text as one line: its items, comma-separated. */
const asText = (node: Node): string | null =>
  typeof node === 'string'
    ? node
    : Array.isArray(node) && node.every((item) => typeof item === 'string')
      ? node.join(', ')
      : null;

/**
 * A front matter (the text between the two `---` lines) read as the YAML
 * subset and written back in the format reader's one-line form, with the
 * metadata it dropped (`metadata.openclaw`); null when it is outside the
 * subset. Keys a SKILL.md doesn't keep stay in, each on one line, so the
 * import removes and lists them by name.
 */
export function readYamlFrontMatter(front: string): { text: string; dropped: string[] } | null {
  const raw = front.replace(/\r\n?/g, '\n').split('\n');
  if (raw.length > MAX_LINES) return null;
  const lines: Line[] = [];
  for (const line of raw) {
    const indent = /^ */.exec(line)![0].length;
    if (line[indent] === '\t') return null;
    lines.push({ indent, text: line.trim() });
  }
  let tree: { [key: string]: Node };
  try {
    tree = new Reader(lines).mapping(0, 0);
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
  const out: string[] = [];
  const dropped: string[] = [];
  for (const [key, node] of Object.entries(tree)) {
    if (key === 'metadata') {
      if (typeof node !== 'object' || Array.isArray(node)) {
        dropped.push('metadata');
        continue;
      }
      const kept: string[] = [];
      for (const [sub, value] of Object.entries(node)) {
        const text = asText(value);
        if (text === null || !/^[A-Za-z0-9_-]+$/.test(sub)) dropped.push(`metadata.${sub}`);
        else kept.push(`  ${sub}: ${JSON.stringify(text)}`);
      }
      if (kept.length > 0) out.push('metadata:', ...kept);
      continue;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(key)) return null;
    const text = asText(node);
    if (TEXT_FIELDS.has(key)) {
      if (text === null || text === '') return null;
      out.push(`${key}: ${JSON.stringify(text)}`);
    } else {
      // Not a SKILL.md field: kept by name for the import to remove and list.
      out.push(`${key}: ""`);
    }
  }
  return { text: out.join('\n'), dropped };
}
