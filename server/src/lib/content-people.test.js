import { describe, expect, it } from 'vitest';
import {
  NAME_PLACEHOLDER as NAME,
  QUOTE_PLACEHOLDER as QUOTE,
  authorWords,
  guardPeople,
  guardPeopleInHtml,
  knownPeople,
} from './content-people.js';

/**
 * No invented people or quotes (Quality spec §9, CE-044): a name or a quoted
 * sentence the agent was given stays; any other becomes a placeholder.
 */

const known = knownPeople(
  'Ada Lovelace writes about forecasting.',
  '“Forecasts are only as good as the deals in them,” Ada Lovelace says.',
  'Acme Coffee',
);
const guard = (text) => guardPeople(text, known).text;

describe('guardPeople', () => {
  it('puts a person it was not given as a placeholder, wherever a person is plainly meant', () => {
    expect(guard('Dr. Jane Doe tested twelve grinders.')).toBe(`${NAME} tested twelve grinders.`);
    expect(guard('CEO Tim Cook agreed; founder Jean-Luc Picard nodded.')).toBe(
      `CEO ${NAME} agreed; founder ${NAME} nodded.`,
    );
    expect(guard('Jane McDonald, our senior product manager, agrees.')).toBe(
      `${NAME}, our senior product manager, agrees.`,
    );
    expect(guard('Marco Rossi said the beans matter.')).toBe(`${NAME} said the beans matter.`);
    expect(guard('The beans matter, according to Marco Rossi.')).toBe(
      `The beans matter, according to ${NAME}.`,
    );
    expect(guard('Çağrı Işık says hello.')).toBe(`${NAME} says hello.`);
  });

  it('keeps a person it was given, and names that are no person', () => {
    expect(guard('According to Ada Lovelace, teams forecast weekly.')).toBe(
      'According to Ada Lovelace, teams forecast weekly.',
    );
    expect(guard('Dr. Ada Lovelace says so.')).toBe('Dr. Ada Lovelace says so.');
    expect(guard('The team said it works.')).toBe('The team said it works.');
    expect(guard('Clicks rose, according to Google Search Console data.')).toBe(
      'Clicks rose, according to Google Search Console data.',
    );
    expect(guard('Acme Coffee roasts on Mondays.')).toBe('Acme Coffee roasts on Mondays.');
  });

  it('puts a quoted sentence it was not given as a placeholder, and keeps one it was', () => {
    expect(guard('“Pour-over is the best way to taste a single origin,” said Marco Rossi.')).toBe(
      `${QUOTE} said ${NAME}.`,
    );
    expect(guard('She wrote "this changed how we brew every morning" last year.')).toBe(
      `She wrote ${QUOTE} last year.`,
    );
    expect(guard('As Ada Lovelace says, "forecasts are only as good as the deals in them."')).toBe(
      'As Ada Lovelace says, "forecasts are only as good as the deals in them."',
    );
    // A term in quotes is no quote.
    expect(guard('Use the “AI visibility” term with care.')).toBe(
      'Use the “AI visibility” term with care.',
    );
  });

  it('leaves placeholders alone, and says where it put its own', () => {
    expect(guard(`Read the ${QUOTE} here, from ${NAME}.`)).toBe(
      `Read the ${QUOTE} here, from ${NAME}.`,
    );
    const { edits } = guardPeople('Ask Dr. Jane Doe.', known);
    expect(edits).toEqual([{ start: 4, end: 16, text: NAME }]);
  });
});

