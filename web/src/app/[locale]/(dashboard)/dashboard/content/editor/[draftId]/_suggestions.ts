import { Extension } from '@tiptap/core';
import {
  DOMParser as PmDOMParser,
  type Fragment,
  type Node as PmNode,
  type Schema,
} from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { cleanHtml } from '@/lib/content/clean-html';
import { passageKey } from '@/lib/content/cited-passages';
import type { DraftSuggestion } from '@/lib/content/suggestions';
import { blockKey, citedLocks, citedPassagesKey, type CitedLocks } from './_cited-passages';

/**
 * An agent's suggestions in the page (CE-018): each open one is a card where
 * it applies, with who made it and why, the words it removes in red and adds
 * in green, and Reject / Accept. An accepted one keeps a thin green line and
 * Undo; a rejected one a dashed card and Restore. A suggestion finds its
 * passage by the text the agent read, so one the page changed since can only
 * be rejected, and one on a locked passage (AI quotes it) is never applied.
 */

export type SuggestionDecision = 'accept' | 'reject' | 'undo' | 'restore';

/** The words on the cards, from the editor's messages. */
export interface SuggestionLabels {
  agent: string;
  accept: string;
  reject: string;
  accepted: string;
  rejected: string;
  undo: string;
  restore: string;
  locked: string;
  stale: string;
}

interface SuggestionView {
  suggestions: DraftSuggestion[];
  labels: SuggestionLabels | null;
}

/** The plugin's state: the suggestions, and their cards and marks where the page has them. */
interface SuggestionState extends SuggestionView {
  marks: DecorationSet;
}

export const suggestionsKey = new PluginKey<SuggestionState>('agentSuggestions');

const NO_SUGGESTIONS: SuggestionView = { suggestions: [], labels: null };

// ─── Finding a suggestion in the page ─────────────────────────────────────────

/** The passage's text after the accepted replaces on it (other than one), as the page has it. */
function currentKey(s: DraftSuggestion, all: DraftSuggestion[]): string {
  let text = s.blockText;
  for (const other of all) {
    if (
      other.id !== s.id &&
      other.kind === 'replace' &&
      other.status === 'accepted' &&
      other.blockText === s.blockText
    ) {
      // A function, so $ in the agent's text is taken as written.
      text = text.replace(other.beforeText, () => other.afterText);
    }
  }
  return passageKey(text);
}

/** The document position of a character offset in a textblock's text. */
function textPos(block: PmNode, blockPos: number, offset: number): number {
  let left = offset;
  let found = -1;
  block.forEach((child, childOffset) => {
    if (found >= 0) return;
    const length = child.isText ? child.text!.length : 0;
    if (child.isText && left <= length) {
      found = blockPos + 1 + childOffset + left;
      return;
    }
    left -= length;
  });
  return found >= 0 ? found : blockPos + 1 + block.content.size;
}

interface Block {
  node: PmNode;
  pos: number;
}

function findBlock(doc: PmNode, test: (node: PmNode) => boolean): Block | null {
  let found: Block | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    if (test(node)) found = { node, pos };
    return false;
  });
  return found;
}

/** The top-level block holding a position, with where it starts and ends. */
function topBlock(doc: PmNode, pos: number): { index: number; from: number; to: number } | null {
  let found: { index: number; from: number; to: number } | null = null;
  doc.forEach((child, offset, index) => {
    if (!found && pos >= offset && pos < offset + child.nodeSize) {
      found = { index, from: offset, to: offset + child.nodeSize };
    }
  });
  return found;
}

/** Inserts' blocks already read, by schema and HTML: cleaning and parsing is the slow part. */
const insertCache = new WeakMap<Schema, Map<string, Fragment>>();

/** An insert's blocks, as the page's schema reads its HTML (checked like a paste). */
export function insertBlocks(state: EditorState, html: string): Fragment {
  let bySchema = insertCache.get(state.schema);
  if (!bySchema) {
    bySchema = new Map();
    insertCache.set(state.schema, bySchema);
  }
  const known = bySchema.get(html);
  if (known) return known;
  const holder = document.createElement('div');
  holder.innerHTML = cleanHtml(html, { keepImages: false }).html;
  const blocks = PmDOMParser.fromSchema(state.schema).parse(holder).content;
  bySchema.set(html, blocks);
  return blocks;
}

