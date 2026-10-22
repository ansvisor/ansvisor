import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { onEmptyLine } from './_toolbar';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** An editor on the page, with the cursor at `pos`. */
function at(content: string, pos: number) {
  editor = new Editor({ extensions: [StarterKit], content });
  editor.commands.setTextSelection(pos);
  return onEmptyLine(editor, editor.state);
}

describe('onEmptyLine', () => {
  // "<h1>Title</h1>" takes positions 0–7: the empty paragraph after it opens at 7.
  it('offers the insert menu on an empty line between blocks', () => {
    expect(at('<h1>Title</h1><p></p><p>Text</p>', 8)).toBe(true);
  });

  it('not on a line with text, a heading or a list item', () => {
    expect(at('<h1>Title</h1><p></p><p>Text</p>', 11)).toBe(false);
    expect(at('<h1>Title</h1><p></p>', 3)).toBe(false);
    expect(at('<h1>Title</h1><ul><li><p></p></li></ul>', 10)).toBe(false);
  });

  it('not on an empty page, where the placeholder shows', () => {
    expect(at('<p></p>', 1)).toBe(false);
  });
});
