import { describe, expect, it } from 'vitest';
import { pageImages, proofsOnPage, type ProofAsk } from './page-read';
import { trustBlocks } from './quality-checks';

/** The page read's proof asks on the page as it is now (Quality spec §4b, CE-049). */

describe('proofsOnPage', () => {
  const html =
    '<p>Ledgerly is award-winning. Teams love it.</p>' +
    '<p>Every plan is SOC 2 certified (<a href="https://ledgerly.example/trust">trust</a>).</p>' +
    '<ul><li>Rated 4.8 by 2,000 teams.</li></ul>' +
    '<p>Ledgerly is award-winning. Teams love it.</p>';
  const blocks = trustBlocks(html);
  const ask = (claim: string, block: string, kind: ProofAsk['kind'] = 'award'): ProofAsk => ({
    claim,
    block,
    kind,
  });

  it("gives each ask in the page's order, with its sentence and whether its block links out", () => {
    const proofs = [
      ask('Rated 4.8', 'Rated 4.8 by 2,000 teams.', 'rating'),
      ask('award-winning', 'Ledgerly is award-winning. Teams love it.'),
      ask('SOC 2 certified', 'Every plan is SOC 2 certified ( trust).', 'certification'),
    ];
    expect(proofsOnPage(blocks, proofs)).toEqual([
      {
        ...proofs[1],
        sentence: 'Ledgerly is award-winning.',
        linked: false,
      },
      {
        ...proofs[2],
        sentence: 'Every plan is SOC 2 certified ( trust).',
        linked: true,
      },
      { ...proofs[0], sentence: 'Rated 4.8 by 2,000 teams.', linked: false },
    ]);
  });

  it('leaves out an ask whose block changed, and a block the page has twice gives its claims once', () => {
    expect(
      proofsOnPage(blocks, [
        ask('award-winning', 'Ledgerly is award-winning.'),
        ask('the best', 'Ledgerly is award-winning. Teams love it.', 'ranking'),
        ask('award-winning', 'Ledgerly is award-winning. Teams love it.'),
      ]).map((p) => p.claim),
    ).toEqual(['award-winning']);
  });

  it('finds a claim once a link on it adds a space at its edge, and keeps its block as read', () => {
    const read = 'We are ISO 27001-certified and the best-rated tool in Europe.';
    const linked = trustBlocks(
      '<p>We are <a href="https://ledgerly.example/trust">ISO 27001</a>-certified and the best-rated tool in Europe.</p>',
    );
    expect(linked[0].text).toBe('We are ISO 27001 -certified and the best-rated tool in Europe.');
    const proofs = proofsOnPage(linked, [
      ask('the best-rated tool in Europe', read, 'ranking'),
      ask('ISO 27001-certified', read, 'certification'),
    ]);
    // In the block's order, each with the block as read.
    expect(proofs.map((p) => [p.claim, p.block, p.linked])).toEqual([
      ['ISO 27001-certified', read, true],
      ['the best-rated tool in Europe', read, true],
    ]);
    expect(proofs[0].sentence).toBe(
      'We are ISO 27001 -certified and the best-rated tool in Europe.',
    );
  });

  it("counts only an http(s) link as the block's proof", () => {
    const linkless = trustBlocks(
      '<p>We are ISO 27001 certified (<a href="mailto:trust@ledgerly.example">ask</a>).</p>',
    );
    expect(
      proofsOnPage(linkless, [ask('ISO 27001 certified', linkless[0].text, 'certification')])[0]
        .linked,
    ).toBe(false);
  });
});

describe('pageImages', () => {
  it("lists the page's images by their address, once each, in its order", () => {
    expect(
      pageImages(
        '<p>Intro</p><img src="https://cdn.example/a.png" alt="A run"><p><img src="data:image/png;base64,xx"></p>' +
          '<img src="https://cdn.example/b.jpg"><img src="https://cdn.example/a.png" alt="again">' +
          // As the database takes an own image's address: lower-case http(s), 2048 at most.
          `<img src="HTTP://cdn.example/c.png"><img src="https://cdn.example/${'x'.repeat(2048)}.png">`,
      ),
    ).toEqual([
      { src: 'https://cdn.example/a.png', alt: 'A run' },
      { src: 'https://cdn.example/b.jpg', alt: '' },
    ]);
  });
});