type Placed =
  /** An open or rejected replace: the words it replaces. */
  | { at: 'words'; from: number; to: number; block: Block }
  /** An open or rejected insert: where its blocks go. */
  | { at: 'gap'; pos: number; anchor: Block }
  /** An accepted replace: the words it put in. */
  | { at: 'added'; from: number; to: number; block: Block }
  /** An accepted insert: the blocks it added. */
  | { at: 'blocks'; from: number; to: number };

/**
 * Where a suggestion is in the page now (or in doc, a page a transaction is
 * building), as its status has it; null when the page changed.
 */
export function placeSuggestion(
  state: EditorState,
  s: DraftSuggestion,
  all: DraftSuggestion[],
  doc: PmNode = state.doc,
): Placed | null {
  const key = currentKey(s, all);
  if (s.kind === 'replace') {
    if (s.status === 'accepted') {
      const block = findBlock(doc, (node) => {
        const text = node.textContent;
        return (
          text.includes(s.afterText) &&
          passageKey(text.replace(s.afterText, () => s.beforeText)) === key
        );
      });
      if (!block) return null;
      const offset = block.node.textContent.indexOf(s.afterText);
      return {
        at: 'added',
        block,
        from: textPos(block.node, block.pos, offset),
        to: textPos(block.node, block.pos, offset + s.afterText.length),
      };
    }
    const block = findBlock(
      doc,
      (node) => blockKey(node) === key && node.textContent.includes(s.beforeText),
    );
    if (!block) return null;
    const offset = block.node.textContent.indexOf(s.beforeText);
    return {
      at: 'words',
      block,
      from: textPos(block.node, block.pos, offset),
      to: textPos(block.node, block.pos, offset + s.beforeText.length),
    };
  }

  const anchor = findBlock(doc, (node) => blockKey(node) === key);
  if (!anchor) return null;
  const top = topBlock(doc, anchor.pos);
  if (!top) return null;
  if (s.status !== 'accepted') return { at: 'gap', pos: top.to, anchor };
  const blocks = insertBlocks(state, s.afterText);
  let to = top.to;
  for (let i = 0; i < blocks.childCount; i++) {
    const next = doc.maybeChild(top.index + 1 + i);
    if (!next || next.textContent !== blocks.child(i).textContent) return null;
    to += next.nodeSize;
  }
  return { at: 'blocks', from: top.to, to };
}

/** Whether a passage is locked (AI quotes it) and not opened for editing. */
function lockedBlock(block: Block, locks: CitedLocks): boolean {
  const key = blockKey(block.node);
  return locks.labels.has(key) && !locks.unlocked.has(key);
}

/** Why an open suggestion can't be accepted now, or null. */
export function blockedReason(
  state: EditorState,
  s: DraftSuggestion,
  all: DraftSuggestion[],
  doc: PmNode = state.doc,
  locks: CitedLocks = citedLocks(state),
): 'stale' | 'locked' | null {
  const placed = placeSuggestion(state, { ...s, status: 'open' }, all, doc);
  if (!placed) return 'stale';
  if (placed.at === 'words' && lockedBlock(placed.block, locks)) return 'locked';
  return null;
}

// ─── Accepting and undoing ────────────────────────────────────────────────────

/**
 * Accepts a suggestion into a transaction: the words replaced, or the blocks
 * added. False when the page changed there or the passage is locked.
 */
export function acceptInto(
  tr: Transaction,
  state: EditorState,
  s: DraftSuggestion,
  all: DraftSuggestion[],
): boolean {
  if (blockedReason(state, s, all, tr.doc)) return false;
  const placed = placeSuggestion(state, { ...s, status: 'open' }, all, tr.doc);
  if (!placed) return false;
  if (placed.at === 'words') {
    tr.insertText(s.afterText, placed.from, placed.to);
    return true;
  }
  if (placed.at === 'gap') {
    tr.insert(placed.pos, insertBlocks(state, s.afterText));
    return true;
  }
  return false;
}

/** Undoes an accepted suggestion into a transaction. False when the page changed there since. */
export function undoInto(
  tr: Transaction,
  state: EditorState,
  s: DraftSuggestion,
  all: DraftSuggestion[],
): boolean {
  const placed = placeSuggestion(state, { ...s, status: 'accepted' }, all, tr.doc);
  if (!placed) return false;
  if (placed.at === 'added') {
    tr.insertText(s.beforeText, placed.from, placed.to);
    return true;
  }
  if (placed.at === 'blocks') {
    tr.delete(placed.from, placed.to);
    return true;
  }
  return false;
}