describe('guardPeople: what the review found', () => {
  const people = knownPeople('Jane Doe writes about pipelines.', "Bob O'Neil");
  const fix = (text, options) => guardPeople(text, people, options).text;

  it('catches the ways a person is usually named', () => {
    expect(fix('Sarah Chen, a marketing strategist at Acme, notes that it works.')).toBe(
      `${NAME}, a marketing strategist at Acme, notes that it works.`,
    );
    expect(fix('SEO expert Sarah Chen agrees.')).toBe(`SEO expert ${NAME} agrees.`);
    expect(fix('Marco Rossi (CEO of Acme) recommends it.')).toBe(
      `${NAME} (CEO of Acme) recommends it.`,
    );
    expect(fix('Marco Rossi, Senior Product Manager at Acme, explains why.')).toBe(
      `${NAME}, Senior Product Manager at Acme, explains why.`,
    );
    expect(fix('Marco Rossi emphasizes speed.')).toBe(`${NAME} emphasizes speed.`);
    expect(fix('Sarah, our head of growth, says yes.')).toBe(
      `${NAME}, our head of growth, says yes.`,
    );
    expect(fix('This was said by Ursula von der Leyen.')).toBe(`This was said by ${NAME}.`);
    expect(fix('As J. K. Rowling said, write daily.')).toBe(`As ${NAME} said, write daily.`);
    expect(fix("Ayşe Yılmaz'a göre bu doğru.")).toBe(`${NAME}'a göre bu doğru.`);
    expect(fix('Geschäftsführerin Anna Schmidt sagt, es funktioniert.')).toBe(
      `Geschäftsführerin ${NAME} sagt, es funktioniert.`,
    );
    expect(fix("Mary O'Hara said so.")).toBe(`${NAME} said so.`);
  });

  it('takes a short quote someone is said to say, and one in single curly quotes', () => {
    expect(fix('“Absolutely game-changing,” said Marco Rossi.')).toBe(`${QUOTE} said ${NAME}.`);
    expect(fix('‘We tested it for weeks and it held up,’ she said.')).toBe(`${QUOTE} she said.`);
    // An apostrophe isn't a quote's end.
    expect(fix('She said it’s fine.')).toBe('She said it’s fine.');
  });

  it("keeps a known author's name with the words before it", () => {
    expect(fix('Recently Jane Doe said it.')).toBe('Recently Jane Doe said it.');
    expect(fix('Acme Founder Jane Doe said it best.')).toBe('Acme Founder Jane Doe said it best.');
    expect(fix("Bob O'Neil said so.")).toBe("Bob O'Neil said so.");
  });

  it('leaves headings, places, publications and inches alone', () => {
    for (const heading of [
      'Content Editor Best Practices',
      'Lead Scoring Best Practices for Small Teams',
      'How Chief Marketing Officers Use AEO',
      'Head of Sales Playbook Template',
    ]) {
      expect(fix(heading, { heading: true })).toBe(heading);
    }
    expect(fix('In Silicon Valley, the founder of Acme spoke.')).toBe(
      'In Silicon Valley, the founder of Acme spoke.',
    );
    expect(fix('Traffic fell, according to Search Engine Land.')).toBe(
      'Traffic fell, according to Search Engine Land.',
    );
    expect(fix('Our 27" monitor is the best of the "pro" line.')).toBe(
      'Our 27" monitor is the best of the "pro" line.',
    );
  });

  it('reads long text quickly, whatever its words', () => {
    const word = `A${'a'.repeat(400)}`;
    const long = `${word} ${word} ${word} said. `.repeat(10);
    const start = Date.now();
    guardPeople(long, people);
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe('guardPeopleInHtml', () => {
  it('reads the words only, and makes an unknown blockquote one placeholder', () => {
    const { html, count } = guardPeopleInHtml(
      '<blockquote><p>We doubled our sales in a <strong>single</strong> quarter.</p></blockquote>' +
        '<p>Marco Rossi said <a href="https://acme.com/">it</a> works.</p>' +
        '<pre>Jane Doe said "keep code as it is written here"</pre>',
      known,
    );
    expect(count).toBe(2);
    expect(html).toBe(
      `<blockquote><p>${QUOTE}</p></blockquote>` +
        `<p>${NAME} said <a href="https://acme.com/">it</a> works.</p>` +
        '<pre>Jane Doe said "keep code as it is written here"</pre>',
    );
  });

  it("keeps the page's own blockquote, and reads its cite for the name", () => {
    const page = knownPeople(
      'We doubled our pipeline in a month. Then we tripled it again.',
      'Ada Lovelace',
    );
    const own =
      '<blockquote><p>We doubled our pipeline in a month.</p><p>Then we tripled it again.</p>' +
      '<cite>Ada Lovelace</cite></blockquote>';
    expect(guardPeopleInHtml(own, page)).toEqual({ html: own, count: 0 });
    expect(
      guardPeopleInHtml(
        '<blockquote><p>We doubled our pipeline in a month.</p><cite>Mark Twain</cite></blockquote>',
        page,
      ).html,
    ).toBe(
      `<blockquote><p>We doubled our pipeline in a month.</p><cite>${NAME}</cite></blockquote>`,
    );
    expect(guardPeopleInHtml('<p>As she put it, <q>we never looked back</q>.</p>', page).html).toBe(
      `<p>As she put it, ${QUOTE}.</p>`,
    );
  });

  it('reads a quote across the bold and the links in it, and drops what it emptied', () => {
    expect(
      guardPeopleInHtml(
        '<p>“We <strong>doubled</strong> our pipeline in a month,” says Marco Rossi.</p>' +
          '<p>“Our <a href="https://x.example/">AEO tracker</a> doubled our pipeline,” she said.</p>',
        known,
      ).html,
    ).toBe(`<p>${QUOTE} says ${NAME}.</p><p>${QUOTE} she said.</p>`);
  });

  it('reads a heading for quotes and speech only', () => {
    expect(
      guardPeopleInHtml('<h2>Lead Scoring Best Practices</h2><p>CEO Tim Cook agrees.</p>', known)
        .html,
    ).toBe(`<h2>Lead Scoring Best Practices</h2><p>CEO ${NAME} agrees.</p>`);
  });

  it('returns the HTML as it was when there is nothing to put', () => {
    const html = '<p>Ada Lovelace&nbsp;writes.</p>';
    expect(guardPeopleInHtml(html, known)).toEqual({ html, count: 0 });
  });
});

describe('authorWords', () => {
  it("reads the workspace's authors: names, titles and bios", async () => {
    const calls = [];
    const db = {
      from: (table) => ({
        select: (cols) => ({
          eq: async (col, value) => {
            calls.push([table, cols, col, value]);
            return {
              data: [
                { name: 'Ada Lovelace', title: 'Head of Content', bio: null },
                { name: 'Bob Stone', title: null, bio: 'Roasts coffee.' },
              ],
              error: null,
            };
          },
        }),
      }),
    };
    expect(await authorWords(db, 'o1')).toEqual([
      'Ada Lovelace',
      'Head of Content',
      'Bob Stone',
      'Roasts coffee.',
    ]);
    expect(calls).toEqual([['content_authors', 'name, title, bio', 'organization_id', 'o1']]);
  });
});
