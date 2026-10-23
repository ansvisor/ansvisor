import { describe, expect, it, vi } from 'vitest';

// content-agent.js reaches the admin client at import time, whose config
// hard-exits without SUPABASE_* env (as in CI).
vi.mock('../config/supabase.js', () => ({ default: { from: vi.fn(), rpc: vi.fn() } }));
const { passageKey } = await import('./content-agent.js');
const { REWRITE_SYSTEM_PROMPT, cleanPageHtml, keepBlocks, restoreKept, rewriteLinks, textLength } =
  await import('./content-rewrite.js');

/**
 * Rewrite the page to these rules: what the page keeps word for word goes
 * to the model as [[KEEP n]] lines and comes back as it was.
 */

const PAGE =
  '<h1>Best AEO tools</h1>' +
  '<p>Ansvisor tracks AI answers across <a href="https://acme.example/engines?utm_source=x">six engines</a>.</p>' +
  '<p>AI assistants quote this sentence about tracking today.</p>' +
  '<table><tbody><tr><td>Plan</td><td>$49</td></tr></tbody></table>' +
  '<div data-html-block="PGI+aGk8L2I+"></div>' +
  '<ul><li><p>See <a href="/pricing">pricing</a>.</p></li></ul>';

const locked = new Set([passageKey('AI assistants quote this sentence about tracking today.')]);

describe('keepBlocks', () => {
  it('sends a locked passage, a table and an HTML block as [[KEEP n]] lines', () => {
    const page = keepBlocks(PAGE, locked);
    expect(page.html).toContain('<p>[[KEEP 1]]</p>');
    expect(page.html).toContain('<p>[[KEEP 2]]</p>');
    expect(page.html).toContain('<p>[[KEEP 3]]</p>');
    expect(page.html).not.toContain('quote this sentence');
    expect(page.html).not.toContain('<table>');
    expect(page.kept.get(2)).toContain('<table>');
    expect([...page.locked]).toEqual([1]);
    // The rest is the model's to rewrite, the H1 included.
    expect(page.html).toContain('<h1>Best AEO tools</h1>');
    expect(page).toMatchObject({ h1Kept: false, h1: '<h1>Best AEO tools</h1>' });
  });

  it('keeps a list whole when it holds a locked passage, and an H1 AI quotes', () => {
    const page = keepBlocks(
      '<h1>Best AEO tools</h1><ul><li><p>AI assistants quote this sentence about tracking today.</p></li></ul>',
      new Set([...locked, passageKey('Best AEO tools')]),
    );
    expect(page.html).toBe('<p>[[KEEP 1]]</p><p>[[KEEP 2]]</p>');
    expect(page.kept.get(2)).toMatch(/^<ul>/);
    expect(page).toMatchObject({ h1Kept: true, h1: null });
  });
});

describe('cleanPageHtml', () => {
  const links = rewriteLinks(PAGE, new Map([['acme.example/guide', 'https://acme.example/guide']]));

  it('keeps the page’s own links, its paths included, and the ones offered; unwraps the rest', () => {
    const html = cleanPageHtml(
      '<h1>T</h1><p><a href="https://acme.example/engines">six</a> <a href="/pricing">pricing</a> ' +
        '<a href="https://acme.example/guide/">guide</a> <a href="https://evil.example">x</a> ' +
        '<a href="javascript:alert(1)">y</a></p><h2><a href="/pricing">Pricing</a></h2>',
      links,
    );
    expect(html).toBe(
      '<h1>T</h1><p><a href="https://acme.example/engines">six</a> <a href="/pricing">pricing</a> ' +
        '<a href="https://acme.example/guide">guide</a> x y</p><h2>Pricing</h2>',
    );
  });

  it('keeps one H1, first; takes the page’s back when there is none; an H1 that is kept wins', () => {
    expect(cleanPageHtml('<h1>A</h1><p>x</p><h1>B</h1><h4>C</h4>', links)).toBe(
      '<h1>A</h1><p>x</p><h2>B</h2><h3>C</h3>',
    );
    expect(cleanPageHtml('<p>x</p>', links, { originalH1: '<h1>Best AEO tools</h1>' })).toBe(
      '<h1>Best AEO tools</h1><p>x</p>',
    );
    expect(cleanPageHtml('<h1>A</h1><p>[[KEEP 1]]</p>', links, { h1Kept: true })).toBe(
      '<h2>A</h2><p>[[KEEP 1]]</p>',
    );
  });

  it('drops what the editor doesn’t take: attributes, scripts, other tags', () => {
    expect(
      cleanPageHtml('<p class="x" style="y">a <span>b</span></p><script>z()</script>', links),
    ).toBe('<p>a b</p>');
  });
});

describe('restoreKept', () => {
  it('puts each kept block back where its line is, once', () => {
    const page = keepBlocks(PAGE, locked);
    const { html, missing } = restoreKept(
      '<h1>Best AEO tools</h1><p>[[KEEP 2]]</p><p>Short intro.</p><p>[[KEEP 1]]</p><p>[[KEEP 3]]</p><p>[[KEEP 1]]</p>',
      page.kept,
    );
    expect(missing).toEqual([]);
    expect(html).toBe(
      '<h1>Best AEO tools</h1>' +
        page.kept.get(2) +
        '<p>Short intro.</p>' +
        '<p>AI assistants quote this sentence about tracking today.</p>' +
        page.kept.get(3),
    );
  });

  it('says which it left out, and takes a line run into other text out of it', () => {
    const page = keepBlocks(PAGE, locked);
    const { html, missing } = restoreKept(
      '<p>Intro [[KEEP 1]] more.</p><ul><li>[[KEEP 2]]</li></ul>',
      page.kept,
    );
    expect(missing).toEqual([1, 3]);
    expect(html).toBe(`<p>Intro  more.</p>${page.kept.get(2)}`);
  });
});

describe('the rewrite', () => {
  it('counts the page’s text as the Rules tab does, not its markup', () => {
    // A space between blocks, an entity as one character.
    expect(textLength('<h1>Ab</h1><p>c  d &amp; e</p>')).toBe('Ab c d x e'.length);
  });

  it('tells the model to keep every kept line, the facts and one H1', () => {
    expect(REWRITE_SYSTEM_PROMPT).toContain('never change, split, merge or drop one');
    expect(REWRITE_SYSTEM_PROMPT).toContain('Never invent numbers');
    expect(REWRITE_SYSTEM_PROMPT).toContain('One H1, the page');
  });
});
