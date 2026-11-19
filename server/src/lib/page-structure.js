/**
 * A page's structure, kept as the Content Editor reads it (CE-003: Optimize
 * content › Page URL). The editor keeps headings, paragraphs, lists and
 * tables and drops every other tag but its text, so a page built from <div>s
 * (Webflow, page builders) ran together: a comparison grid became one line
 * ("Full nameSearch engine optimization…"), a card's title ran into its text
 * ("Prompt trackingIt tracks…") and a list of <div>s lost its items. Here,
 * before the editor cleans the page:
 *
 * - a grid of rows of cells (a row named "row", or ARIA's table and rows)
 *   becomes a table;
 * - a list of <div>s (ARIA's list, or items named as a list's) becomes a list,
 *   and <li>s outside one get one;
 * - in a block that isn't one the editor keeps, each run of text becomes a
 *   paragraph, and two pieces with nothing between them ("<strong>Prompt
 *   tracking</strong><span>It tracks…</span>") become two.
 *
 * Each pass walks the page once, without recursion: a deep page is fine.
 */

/** Tags that flow inside a line of text. */
const INLINE = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'label',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
]);

/** Blocks the editor doesn't keep: their text is regrouped into paragraphs. */
const GENERIC = new Set([
  'address',
  'article',
  'center',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figure',
  'footer',
  'header',
  'hgroup',
  'main',
  'section',
  'summary',
]);

/** Blocks the editor keeps that hold other blocks: regrouped only where their pieces run together. */
const HOLDERS = new Set(['li', 'td', 'th', 'blockquote']);

/** Blocks whose content is a line of text: nothing inside them is regrouped. */
const TEXT_BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre']);

/** What a list item or a table cell can't hold and stay one. */
const NOT_IN_ITEM = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol']);

/** Words in an item's class that name a list's item… */
const ITEM_WORDS = new Set(['item', 'items', 'point', 'bullet', 'takeaway', 'listitem', 'li']);
/** …and in its block's class, a list. */
const LIST_WORDS = new Set([
  'list',
  'takeaways',
  'tldr',
  'bullets',
  'checklist',
  'highlights',
  'points',
]);

/** A list item longer than this is a section, not an item. */
const MAX_ITEM_TEXT = 600;
/** A grid with fewer columns than this is a run of label and value pairs, read as paragraphs. */
const MIN_TABLE_COLUMNS = 3;

const isElement = (node) => node?.type === 'tag';
const isBlank = (node) => node.type === 'comment' || (node.type === 'text' && !node.data.trim());

/** A class and id, as lower-case words: "comparison-row tldrItem" → comparison, row, tldr, item. */
function wordsOf(el) {
  return `${el.attribs?.class ?? ''} ${el.attribs?.id ?? ''}`
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const role = (el) => (el.attribs?.role ?? '').toLowerCase();

/** The element's children that say something: elements and text with words. */
const meaningful = (el) => (el.children ?? []).filter((child) => !isBlank(child));

/** Every element under `root`, in page order, read once. */
function elementsUnder(root) {
  const found = [];
  const stack = [...(root.children ?? [])].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isElement(node)) continue;
    found.push(node);
    const children = node.children ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return found;
}

/** A parent's new children, linked to it and to each other. */
function relink(parent, children) {
  children.forEach((child, i) => {
    child.parent = parent;
    child.prev = children[i - 1] ?? null;
    child.next = children[i + 1] ?? null;
  });
  parent.children = children;
}

/** A new element holding `children`. */
function element($, name, children = [], attribs = {}) {
  const el = $(`<${name}>`)[0];
  el.attribs = attribs;
  relink(el, children);
  return el;
}

/** Puts `replacement` where `el` was. */
function replace(el, replacement) {
  const parent = el.parent;
  if (!parent) return;
  relink(
    parent,
    parent.children.map((child) => (child === el ? replacement : child)),
  );
  el.parent = null;
}

/** Whether an element holds one of `tags` (itself not counted). */
function holds(el, tags) {
  return elementsUnder(el).some((node) => tags.has(node.name));
}

/** An element's words, as one line. */
function textOf(el) {
  const parts = [];
  const stack = [el];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.type === 'text') parts.push(node.data);
    else if (node.children)
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]);
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * A row's cells, or null when it isn't a row: a block with no words of its
 * own, two or more pieces, none holding a heading, a list or a table.
 */
