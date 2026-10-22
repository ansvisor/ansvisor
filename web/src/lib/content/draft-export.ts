import { slugify } from '@/lib/slug';
import { safeLinkHref } from './editor';

/**
 * Export in the Content Editor: the page as Word, HTML or Markdown, from the
 * HTML Copy HTML gives (publishableHtml). HTML is that page as a document of
 * its own. Word and Markdown read it as blocks first: headings, paragraphs,
 * quotes, lists, tables, and anything else an HTML block holds. Markdown keeps
 * that last as HTML, Word keeps its text. The schema JSON-LD is the page's
 * markup, not its text, so only the HTML file carries it.
 */

export type DraftExportFormat = 'docx' | 'html' | 'md';

/** A stretch of text with one format; a link carries its address. */
export interface DraftRun {
  text: string;
  bold?: boolean;
  italics?: boolean;
  link?: string;
  /** A line break (a <br>), with no text. */
  break?: boolean;
}

export type DraftBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; runs: DraftRun[] }
  | { kind: 'paragraph'; runs: DraftRun[] }
  | { kind: 'quote'; paragraphs: DraftRun[][] }
  /** One list item; `list` tells a numbered list's items from the next list's. */
  | { kind: 'item'; ordered: boolean; level: number; list: number; n: number; runs: DraftRun[] }
  | { kind: 'table'; rows: { header: boolean; cells: DraftRun[][] }[] }
  /** Anything else, as an HTML block holds it: its HTML, and the blocks inside it. */
  | { kind: 'html'; html: string; blocks: DraftBlock[] };

const childrenOf = (el: Element) => Array.from(el.childNodes);

const HEADINGS: Record<string, 1 | 2 | 3> = { h1: 1, h2: 2, h3: 3, h4: 3, h5: 3, h6: 3 };
const SKIPPED = new Set(['script', 'style', 'template', 'noscript']);

function sameFormat(a: DraftRun, b: DraftRun) {
  return !a.break && !b.break && a.bold === b.bold && a.italics === b.italics && a.link === b.link;
}

/** The runs in some nodes: whitespace collapsed as a browser shows it, trimmed at the ends. */
function inlineRuns(nodes: Node[]): DraftRun[] {
  const runs: DraftRun[] = [];
  const walk = (node: Node, format: Omit<DraftRun, 'text'>) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      if (!text) return;
      const last = runs.at(-1);
      if (last && sameFormat(last, { text, ...format })) last.text += text;
      else runs.push({ text, ...format });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIPPED.has(tag)) return;
    if (tag === 'br') {
      runs.push({ text: '', break: true });
      return;
    }
    if (tag === 'img') {
      const src = safeLinkHref(el.getAttribute('src') ?? '');
      const alt = el.getAttribute('alt')?.trim() || 'Image';
      runs.push({ text: `[${alt}]`, ...format, ...(src ? { link: src } : {}) });
      return;
    }
    const next = { ...format };
    if (tag === 'strong' || tag === 'b') next.bold = true;
    if (tag === 'em' || tag === 'i') next.italics = true;
    if (tag === 'a') {
      const href = safeLinkHref(el.getAttribute('href') ?? '');
      if (href) next.link = href;
    }
    el.childNodes.forEach((child) => walk(child, next));
  };
  nodes.forEach((node) => walk(node, {}));
  // Trimmed at the ends, as a browser shows a block's text.
  while (runs.length && !runs[0].break && !runs[0].text.trim()) runs.shift();
  while (runs.length && !runs.at(-1)!.break && !runs.at(-1)!.text.trim()) runs.pop();
  if (runs.length && !runs[0].break) runs[0].text = runs[0].text.trimStart();
  if (runs.length && !runs.at(-1)!.break) runs.at(-1)!.text = runs.at(-1)!.text.trimEnd();
  return runs;
}

/** A list's items in order, a nested list's one level down. */
function listItems(list: Element, level: number, counter: { lists: number }): DraftBlock[] {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const id = counter.lists++;
  const items: DraftBlock[] = [];
  let n = 0;
  for (const li of Array.from(list.children)) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    n += 1;
    // The item's own text, without the lists nested in it.
    const own = li.cloneNode(true) as Element;
    own.querySelectorAll('ul, ol').forEach((nested) => nested.remove());
    items.push({ kind: 'item', ordered, level, list: id, n, runs: inlineRuns(childrenOf(own)) });
    for (const nested of Array.from(li.children)) {
      const tag = nested.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') items.push(...listItems(nested, level + 1, counter));
    }
  }
  return items;
}