/**
 * A decision's page change made again on the page as it is now, for when the
 * page changed while the decision was saved (an attachment read in, say):
 * each suggestion in the order it was first applied. An undo leaves alone a
 * suggestion that was only rejected (it changed nothing on the page).
 * `failed` names the ones the page no longer has room for.
 */
export function redoDecision(
  state: EditorState,
  all: DraftSuggestion[],
  ids: string[],
  kind: 'accept' | 'undo',
): { tr: Transaction; failed: string[] } {
  const tr = state.tr;
  const list = all.map((s) => ({ ...s }));
  const failed: string[] = [];
  for (const id of ids) {
    const s = list.find((x) => x.id === id);
    if (!s || (kind === 'undo' && s.status !== 'accepted')) continue;
    if (kind === 'accept' ? acceptInto(tr, state, s, list) : undoInto(tr, state, s, list)) {
      s.status = kind === 'accept' ? 'accepted' : 'open';
    } else {
      failed.push(id);
    }
  }
  return { tr, failed };
}

// ─── The cards ────────────────────────────────────────────────────────────────

const BUTTON =
  'rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50';
const PRIMARY =
  'rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50';
const LINK = 'text-xs font-medium text-foreground underline underline-offset-2 hover:no-underline';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(
  className: string,
  text: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  node.disabled = disabled;
  // Keeps the page's selection where it was.
  node.addEventListener('mousedown', (event) => event.preventDefault());
  node.addEventListener('click', onClick);
  return node;
}

/** The card's top line: the agent and why, then its buttons or what was decided. */
function head(s: DraftSuggestion, labels: SuggestionLabels, controls: HTMLElement[]): HTMLElement {
  const line = el('div', 'flex items-center gap-2 text-xs text-muted-foreground');
  line.append(el('span', 'min-w-0 truncate', `${labels.agent} · ${s.reason}`));
  const right = el('span', 'ml-auto flex shrink-0 items-center gap-1.5');
  right.append(...controls);
  line.append(right);
  return line;
}

function badge(text: string, tone: 'ok' | 'no'): HTMLElement {
  return el(
    'span',
    tone === 'ok'
      ? 'rounded-md bg-emerald-50 px-1.5 text-[11px] leading-[18px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      : 'rounded-md bg-muted px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground',
    text,
  );
}

function card(
  s: DraftSuggestion,
  labels: SuggestionLabels,
  blocked: 'stale' | 'locked' | null,
  decide: (id: string, decision: SuggestionDecision) => void,
): HTMLElement {
  if (s.status === 'rejected') {
    const box = el('div', 'not-prose my-3 rounded-xl border border-dashed px-3 py-1.5');
    box.append(
      head(s, labels, [
        badge(labels.rejected, 'no'),
        button(LINK, labels.restore, () => decide(s.id, 'restore')),
      ]),
    );
    box.dataset.suggestion = s.id;
    return box;
  }
  if (s.status === 'accepted') {
    const line = head(s, labels, [
      badge(labels.accepted, 'ok'),
      button(LINK, labels.undo, () => decide(s.id, 'undo')),
    ]);
    line.className += ' not-prose mb-1';
    line.dataset.suggestion = s.id;
    return line;
  }

  const box = el(
    'div',
    'not-prose my-3 rounded-xl border bg-card px-3 py-2.5 text-[14.5px] leading-relaxed shadow-sm',
  );
  box.dataset.suggestion = s.id;
  box.append(
    head(s, labels, [
      button(BUTTON, labels.reject, () => decide(s.id, 'reject')),
      button(PRIMARY, labels.accept, () => decide(s.id, 'accept'), blocked !== null),
    ]),
  );
  const change = el('div', 'mt-1.5');
  if (s.kind === 'replace') {
    change.append(
      el(
        'del',
        'rounded-sm bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
        s.beforeText,
      ),
      document.createTextNode(' '),
      el(
        'ins',
        'rounded-sm bg-emerald-50 text-emerald-800 no-underline dark:bg-emerald-950/40 dark:text-emerald-300',
        s.afterText,
      ),
    );
  } else {
    const added = el(
      'div',
      'rounded-md bg-emerald-50 px-2 py-1 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1',
    );
    added.innerHTML = cleanHtml(s.afterText, { keepImages: false }).html;
    change.append(added);
  }
  box.append(change);
  if (blocked) {
    box.append(el('p', 'mt-1.5 text-xs text-amber-700 dark:text-amber-400', labels[blocked]));
  }
  return box;
}