function cellsOf(row) {
  if (!GENERIC.has(row.name) && !INLINE.has(row.name)) return null;
  const cells = meaningful(row);
  if (cells.length < 2 || cells.some((cell) => !isElement(cell))) return null;
  if (cells.some((cell) => NOT_IN_ITEM.has(cell.name) || holds(cell, NOT_IN_ITEM))) return null;
  return cells;
}

/** Whether a cell is all bold: a header row's. */
function allBold(cell) {
  const inside = meaningful(cell);
  return (
    ['strong', 'b', 'th'].includes(cell.name) ||
    (inside.length === 1 && isElement(inside[0]) && ['strong', 'b'].includes(inside[0].name))
  );
}

/**
 * Grids of rows as tables: a block whose pieces are all rows (named "row", or
 * ARIA's rows; or any rows in ARIA's table or grid), of at least
 * MIN_TABLE_COLUMNS cells in one. A shorter row's last cell spans the rest.
 */
function gridsToTables($, root) {
  for (const grid of elementsUnder(root)) {
    if (!GENERIC.has(grid.name) || !grid.parent) continue;
    const rows = meaningful(grid);
    if (rows.length < 2 || rows.some((row) => !isElement(row))) continue;
    const ariaTable = ['table', 'grid', 'rowgroup'].includes(role(grid));
    const named = rows.every((row) => role(row) === 'row' || wordsOf(row).includes('row'));
    if (!ariaTable && !named) continue;
    const cells = rows.map(cellsOf);
    if (cells.some((row) => row === null)) continue;
    const columns = Math.max(...cells.map((row) => row.length));
    if (columns < MIN_TABLE_COLUMNS && !ariaTable) continue;

    const trs = cells.map((row, r) => {
      const header =
        row.every(allBold) ||
        rows[r].attribs?.role === 'columnheader' ||
        wordsOf(rows[r]).some((word) => word === 'head' || word === 'header');
      return element(
        $,
        'tr',
        row.map((cell, i) => {
          const span = i === row.length - 1 && row.length < columns ? columns - row.length + 1 : 1;
          // An inline cell (a <strong>) stays whole in its cell; a block's pieces move in.
          const content = INLINE.has(cell.name) ? [cell] : [...cell.children];
          return element(
            $,
            header ? 'th' : 'td',
            content,
            span > 1 ? { colspan: String(span) } : {},
          );
        }),
      );
    });
    replace(grid, element($, 'table', [element($, 'tbody', trs)]));
  }
}

/** Whether a block can be a list's item: short, with no heading, list or table in it. */
function itemLike(el) {
  if (!GENERIC.has(el.name) && el.name !== 'li') return false;
  const text = textOf(el);
  return text.length > 0 && text.length <= MAX_ITEM_TEXT && !holds(el, NOT_IN_ITEM);
}

/**
 * Lists of blocks as lists: ARIA's list of listitems; runs of two or more
 * blocks alike (same tag, same class) named as items, or in a block named as
 * a list; and <li>s with no list around them.
 */
function blocksToLists($, root) {
  for (const list of elementsUnder(root)) {
    if (!list.parent) continue;
    if (GENERIC.has(list.name) && role(list) === 'list') {
      const items = meaningful(list);
      if (
        items.length > 0 &&
        items.every((item) => isElement(item) && role(item) === 'listitem' && itemLike(item))
      ) {
        list.name = 'ul';
        for (const item of items) item.name = 'li';
        relink(list, items);
        continue;
      }
    }
    if (list.name === 'ul' || list.name === 'ol') continue;
    const listNamed = wordsOf(list).some((word) => LIST_WORDS.has(word));
    const children = list.children ?? [];
    const out = [];
    let run = [];
    let changed = false;
    const flush = () => {
      if (run.length >= 2 || (run.length === 1 && run[0].name === 'li')) {
        for (const item of run) item.name = 'li';
        out.push(element($, 'ul', run));
        changed = true;
      } else {
        out.push(...run);
      }
      run = [];
    };
    const alike = (a, b) =>
      a.name === b.name &&
      (a.name === 'li' || (a.attribs?.class ?? '') === (b.attribs?.class ?? ''));
    // The cheap tests first: an item's text is read only when it is named as one.
    const candidate = (el) =>
      el.name === 'li' ||
      (!!el.attribs?.class &&
        (listNamed || wordsOf(el).some((word) => ITEM_WORDS.has(word))) &&
        itemLike(el));
    for (const child of children) {
      if (isBlank(child)) {
        if (run.length === 0) out.push(child);
        continue;
      }
      if (isElement(child) && candidate(child) && (run.length === 0 || alike(run[0], child))) {
        run.push(child);
        continue;
      }
      flush();
      if (isElement(child) && candidate(child)) run.push(child);
      else out.push(child);
    }
    flush();
    if (changed) relink(list, out);
  }
}

