import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import type { LinkCheck } from './quality-checks';
import {
  exportPlaceholders,
  pageFields,
  pasteChecks,
  withoutLeadingH1,
  withoutPlaceholders,
} from './ready-to-publish';

/** Ready to publish (Quality spec §7b, CE-057): what an export gives, and checks first. */

const ada = { id: 'a1', name: 'Ada Lovelace' } as ContentAuthor;

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
    ]);
    expect(
      pasteChecks(
        '<p><a href="https://ok.example/">a</a> <a href="https://gone.example/">b</a> <a href="https://gone.example/">c</a> <a href="https://new.example/">n</a> <a href="/local">d</a></p>' +
          '<img src="https://cdn.acme.com/a.jpg" alt="A"><img src="https://cdn.acme.com/b.jpg" alt=" ">' +
          '<div class="cta" style="color:red">x</div><script type="application/ld+json">{}</script>',
        checks,
      ),
    ).toEqual({
      links: { count: 3, read: 2, broken: 1 },
      images: { count: 2, withoutAlt: 1 },
      ownCode: 1,
    });
  });
});