function tableRows(table: Element): Extract<DraftBlock, { kind: 'table' }>['rows'] {
  return Array.from(table.querySelectorAll('tr'))
    .filter((tr) => tr.closest('table') === table)
    .map((tr) => {
      const cells = Array.from(tr.children).filter((c) => /^t[hd]$/i.test(c.tagName));
      return {
        header: cells.length > 0 && cells.every((c) => c.tagName.toLowerCase() === 'th'),
        cells: cells.map((c) => inlineRuns(childrenOf(c))),
      };
    });
}

function blocksIn(parent: Element, counter: { lists: number }): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Loose text between blocks, as an HTML block may leave it.
      const runs = inlineRuns([node]);
      if (runs.length) blocks.push({ kind: 'paragraph', runs });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIPPED.has(tag)) continue;
    if (tag in HEADINGS) {
      blocks.push({ kind: 'heading', level: HEADINGS[tag], runs: inlineRuns(childrenOf(el)) });
    } else if (tag === 'p') {
      const runs = inlineRuns(childrenOf(el));
      if (runs.length) blocks.push({ kind: 'paragraph', runs });
    } else if (tag === 'blockquote') {
      const inner = el.querySelector('p') ? Array.from(el.querySelectorAll('p')) : [el];
      const paragraphs = inner.map((p) => inlineRuns(childrenOf(p))).filter((runs) => runs.length);
      if (paragraphs.length) blocks.push({ kind: 'quote', paragraphs });
    } else if (tag === 'ul' || tag === 'ol') {
      blocks.push(...listItems(el, 0, counter));
    } else if (tag === 'table') {
      const rows = tableRows(el);
      if (rows.length) blocks.push({ kind: 'table', rows });
    } else if (tag === 'img') {
      blocks.push({ kind: 'paragraph', runs: inlineRuns([el]) });
    } else {
      blocks.push({ kind: 'html', html: el.outerHTML, blocks: blocksIn(el, counter) });
    }
  }
  return blocks;
}

const text = (runs: DraftRun[]) => runs.map((r) => (r.break ? '\n' : r.text)).join('');

/**
 * The page as blocks. A page without an H1 opens with its title as one, so
 * the file says what it is.
 */
export function draftBlocks(title: string, html: string): DraftBlock[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks = blocksIn(doc.body, { lists: 0 });
  const hasTitle = blocks.some((b) => b.kind === 'heading' && b.level === 1);
  return hasTitle || !title.trim()
    ? blocks
    : [{ kind: 'heading', level: 1, runs: [{ text: title.trim() }] }, ...blocks];
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Export HTML: Copy HTML's page as a document of its own, titled. */
export function draftHtmlDocument(title: string, html: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title.trim())}</title>`,
    '</head>',
    '<body>',
    html.trim(),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Characters Markdown would read as its own: escaped, so the text reads as written. */
function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>|])/g, '\\$1').replace(/^(\s*)([#+-]|\d+\.)(?=\s)/, '$1\\$2');
}

function markdownRuns(runs: DraftRun[], lineBreak: string): string {
  return runs
    .map((run) => {
      if (run.break) return lineBreak;
      if (!run.text.trim()) return run.text;
      // The marks hug the words: "**bold** text", not "** bold **text".
      const lead = run.text.match(/^\s*/)![0];
      const tail = run.text.match(/\s*$/)![0];
      let out = escapeMarkdown(run.text.trim());
      if (run.bold) out = `**${out}**`;
      if (run.italics) out = `*${out}*`;
      if (run.link) out = `[${out}](${run.link.replace(/[()\s]/g, encodeURIComponent)})`;
      return lead + out + tail;
    })
    .join('');
}

function markdownBlock(block: DraftBlock): string {
  switch (block.kind) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${markdownRuns(block.runs, ' ')}`;
    case 'paragraph':
      return markdownRuns(block.runs, '  \n');
    case 'quote':
      return block.paragraphs.map((p) => `> ${markdownRuns(p, '  \n> ')}`).join('\n>\n');
    case 'item':
      return `${'    '.repeat(block.level)}${block.ordered ? `${block.n}.` : '-'} ${markdownRuns(block.runs, ' ')}`;
    case 'table': {
      const width = Math.max(...block.rows.map((r) => r.cells.length));
      const line = (cells: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
      const rows = block.rows.map((r) => r.cells.map((c) => markdownRuns(c, '<br>')));
      return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
    }
    case 'html':
      return block.html;
  }
}

