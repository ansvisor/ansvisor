import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanHtml } from './clean-html';
import { editorCharacters, pageDoc } from './doc-text';
import { sanitizeDraftHtml } from './sanitize-draft-html';
import { summarizeContent } from './start';

/**
 * A page brought in by its URL keeps its structure in the editor (Content
 * test 2026-11-19, item 2). The fixture is the API's answer for the saved
 * Webflow post in server/src/lib/__fixtures__/page-structure/webflow-post.html
 * (POST /api/content-pages/import): here it goes the rest of the way, as New
 * content cleans it, a save stores it and the editor reads it.
 */

const imported = readFileSync(join(__dirname, '__fixtures__/imported-webflow-post.html'), 'utf8');

/** The editor's document, as each top-level node's type and words. */
function editorBlocks(html: string) {
  const doc = pageDoc(sanitizeDraftHtml(cleanHtml(html, { keepImages: true }).html));
  const blocks: { type: string; text: string; node: ReturnType<typeof pageDoc> }[] = [];
  doc.forEach((node) => blocks.push({ type: node.type.name, text: node.textContent, node }));
  return blocks;
}

describe('an imported page in the editor', () => {
  it('keeps its comparison as a table, row by row', () => {
    const table = editorBlocks(imported).find((block) => block.type === 'table');
    expect(table).toBeDefined();
    const rows: string[][] = [];
    table!.node.forEach((row) => {
      const cells: string[] = [];
      row.forEach((cell) => cells.push(cell.textContent));
      rows.push(cells);
    });
    expect(rows[0]).toEqual([
      'Full name',
      'Search engine optimization',
      'Answer engine optimization',
      'Generative engine optimization',
    ]);
    expect(rows).toHaveLength(3);
  });

  it('keeps Key takeaways as a list with its items, not an empty section', () => {
    const blocks = editorBlocks(imported);
    const heading = blocks.findIndex((block) => block.text === 'Key takeaways');
    expect(blocks[heading + 1].type).toBe('bulletList');
    expect(blocks[heading + 1].node.childCount).toBe(3);
  });

  it('keeps each card’s title on its own line, above its text', () => {
    // A table's cells are its own blocks: its text reads them run together.
    const texts = editorBlocks(imported)
      .filter((block) => block.type !== 'table')
      .map((block) => block.text);
    const title = texts.lastIndexOf('Prompt tracking');
    expect(title).toBeGreaterThan(-1);
    expect(texts[title + 1]).toMatch(/^It tracks your prompts/);
    expect(texts.some((text) => /trackingIt|Full nameSearch|URLsCitation/.test(text))).toBe(false);
  });

  it('says as many characters in New content as the editor’s counter', () => {
    const cleaned = cleanHtml(imported, { keepImages: true }).html;
    const stored = sanitizeDraftHtml(cleaned);
    expect(summarizeContent(cleaned).characters).toBe(editorCharacters(stored));
    // The schema JSON-LD isn't text: one character, as the editor counts its block.
    const withoutSchema = cleaned.replace(/<script[\s\S]*?<\/script>/g, '');
    expect(summarizeContent(cleaned).characters).toBe(
      summarizeContent(withoutSchema).characters + 1,
    );
  });
});