/** The text at a piece's start or end, for whether two pieces run together. */
function edgeText(node, end) {
  if (node.type === 'text') return node.data;
  const text = textOf(node);
  if (!text) return '';
  // textOf trims: read the piece's own first or last text for its spaces.
  let at = node;
  while (at && at.type !== 'text') {
    const children = (at.children ?? []).filter(
      (child) => child.type === 'text' || isElement(child),
    );
    at = end ? children.at(-1) : children[0];
  }
  return at?.data ?? text;
}

/** Whether two pieces side by side run their words together ("tracking" "It"). */
function runTogether(before, after) {
  const end = edgeText(before, true);
  const start = edgeText(after, false);
  return /\S$/.test(end) && /^\S/.test(start);
}

/**
 * Each block's text in paragraphs, the deepest blocks first: in a block the
 * editor doesn't keep, every run of text between its blocks becomes a
 * paragraph; there, and in a list item, a cell or a quote, two pieces with
 * nothing between them that run their words together become two paragraphs,
 * when the block has no words of its own between its pieces.
 */
function textIntoParagraphs($, root) {
  // Post-order: a block's pieces are settled before it is.
  const order = [];
  const stack = [[root, false]];
  while (stack.length > 0) {
    const [node, inText] = stack.pop();
    order.push([node, inText]);
    const here = inText || TEXT_BLOCKS.has(node.name) || INLINE.has(node.name);
    for (const child of node.children ?? []) if (isElement(child)) stack.push([child, here]);
  }
  const block = new Map();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const [node, inText] = order[i];
    const children = node.children ?? [];
    block.set(
      node,
      !INLINE.has(node.name) || children.some((child) => isElement(child) && block.get(child)),
    );
    if (inText || node === root) continue;
    const generic = GENERIC.has(node.name);
    if (!generic && !HOLDERS.has(node.name)) continue;

    const ownWords = children.some((child) => child.type === 'text' && child.data.trim());
    const out = [];
    let run = [];
    let split = false;
    const flush = () => {
      if (run.some((child) => !isBlank(child))) out.push(element($, 'p', run));
      else out.push(...run);
      run = [];
    };
    let before = null;
    for (const child of children) {
      if (isElement(child) && block.get(child)) {
        flush();
        out.push(child);
        before = null;
        continue;
      }
      if (
        !ownWords &&
        before &&
        isElement(before) &&
        isElement(child) &&
        before.next === child &&
        runTogether(before, child)
      ) {
        flush();
        split = true;
      }
      run.push(child);
      before = child;
    }
    const hasBlocks = children.some((child) => isElement(child) && block.get(child));
    // A list item, cell or quote of one line keeps its line as it is.
    if (!generic && !split && !hasBlocks) continue;
    flush();
    relink(node, out);
    // What it holds now is blocks: so is it.
    block.set(node, true);
  }
}

/** The page's structure, kept for the editor (see above): changes `root` in place. */
export function keepStructure($, root) {
  gridsToTables($, root);
  blocksToLists($, root);
  textIntoParagraphs($, root);
}

/** The most profile links an author keeps (content_authors.same_as, 00256). */
const MAX_PROFILES = 10;
const MAX_LINK_LENGTH = 300;
/** The longest author name (content_authors.name, 00256). */
const MAX_NAME = 120;
const MAX_TITLE = 120;

/** Schema types a page is written as: whose author is the page's. */
const WRITTEN = new Set([
  'Article',
  'BlogPosting',
  'NewsArticle',
  'TechArticle',
  'ScholarlyArticle',
  'Report',
  'HowTo',
  'Review',
  'WebPage',
  'AboutPage',
  'FAQPage',
  'CollectionPage',
]);

/** A person's name as an author: words, not an address or a sentence. */
function personName(value) {
  const name = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^by\s+/i, '');
  if (name.length < 2 || name.length > MAX_NAME) return null;
  if (/[@/]|https?:|\.\w{2,}$/i.test(name) || name.split(' ').length > 6) return null;
  return name;
}

