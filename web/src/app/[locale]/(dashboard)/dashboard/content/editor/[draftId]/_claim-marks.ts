import { Extension, getHTMLFromFragment, type Editor } from '@tiptap/core';
import { Fragment, type Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { trustBlocks, type ClaimMark } from '@/lib/content/quality-checks';

/**
 * Claims with no source in the draft (Quality spec §3, CE-045): a red wavy
 * underline on the claim's words, with why on hover. A decoration, never
 * the page's, so no save, export, copy or CMS push has it. Quality's
 * suggestion has Show, Add source and Remove.
 */

export interface ClaimMarks {
  /** The claims to underline (trust's marks), each in its block. */
  marks: readonly ClaimMark[];
  /** Why, on hover. */
  title: string;
}

interface ClaimState extends ClaimMarks {
  decorations: DecorationSet;
}

export const claimMarksKey = new PluginKey<ClaimState>('claimMarks');

const CLAIM =
  'underline decoration-wavy decoration-red-500 underline-offset-4 dark:decoration-red-400';

const squeeze = (text: string) => text.replace(/\s+/g, '');

/**
 * Where a text is in the page, as document positions: each place it is in
 * a paragraph that holds it whole and, with `block`, is part of that Trust
 * block (its text, as trustBlocks reads it). Headings and code aren't
 * Trust's. Spaces don't count: Trust's text has one at each tag's edge
 * ("( report)", "40 %") and at a line break, where the page may have none.
 * Its words may run across marks (a bold word, a link), not across blocks.
 */
export function textRanges(
  doc: PmNode,
  text: string,
  block?: string,
): { from: number; to: number }[] {
  const needle = squeeze(text);
  if (!needle) return [];
  const within = block === undefined ? null : squeeze(block);
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === 'heading' || node.type.spec.code) return false;
    // The paragraph's words without their spaces, each at its position.
    let words = '';
    const at: number[] = [];
    node.forEach((child, offset) => {
      const own = child.isText ? (child.text ?? '') : '';
      for (let i = 0; i < own.length; i++) {
        if (/\s/.test(own[i])) continue;
        words += own[i];
        at.push(pos + 1 + offset + i);
      }
    });
    if (!words || (within !== null && !within.includes(words))) return false;
    for (let i = words.indexOf(needle); i !== -1; i = words.indexOf(needle, i + 1)) {
      ranges.push({ from: at[i], to: at[i + needle.length - 1] + 1 });
    }
    return false;
  });
  return ranges;
}

const CELLS = new Set(['tableCell', 'tableHeader']);
const HOLDERS = new Set(['listItem', 'taskItem', 'blockquote']);

/**
 * The text of the Trust block the cursor is in, as trustBlocks reads it
 * from the block as it saves: the one the claims' ask leaves for later
 * (the API hashes it as it does the page's). Null in a heading or code,
 * which Trust doesn't read.
 */
export function writingBlock(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  // A cell holds all that's in it; else a list item or a quote holds its paragraphs.
  let depth = $from.depth;
  const holder = (names: Set<string>) => {
    for (let d = $from.depth; d > 0; d--) if (names.has($from.node(d).type.name)) return d;
    return -1;
  };
  const cell = holder(CELLS);
  const held = cell !== -1 ? cell : holder(HOLDERS);
  if (held !== -1) depth = held;
  const node = $from.node(depth);
  const html = getHTMLFromFragment(Fragment.from(node), editor.schema);
  // A cell is read only in its table.
  const page = CELLS.has(node.type.name) ? `<table><tbody><tr>${html}</tr></tbody></table>` : html;
  return trustBlocks(page)[0]?.text ?? null;
}

function decorate(doc: PmNode, { marks, title }: ClaimMarks): DecorationSet {
  if (!marks.length) return DecorationSet.empty;
  const decorations = marks.flatMap((mark) =>
    textRanges(doc, mark.text, mark.block).map(({ from, to }) =>
      Decoration.inline(from, to, { class: CLAIM, title }),
    ),
  );
  return DecorationSet.create(doc, decorations);
}

export const ClaimMarksExtension = Extension.create({
  name: 'claimMarks',

  addProseMirrorPlugins() {
    return [
      new Plugin<ClaimState>({
        key: claimMarksKey,
        state: {
          init: () => ({ marks: [], title: '', decorations: DecorationSet.empty }),
          // Marked again when the list changes (the page read after typing
          // pauses), and mapped through each change meanwhile: a claim
          // being written over moves with the words around it.
          apply: (tr, prev) => {
            const next = tr.getMeta(claimMarksKey) as ClaimMarks | undefined;
            if (next) return { ...next, decorations: decorate(tr.doc, next) };
            return tr.docChanged
              ? { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) }
              : prev;
          },
        },
        props: {
          decorations: (state) => claimMarksKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});
