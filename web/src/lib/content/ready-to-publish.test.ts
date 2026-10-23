import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import type { LinkCheck } from './quality-checks';
import {
  exportPlaceholders,
  fragment,
  pageFields,
  pasteChecks,
  titlePlaceholders,
  withoutLeadingH1,
  withoutPlaceholders,
} from './ready-to-publish';

/** Ready to publish (Quality spec §7b, CE-057): what an export gives, and checks first. */

const ada = { id: 'a1', name: 'Ada Lovelace' } as ContentAuthor;

/** A FAQPage's JSON-LD, one line as a draft stores it, with a placeholder in an answer. */
const FAQ =
  '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[' +
  '{"@type":"Question","name":"How long does it take?","acceptedAnswer":{"@type":"Answer","text":"About four minutes. It costs [price]."}},' +
  '{"@type":"Question","name":"Which grind?","acceptedAnswer":{"@type":"Answer","text":"Medium-fine."}}]}';
const jsonLdOf = (html: string) =>
  JSON.parse(fragment(html).querySelector('script[type="application/ld+json"]')!.textContent!);

describe('fragment', () => {
  it('parses into a document of its own, and keeps a leading script where it is', () => {
    const root = fragment(
      '<script type="application/ld+json">{}</script><p><img src="https://cdn.acme.com/a.jpg" alt="A"></p>',
    );
    expect(root.ownerDocument).not.toBe(document);
    expect(root.firstElementChild?.tagName).toBe('SCRIPT');
  });
});

describe('exportPlaceholders', () => {
  it('counts every placeholder an export would carry: words, alt text, JSON-LD', () => {
    expect(
      exportPlaceholders(
        '<script type="application/ld+json">{"author":"[name of a real person]"}</script>' +
          '<h2>What [name of a real person] uses</h2><p>Use [figure, source] g.</p>' +
          '<div class="cta"><span>Call [phone number]</span></div><p>Note [1], [sic].</p>' +
          '<img src="https://cdn.acme.com/a.jpg" alt="[photo of the founder]">',
      ),
    ).toBe(5);
  });

  it("reads JSON-LD by its strings: an array is no placeholder, one that doesn't parse is read for none", () => {
    expect(
      exportPlaceholders(
        '<script type="application/ld+json">{"@type":["Article","NewsArticle"],"author":{"@type":"Person","name":"Ada","sameAs":["https://x.example/ada","https://acme.com/ada"]}}</script><p>Brew.</p>',
      ),
    ).toBe(0);
    expect(exportPlaceholders(`<script type="application/ld+json">${FAQ}</script>`)).toBe(1);
    expect(
      exportPlaceholders(
        '<script type="application/ld+json">{"sameAs":["https://x.example/"],"name":"[brand]"</script>',
      ),
    ).toBe(0);
  });

  it("holds a title's or a heading's brackets only in the agent's own forms", () => {
    expect(
      exportPlaceholders(
        '<h1>Best CRM tools [2026 Update]</h1><h2>How to brew [Step-by-Step Guide]</h2>' +
          '<h3>The checklist [PDF]</h3><p>Brew it slowly.</p>',
      ),
    ).toBe(0);
    expect(
      exportPlaceholders(
        '<h2>What [name of a real person] uses</h2><h2>[quote from a real person, with its source]</h2>' +
          '<h3>Brew [figure, source, 2025] grams</h3><p>Costs [price].</p>',
      ),
    ).toBe(4);
  });
});

describe('titlePlaceholders', () => {
  it("counts the title's only when the page's H1 isn't it", () => {
    const title = 'Best [figure, source] grinders';
    expect(titlePlaceholders(title, '<h1>Best [figure, source] grinders</h1>')).toBe(0);
    expect(titlePlaceholders(title, '<h1>Best grinders</h1>')).toBe(1);
    expect(titlePlaceholders(title, '<p>No H1.</p>')).toBe(1);
  });

  it("reads a person's brackets in the title as part of it", () => {
    expect(titlePlaceholders('Best CRM tools [2026 Update]', '<p>No H1.</p>')).toBe(0);
    expect(titlePlaceholders('The checklist [PDF]', '<h1>The checklist</h1>')).toBe(0);
  });
});

