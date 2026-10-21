import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { passageKey } from '@/lib/content/cited-passages';

/**
 * Locked passages in the editor (CE-018): a passage AI answers quote today
 * is marked, green with "Cited by … · keep wording" above it, and a change to
 * it waits for the person to say so. Typing in one, deleting it, pasting
 * over it or joining it to another is held and asked about; "Edit anyway"
 * lets it through. Passages are matched by their words, so one changed
 * stops being the quoted one.
 */

/** Meta on a transaction allowed to change locked passages: confirmed, or a whole new page. */
export const CITED_EDIT_ALLOWED = 'citedEditAllowed';

export interface CitedLocks {
  /** The label of each quoted passage, by its key (passageKey). */
  labels: Map<string, string>;
  /** Passages the person chose to edit anyway, by key. */
  unlocked: Set<string>;
}

/** A change held because it touches a locked passage. */
export interface HeldEdit {
  /** The passage it touches. */
  key: string;
  /** The change itself, to apply on "Edit anyway"; none for typing, which is typed again. */
  tr: Transaction | null;
}

/** The plugin's state: the locks, and the passages marked in the page. */
interface CitedState {
  locks: CitedLocks;
  marks: DecorationSet;
}

export const citedPassagesKey = new PluginKey<CitedState>('citedPassages');

const NO_LOCKS: CitedLocks = { labels: new Map(), unlocked: new Set() };

/** The locks the editor has now. */
export function citedLocks(state: EditorState): CitedLocks {
  return citedPassagesKey.getState(state)?.locks ?? NO_LOCKS;
}

/**
 * A textblock's passage key. A change replaces only the nodes it touches;
 * every other block is the same node object in the next doc, so its key is
 * worked out once, not on every keystroke.
 */
const passageKeys = new WeakMap<PmNode, string>();
export function blockKey(node: PmNode): string {
  let key = passageKeys.get(node);
  if (key === undefined) {
    key = passageKey(node.textContent);
    passageKeys.set(node, key);
  }
  return key;
}

const isLocked = (key: string, locks: CitedLocks) =>
  locks.labels.has(key) && !locks.unlocked.has(key);

/** The textblocks in or beside these ranges of the doc, by position. */
function blocksIn(doc: PmNode, ranges: [number, number][]): { pos: number; node: PmNode }[] {
  const found = new Map<number, PmNode>();
  for (const [a, b] of ranges) {
    const from = Math.max(0, Math.min(a, b) - 1);
    const to = Math.min(doc.content.size, Math.max(a, b) + 1);
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      found.set(pos, node);
      return false;
    });
  }
  return [...found].map(([pos, node]) => ({ pos, node }));
}

/**
 * What a transaction changed: the ranges of the doc before it and of the
 * doc after it. Every other block is the same in both.
 */
function changedRanges(tr: Transaction): { before: [number, number][]; after: [number, number][] } {
  const maps = tr.mapping.maps;
  const before: [number, number][] = [];
  const after: [number, number][] = [];
  maps.forEach((map, i) => {
    const back = new Mapping(maps.slice(0, i)).invert();
    const ahead = new Mapping(maps.slice(i + 1));
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      before.push([back.map(oldStart, -1), back.map(oldEnd, 1)]);
      after.push([ahead.map(newStart, -1), ahead.map(newEnd, 1)]);
    });
  });
  return { before, after };
}

/** How many times each locked passage is among these blocks. */
function lockedCounts(blocks: { node: PmNode }[], locks: CitedLocks): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { node } of blocks) {
    const key = blockKey(node);
    if (isLocked(key, locks)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The mark of a quoted passage, if this block is one. */
function markOf(node: PmNode, pos: number, locks: CitedLocks): Decoration | null {
  const label = locks.labels.get(blockKey(node));
  return label
    ? Decoration.node(pos, pos + node.nodeSize, {
        class: 'cited-passage',
        'data-cited-label': label,
      })
    : null;
}

/** Every quoted passage in the page, marked: when the locks change. */
function markAll(doc: PmNode, locks: CitedLocks): DecorationSet {
  if (locks.labels.size === 0) return DecorationSet.empty;
  const marks: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const mark = markOf(node, pos, locks);
    if (mark) marks.push(mark);
    return false;
  });
  return DecorationSet.create(doc, marks);
}

/** The locked passage the selection is in or covers, if any. */
function lockedAtSelection(state: EditorState, locks: CitedLocks): string | null {
  const { from, to } = state.selection;
  let found: string | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    const key = blockKey(node);
    if (isLocked(key, locks)) found = key;
    return false;
  });
  return found;
}

/** How many quoted passages the page has now (the marks the plugin keeps). */
export function lockedPassageCount(state: EditorState): number {
  return citedPassagesKey.getState(state)?.marks.find().length ?? 0;
}

export const CitedPassages = Extension.create<{ onHeld: (edit: HeldEdit) => void }>({
  name: 'citedPassages',

  addOptions() {
    return { onHeld: () => {} };
  },

  addProseMirrorPlugins() {
    const { onHeld } = this.options;
    return [
      new Plugin<CitedState>({
        key: citedPassagesKey,
        state: {
          init: () => ({ locks: NO_LOCKS, marks: DecorationSet.empty }),
          apply: (tr, value) => {
            const locks = tr.getMeta(citedPassagesKey) as CitedLocks | undefined;
            if (locks) return { locks, marks: markAll(tr.doc, locks) };
            if (!tr.docChanged || value.locks.labels.size === 0) return value;
            // The marks move with the page; only the blocks the change
            // touched can gain or lose one.
            let marks = value.marks.map(tr.mapping, tr.doc);
            for (const { pos, node } of blocksIn(tr.doc, changedRanges(tr).after)) {
              // find() also returns the marks that only touch the block's
              // edges (its neighbours'): only its own is taken off.
              const end = pos + node.nodeSize;
              marks = marks.remove(
                marks.find(pos, end).filter((d) => d.from === pos && d.to === end),
              );
              const mark = markOf(node, pos, value.locks);
              if (mark) marks = marks.add(tr.doc, [mark]);
            }
            return { locks: value.locks, marks };
          },
        },
        // A change that would take a locked passage out of the page waits.
        // Only the blocks it touched can change that: their locked passages
        // before and after are compared, so moving one is fine.
        filterTransaction: (tr, state) => {
          if (!tr.docChanged || tr.getMeta(CITED_EDIT_ALLOWED)) return true;
          const locks = citedLocks(state);
          if (locks.labels.size === 0) return true;
          const ranges = changedRanges(tr);
          const before = lockedCounts(blocksIn(tr.before, ranges.before), locks);
          if (before.size === 0) return true;
          const after = lockedCounts(blocksIn(tr.doc, ranges.after), locks);
          for (const [key, n] of before) {
            if ((after.get(key) ?? 0) < n) {
              onHeld({ key, tr });
              return false;
            }
          }
          return true;
        },
        props: {
          decorations: (state) => citedPassagesKey.getState(state)?.marks ?? null,
          // Typed text and deletes go straight to the page, before any
          // transaction: they are held here, on the key.
          handleKeyDown: (view, event) => {
            if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
            const edits =
              event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete';
            if (!edits) return false;
            const key = lockedAtSelection(view.state, citedLocks(view.state));
            if (!key) return false;
            onHeld({ key, tr: null });
            return true;
          },
        },
      }),
    ];
  },
});
