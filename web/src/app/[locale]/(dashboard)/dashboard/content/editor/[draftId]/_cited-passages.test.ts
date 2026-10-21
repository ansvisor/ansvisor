import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { passageKey } from '@/lib/content/cited-passages';
import {
  CITED_EDIT_ALLOWED,
  CitedPassages,
  citedPassagesKey,
  lockedPassageCount,
  type HeldEdit,
} from './_cited-passages';

vi.mock('@/lib/content/cited-passages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/content/cited-passages')>();
  return { ...actual, passageKey: vi.fn(actual.passageKey) };
});

if (!('getClientRects' in Range.prototype)) {
  Object.assign(Range.prototype, {
    getClientRects: () => [] as unknown as DOMRectList,
    getBoundingClientRect: () => new DOMRect(),
  });
}

const QUOTED = 'Northwind forecasts each deal from real activity.';
const page = Array.from({ length: 200 }, (_, i) =>
  i === 5 ? `<p>${QUOTED}</p>` : `<p>Paragraph ${i} of the guide.</p>`,
).join('');

let editor: Editor;
const held: HeldEdit[] = [];

/** The position of the paragraph holding this text. */
function paragraphAt(text: string): { from: number; to: number } {
  let found = { from: -1, to: -1 };
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent === text)
      found = { from: pos, to: pos + node.nodeSize };
    return !node.isTextblock;
  });
  return found;
}

beforeEach(() => {
  held.length = 0;
  editor = new Editor({
    extensions: [StarterKit, CitedPassages.configure({ onHeld: (edit) => held.push(edit) })],
    content: page,
  });
  editor.view.dispatch(
    editor.state.tr.setMeta(citedPassagesKey, {
      labels: new Map([[passageKey(QUOTED), 'Cited by ChatGPT 3×']]),
      unlocked: new Set(),
    }),
  );
  vi.mocked(passageKey).mockClear();
});

afterEach(() => editor.destroy());

describe('locked passages', () => {
  it('marks the quoted passage and counts it', () => {
    expect(lockedPassageCount(editor.state)).toBe(1);
    expect(editor.view.dom.querySelectorAll('.cited-passage')).toHaveLength(1);
  });

  it('reads only the paragraph a keystroke changes, not the whole page', () => {
    const { from } = paragraphAt('Paragraph 100 of the guide.');
    editor.view.dispatch(editor.state.tr.insertText('x', from + 2));
    // The changed paragraph, before and after; 199 others untouched.
    expect(vi.mocked(passageKey).mock.calls.length).toBeLessThanOrEqual(2);
    expect(lockedPassageCount(editor.state)).toBe(1);
    expect(held).toEqual([]);
  });

  it('keeps the mark when typing in the paragraph just before or after the quoted one', () => {
    for (const neighbour of ['Paragraph 4 of the guide.', 'Paragraph 6 of the guide.']) {
      const { from } = paragraphAt(neighbour);
      editor.view.dispatch(editor.state.tr.insertText('x', from + 2));
    }
    expect(editor.view.dom.querySelectorAll('.cited-passage')).toHaveLength(1);
    expect(lockedPassageCount(editor.state)).toBe(1);
  });

  it('holds a change that takes the quoted passage out, and lets one through when allowed', () => {
    const { from, to } = paragraphAt(QUOTED);
    editor.view.dispatch(editor.state.tr.delete(from, to));
    expect(held).toHaveLength(1);
    expect(paragraphAt(QUOTED).from).toBe(from);

    editor.view.dispatch(editor.state.tr.delete(from, to).setMeta(CITED_EDIT_ALLOWED, true));
    expect(paragraphAt(QUOTED).from).toBe(-1);
    expect(lockedPassageCount(editor.state)).toBe(0);
  });

  it('lets the quoted passage move: it is still in the page', () => {
    const { from, to } = paragraphAt(QUOTED);
    const slice = editor.state.doc.slice(from, to);
    const end = editor.state.doc.content.size;
    editor.view.dispatch(editor.state.tr.insert(end, slice.content).delete(from, to));
    expect(held).toEqual([]);
    expect(paragraphAt(QUOTED).from).toBeGreaterThan(from);
    expect(lockedPassageCount(editor.state)).toBe(1);
  });
});