describe('withoutPlaceholders', () => {
  it('leaves out the sentence a placeholder is in, and keeps the rest as written', () => {
    expect(
      withoutPlaceholders(
        '<p>Brew it slowly. Use [figure, source] g of <strong>fresh</strong> coffee. See <a href="https://acme.com/">our guide</a>.</p>',
      ),
    ).toBe('<p>Brew it slowly. See <a href="https://acme.com/">our guide</a>.</p>');
  });

  it('reads sentences as a reader does: numbers, abbreviations and addresses end none', () => {
    expect(
      withoutPlaceholders(
        '<p>The kettle holds 1.5 litres and costs [price]. Use a scale, e.g. the Acme one. Visit acme.com for [details]. As [Dr. Name, title] says, pour slowly. Next.</p>',
      ),
    ).toBe('<p>Use a scale, e.g. the Acme one. Next.</p>');
  });

  it('keeps a heading’s placeholder to be filled, and drops what is left empty', () => {
    expect(
      withoutPlaceholders(
        '<h2>What [name of a real person] uses</h2>' +
          '<blockquote><p>[quote from a real person, with its source]</p></blockquote>' +
          '<ul><li><p>Ask <a href="https://x.example/">[name of a real person]</a>.</p></li><li><p>Grind fresh.</p></li></ul>' +
          '<table><tbody><tr><td><p>[price]</p></td></tr><tr><td><p>Ratio</p></td></tr></tbody></table>',
      ),
    ).toBe(
      '<h2>What [name of a real person] uses</h2><ul><li><p>Grind fresh.</p></li></ul>' +
        '<table><tbody><tr><td><p>Ratio</p></td></tr></tbody></table>',
    );
  });

  it('takes one alone where no line holds it, in alt text and JSON-LD, and keeps a leading script', () => {
    expect(
      withoutPlaceholders(
        '<script type="application/ld+json">{"author":"[name of a real person]"}</script>' +
          '<div class="cta"><span>Call [phone number] today</span></div>' +
          '<img src="https://cdn.acme.com/a.jpg" alt="[photo of the founder]">',
      ),
    ).toBe(
      '<script type="application/ld+json">{"author":""}</script>' +
        '<div class="cta"><span>Call today</span></div>' +
        '<img src="https://cdn.acme.com/a.jpg" alt="">',
    );
  });

  it("clears a JSON-LD's placeholders in its strings, and keeps it JSON", () => {
    const out = withoutPlaceholders(
      `<script type="application/ld+json">${FAQ}</script>` +
        '<script type="application/ld+json">{"@type":"Person","name":"Ada","sameAs":["https://x.example/ada"]}</script>',
    );
    const faq = jsonLdOf(out);
    expect(faq.mainEntity).toHaveLength(2);
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe('About four minutes. It costs .');
    expect(out).toContain(
      '<script type="application/ld+json">{"@type":"Person","name":"Ada","sameAs":["https://x.example/ada"]}</script>',
    );
    // One that doesn't parse is left as written.
    const broken = '<script type="application/ld+json">{"name":"[brand]",</script>';
    expect(withoutPlaceholders(broken)).toBe(broken);
  });

  it("keeps a heading's own brackets as written", () => {
    const html = '<h1>Best CRM tools [2026 Update]</h1><p>Brew it slowly.</p>';
    expect(withoutPlaceholders(html)).toBe(html);
  });
});

