import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
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

export const citedPassagesKey = new PluginKey<CitedLocks>('citedPassages');

const NO_LOCKS: CitedLocks = { labels: new Map(), unlocked: new Set() };

/** The locks the editor has now. */
export function citedLocks(state: EditorState): CitedLocks {
  return citedPassagesKey.getState(state) ?? NO_LOCKS;
}

/** Each locked passage's key in the page, with how many times it is there. */
function lockedCounts(doc: PmNode, locks: CitedLocks): Map<string, number> {
  const counts = new Map<string, number>();
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    const key = passageKey(node.textContent);
    if (locks.labels.has(key) && !locks.unlocked.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return false;
  });
  return counts;
}

/** The locked passage the selection is in or covers, if any. */
function lockedAtSelection(state: EditorState, locks: CitedLocks): string | null {
  const { from, to } = state.selection;
  let found: string | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    const key = passageKey(node.textContent);
    if (locks.labels.has(key) && !locks.unlocked.has(key)) found = key;
    return false;
  });
  return found;
}

/** How many locked passages the page has now. */
export function lockedPassageCount(state: EditorState): number {
  const locks = citedLocks(state);
  if (locks.labels.size === 0) return 0;
  let count = 0;
  for (const n of lockedCounts(state.doc, { ...locks, unlocked: new Set() }).values()) count += n;
  return count;
}

export const CitedPassages = Extension.create<{ onHeld: (edit: HeldEdit) => void }>({
  name: 'citedPassages',

  addOptions() {
    return { onHeld: () => {} };
  },

  addProseMirrorPlugins() {
    const { onHeld } = this.options;
    return [
      new Plugin<CitedLocks>({
        key: citedPassagesKey,
        state: {
          init: () => NO_LOCKS,
          apply: (tr, locks) => (tr.getMeta(citedPassagesKey) as CitedLocks | undefined) ?? locks,
        },
        // A change that would take a locked passage out of the page waits.
        filterTransaction: (tr, state) => {
          if (!tr.docChanged || tr.getMeta(CITED_EDIT_ALLOWED)) return true;
          const locks = citedLocks(state);
          if (locks.labels.size === 0) return true;
          const before = lockedCounts(state.doc, locks);
          if (before.size === 0) return true;
          const after = lockedCounts(tr.doc, locks);
          for (const [key, n] of before) {
            if ((after.get(key) ?? 0) < n) {
              onHeld({ key, tr });
              return false;
            }
          }
          return true;
        },
        props: {
          decorations: (state) => {
            const locks = citedLocks(state);
            if (locks.labels.size === 0) return null;
            const marks: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isTextblock) return true;
              const label = locks.labels.get(passageKey(node.textContent));
              if (label) {
                marks.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: 'cited-passage',
                    'data-cited-label': label,
                  }),
                );
              }
              return false;
            });
            return DecorationSet.create(state.doc, marks);
          },
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