const httpsLink = (value) =>
  typeof value === 'string' && /^https:\/\//i.test(value) && value.length <= MAX_LINK_LENGTH
    ? value
    : null;

const typesOf = (node) => [node?.['@type']].flat().map(String);

/** Every object in a JSON-LD value: its @graph, lists and nested objects. */
function nodesOf(value) {
  const found = [];
  const stack = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (node && typeof node === 'object') {
      found.push(node);
      for (const child of Object.values(node))
        if (child && typeof child === 'object') stack.push(child);
    }
  }
  return found;
}

/**
 * The person a page's schema says it is by: the author of the article (or
 * page) it describes, its @id looked up in the page's other JSON-LD. Null
 * when it names none or an organization (the page is the brand's).
 */
function schemaAuthor(jsonLd) {
  const nodes = jsonLd.flatMap((text) => {
    try {
      return nodesOf(JSON.parse(text));
    } catch {
      return [];
    }
  });
  const byId = new Map(
    nodes.filter((node) => typeof node['@id'] === 'string').map((n) => [n['@id'], n]),
  );
  const written = nodes.filter(
    (node) => node.author && typesOf(node).some((type) => WRITTEN.has(type)),
  );
  // The article's before the page's: a WebPage may name its publisher.
  written.sort(
    (a, b) => Number(typesOf(a).includes('WebPage')) - Number(typesOf(b).includes('WebPage')),
  );
  for (const node of written) {
    let author = [node.author].flat()[0];
    if (author && typeof author === 'object' && author['@id'] && !author.name) {
      author = byId.get(author['@id']) ?? author;
    }
    if (typeof author === 'string') {
      const name = personName(author);
      return name ? { name } : null;
    }
    if (!author || typeof author !== 'object') continue;
    if (typesOf(author).some((type) => type === 'Organization' || type.endsWith('Organization'))) {
      return null;
    }
    const name = personName(author.name);
    if (!name) continue;
    const image = [author.image].flat()[0];
    const title = typeof author.jobTitle === 'string' ? author.jobTitle.trim() : '';
    return {
      name,
      title: title && title.length <= MAX_TITLE ? title : null,
      photoUrl: httpsLink(typeof image === 'string' ? image : image?.url),
      sameAs: [...new Set([author.sameAs].flat().map(httpsLink).filter(Boolean))].slice(
        0,
        MAX_PROFILES,
      ),
    };
  }
  return null;
}

/**
 * The person a page is by, before its furniture goes: what its schema says
 * (schemaAuthor), else its author meta tag, its marked-up author, or its
 * author box or byline (a name in a heading or a "name" block). Null when it
 * names nobody: the editor shows the brand's byline ("{Brand} Team").
 */
export function pageAuthor($, jsonLd, pageUrl) {
  const fromSchema = schemaAuthor(jsonLd);
  if (fromSchema) return fromSchema;

  const plain = (name) => (name ? { name, title: null, photoUrl: null, sameAs: [] } : null);
  const meta = personName($('meta[name="author"]').attr('content'));
  if (meta) return plain(meta);
  for (const el of $('[itemprop="author"], [rel="author"]').toArray()) {
    const named = $(el).find('[itemprop="name"]').first();
    const name = personName(named.length ? named.text() : $(el).text());
    if (name) return plain(name);
  }
  for (const box of $('[class*="author"], [class*="byline"]').toArray()) {
    const words = wordsOf(box);
    if (!words.some((word) => word === 'author' || word === 'byline')) continue;
    const $box = $(box);
    const named = $box
      .find('[class*="name"], h2, h3, h4, h5, h6, strong')
      .toArray()
      .map((el) => personName($(el).text()))
      .find(Boolean);
    const name = named ?? (words.includes('byline') ? personName($box.text()) : null);
    if (!name) continue;
    let photoUrl = null;
    try {
      const src = $box.find('img[src]').first().attr('src');
      photoUrl = src ? httpsLink(new URL(src, pageUrl).toString()) : null;
    } catch {
      photoUrl = null;
    }
    const profiles = $box
      .find('a[href]')
      .toArray()
      .map((a) => httpsLink($(a).attr('href')))
      .filter((href) => href && !href.startsWith(new URL(pageUrl).origin));
    return { name, title: null, photoUrl, sameAs: [...new Set(profiles)].slice(0, MAX_PROFILES) };
  }
  return null;
}