describe('pageFields', () => {
  const html =
    '<h1>How to brew pour-over coffee</h1>' +
    '<p>Pour-over coffee takes a dripper, a filter and four minutes. You pour 1.5 litres of hot water over the grounds in slow circles, and the coffee drips through. It tastes cleaner than a French press.</p>' +
    '<p><img src="https://cdn.acme.com/pour.jpg" alt="Pouring"></p>';

  it('reads them from the page: its title, first paragraph, a slug, its author and first image', () => {
    expect(
      pageFields({
        title: 'How to brew pour-over coffee',
        html,
        sourceUrl: null,
        author: ada,
        teamByline: 'Acme Team',
      }),
    ).toEqual({
      metaTitle: 'How to brew pour-over coffee',
      metaDescription:
        'Pour-over coffee takes a dripper, a filter and four minutes. You pour 1.5 litres of hot water over the grounds in slow circles, and the coffee drips through.',
      slug: 'how-to-brew-pour-over-coffee',
      author: 'Ada Lovelace',
      featuredImage: 'https://cdn.acme.com/pour.jpg',
    });
  });

  it("keeps a live page's address as it reads, and the team byline with no author", () => {
    const fields = (sourceUrl: string) =>
      pageFields({
        title: 'Pour-over',
        html: '<p>Short.</p>',
        sourceUrl,
        author: null,
        teamByline: 'Acme Team',
      });
    expect(fields('https://acme.com/blog/pour-over-guide/')).toMatchObject({
      slug: 'pour-over-guide',
      author: 'Acme Team',
      featuredImage: null,
      metaDescription: 'Short.',
    });
    expect(fields('https://acme.com/blog/x/index.html').slug).toBe('x');
    expect(fields('https://acme.com/tr/%C3%A7ay-rehberi?ref=1').slug).toBe('çay-rehberi');
  });

  it('gives no slug for a title with none to give', () => {
    expect(
      pageFields({ title: '東京ガイド', html: '', sourceUrl: null, author: null, teamByline: '' })
        .slug,
    ).toBe('');
  });

  it('cuts a first sentence too long to fit at a word', () => {
    const long = `${'Pour slowly '.repeat(20)}now.`;
    const { metaDescription } = pageFields({
      title: 'x',
      html: `<p>${long}</p>`,
      sourceUrl: null,
      author: null,
      teamByline: 'Acme Team',
    });
    expect(metaDescription.length).toBeLessThanOrEqual(160);
    expect(metaDescription.endsWith('slowly…')).toBe(true);
  });
});

describe('withoutLeadingH1', () => {
  it('drops the H1 the title field holds, and nothing else', () => {
    expect(withoutLeadingH1('<h1>Pour-over</h1><p>Brew.</p><h1>Second</h1>')).toBe(
      '<p>Brew.</p><h1>Second</h1>',
    );
    expect(withoutLeadingH1('<p>Intro.</p><h1>Late</h1>')).toBe('<p>Intro.</p><h1>Late</h1>');
  });
});

describe('pasteChecks', () => {
  it('counts the links read and those that don’t answer, the images with no alt text, and own code', () => {
    const checks = new Map<string, LinkCheck>([
      [
        'https://ok.example/',
        { href: 'https://ok.example/', status: 'ok', httpStatus: 200, date: null },
      ],
      [
        'https://gone.example/',
        { href: 'https://gone.example/', status: 'broken', httpStatus: 404, date: null },
      ],
      // A site that refused the read (a bot wall): no word on it.
      [
        'https://walled.example/',
        { href: 'https://walled.example/', status: 'unknown', httpStatus: 403, date: null },
      ],
    ]);
    expect(
      pasteChecks(
        '<p><a href="https://ok.example/">a</a> <a href="https://gone.example/">b</a> <a href="https://gone.example/">c</a> <a href="https://new.example/">n</a> <a href="https://walled.example/">w</a> <a href="/local">d</a></p>' +
          '<img src="https://cdn.acme.com/a.jpg" alt="A"><img src="https://cdn.acme.com/b.jpg" alt=" ">' +
          '<div class="cta" style="color:red">x</div><script type="application/ld+json">{}</script>',
        checks,
      ),
    ).toEqual({
      links: { count: 4, read: 2, broken: 1 },
      images: { count: 2, withoutAlt: 1 },
      ownCode: 1,
    });
  });
});