export const AgentSuggestions = Extension.create<{
  onDecide: (id: string, decision: SuggestionDecision) => void;
}>({
  name: 'agentSuggestions',

  addOptions() {
    return { onDecide: () => {} };
  },

  addProseMirrorPlugins() {
    const decide = (id: string, decision: SuggestionDecision) =>
      this.options.onDecide(id, decision);
    /** The cards and marks for the suggestions where the page has them now. */
    const placeMarks = (
      state: EditorState,
      view: SuggestionView,
      locks: CitedLocks,
    ): DecorationSet => {
      const { suggestions, labels } = view;
      if (!labels || suggestions.length === 0) return DecorationSet.empty;
      const marks: Decoration[] = [];
      // Cards for suggestions the page no longer has a place for go first.
      const unplaced: DraftSuggestion[] = [];
      for (const s of suggestions) {
        const placed = placeSuggestion(state, s, suggestions);
        const blocked =
          s.status === 'open' ? blockedReason(state, s, suggestions, state.doc, locks) : null;
        const widget = (pos: number) =>
          Decoration.widget(pos, () => card(s, labels, blocked, decide), {
            key: `${s.id}:${s.status}:${blocked ?? ''}:${s.reason}`,
            side: -1,
            ignoreSelection: true,
            stopEvent: () => true,
          });
        if (!placed) {
          if (s.status !== 'accepted') unplaced.push(s);
          continue;
        }
        if (placed.at === 'words') {
          marks.push(widget(placed.block.pos));
          if (s.status === 'open') {
            marks.push(
              Decoration.inline(placed.from, placed.to, {
                class: 'rounded-sm bg-amber-100 dark:bg-amber-900/40',
              }),
            );
          }
        } else if (placed.at === 'gap') {
          marks.push(widget(placed.pos));
        } else if (placed.at === 'added') {
          marks.push(widget(placed.block.pos));
          marks.push(
            Decoration.node(placed.block.pos, placed.block.pos + placed.block.node.nodeSize, {
              class: 'agent-accepted',
            }),
            Decoration.inline(placed.from, placed.to, { class: 'agent-accepted-text' }),
          );
        } else {
          marks.push(widget(placed.from));
          state.doc.nodesBetween(placed.from, placed.to, (node, pos) => {
            if (pos >= placed.from && pos + node.nodeSize <= placed.to) {
              marks.push(Decoration.node(pos, pos + node.nodeSize, { class: 'agent-accepted' }));
            }
            return false;
          });
        }
      }
      for (const s of unplaced) {
        const blocked = s.status === 'open' ? 'stale' : null;
        marks.push(
          Decoration.widget(0, () => card(s, labels, blocked, decide), {
            key: `${s.id}:${s.status}:unplaced`,
            side: -1,
            ignoreSelection: true,
            stopEvent: () => true,
          }),
        );
      }
      return DecorationSet.create(state.doc, marks);
    };
    return [
      new Plugin<SuggestionState>({
        key: suggestionsKey,
        state: {
          init: () => ({ ...NO_SUGGESTIONS, marks: DecorationSet.empty }),
          // The cards and marks are placed again only when the page, the
          // suggestions or the locks change, not on every selection move.
          apply: (tr, value, old, state) => {
            const view = tr.getMeta(suggestionsKey) as SuggestionView | undefined;
            const newLocks = tr.getMeta(citedPassagesKey) as CitedLocks | undefined;
            if (!view && !tr.docChanged && !newLocks) return value;
            const next = view ?? { suggestions: value.suggestions, labels: value.labels };
            if (!next.labels || next.suggestions.length === 0) {
              return { ...next, marks: DecorationSet.empty };
            }
            // The locks plugin may not have taken this transaction yet: its
            // locks come from the transaction when it changes them, else as they were.
            return { ...next, marks: placeMarks(state, next, newLocks ?? citedLocks(old)) };
          },
        },
        props: {
          decorations: (state) => suggestionsKey.getState(state)?.marks ?? null,
        },
      }),
    ];
  },
});