/** Export Markdown: headings, emphasis, links, lists, quotes and tables; an HTML block as HTML. */
export function draftMarkdown(title: string, html: string): string {
  const blocks = draftBlocks(title, html);
  const parts: string[] = [];
  blocks.forEach((block, i) => {
    // A list's items one under the other; a blank line between other blocks.
    const prev = blocks[i - 1];
    if (i > 0) parts.push(block.kind === 'item' && prev?.kind === 'item' ? '\n' : '\n\n');
    parts.push(markdownBlock(block));
  });
  return `${parts.join('')}\n`;
}

/** Export Word: the blocks as a document, the lists numbered and bulleted as on the page. */
export async function draftDocx(title: string, html: string): Promise<Blob> {
  // Loaded on the click: the library is only needed to write the file.
  const {
    AlignmentType,
    Document,
    ExternalHyperlink,
    HeadingLevel,
    LevelFormat,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import('docx');
  const blocks = draftBlocks(title, html);
  const HEADING = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
  } as const;

  const children = (runs: DraftRun[], extra: { bold?: boolean; italics?: boolean } = {}) =>
    runs.map((run) => {
      if (run.break) return new TextRun({ text: '', break: 1 });
      const textRun = new TextRun({
        text: run.text,
        bold: run.bold || extra.bold,
        italics: run.italics || extra.italics,
        ...(run.link ? { style: 'Hyperlink' } : {}),
      });
      return run.link ? new ExternalHyperlink({ link: run.link, children: [textRun] }) : textRun;
    });

  const content = (
    list: DraftBlock[],
  ): (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] =>
    list.flatMap((block) => {
      switch (block.kind) {
        case 'heading':
          return [new Paragraph({ heading: HEADING[block.level], children: children(block.runs) })];
        case 'paragraph':
          return [new Paragraph({ children: children(block.runs) })];
        case 'quote':
          return block.paragraphs.map(
            (p) =>
              new Paragraph({ indent: { left: 720 }, children: children(p, { italics: true }) }),
          );
        case 'item':
          return [
            new Paragraph({
              children: children(block.runs),
              ...(block.ordered
                ? { numbering: { reference: 'numbered', level: block.level, instance: block.list } }
                : { bullet: { level: block.level } }),
            }),
          ];
        case 'table':
          return [
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: block.rows.map(
                (row) =>
                  new TableRow({
                    tableHeader: row.header,
                    children: row.cells.map(
                      (cell) =>
                        new TableCell({
                          children: [
                            new Paragraph({ children: children(cell, { bold: row.header }) }),
                          ],
                        }),
                    ),
                  }),
              ),
            }),
          ];
        case 'html':
          return content(block.blocks);
      }
    });

  const document = new Document({
    title: title.trim() || text(blocks.find((b) => b.kind === 'heading')?.runs ?? []),
    numbering: {
      config: [
        {
          reference: 'numbered',
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: content(blocks) }],
  });
  return Packer.toBlob(document);
}

/** The file for a format: Word built on the click, HTML and Markdown as UTF-8 text. */
export async function draftExportBlob(
  format: DraftExportFormat,
  title: string,
  html: string,
): Promise<Blob> {
  if (format === 'docx') return draftDocx(title, html);
  return format === 'html'
    ? new Blob([draftHtmlDocument(title, html)], { type: 'text/html;charset=utf-8' })
    : new Blob([draftMarkdown(title, html)], { type: 'text/markdown;charset=utf-8' });
}

/** "ansvisor_content_pipeline-forecasting.docx". */
export function draftExportFileName(title: string, format: DraftExportFormat): string {
  const slug = slugify(title).slice(0, 60).replace(/-+$/, '') || 'page';
  return `ansvisor_content_${slug}.${format}`;
}
