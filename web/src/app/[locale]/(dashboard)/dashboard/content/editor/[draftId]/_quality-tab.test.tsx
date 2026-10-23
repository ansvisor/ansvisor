import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { eeat, trust, trustBlocks, type LinkCheck } from '@/lib/content/quality-checks';
import type { ContentAuthor } from '@/lib/content/authors';
import { qualityTodos } from '@/lib/content/quality-todos';
import type { Readability } from '@/lib/content/readability';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

const { QualityTab } = await import('./_quality-tab');
type QualityRead = import('./_quality-tab').QualityRead;

/**
 * Instructions › Quality (Quality spec §3, CE-039): the scores, their label,
 * the person's to-dos (CE-040) and what would raise them.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const result: Readability = {
  score: 71,
  words: 420,
  checks: [
    { id: 'avgSentence', points: 20, max: 25, value: 22.4, count: 0 },
    { id: 'longSentences', points: 6, max: 15, value: 41, count: 3, at: 'A very long sentence.' },
    {
      id: 'readingLevel',
      points: 15,
      max: 20,
      value: 52,
      count: 0,
      formula: 'flesch',
      target: 60,
    },
    { id: 'answerFirst', points: 15, max: 15, value: 30, count: 0, at: null },
    { id: 'shortParagraphs', points: 10, max: 10, value: 6, count: 0, at: null },
    { id: 'headingSpacing', points: 10, max: 10, value: 3, count: 0, at: null },
    { id: 'passiveJargon', points: 5, max: 5, value: 0, count: 0, at: null },
  ],
};

const ada: ContentAuthor = {
  id: 'a1',
  name: 'Ada Lovelace',
  title: null,
  bio: 'Writes about forecasting.',
  photoUrl: null,
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
};

/** The page's quality with this author (or the team byline) and Readability. */
function read(
  readability: Readability | null,
  author: ContentAuthor | null = ada,
  hasAuthors = true,
  canEdit = true,
): QualityRead {
  const score = eeat({ author });
  return {
    readability,
    eeat: score,
    trust: null,
    author,
    canEdit,
    hasAuthors,
    brandName: 'Acme',
    siteTrust: null,
    todos: qualityTodos({ eeat: score, author, hasAuthors, canEdit }),
  };
}

let container: HTMLDivElement;
let root: Root;
const onShow = vi.fn();
const onPickAuthor = vi.fn();

async function render(quality: QualityRead | Readability | null) {
  const q = quality && 'eeat' in quality ? quality : read(quality as Readability | null);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QualityTab quality={q} onShow={onShow} onPickAuthor={onPickAuthor} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  onShow.mockReset();
  onPickAuthor.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('QualityTab', () => {
  it('shows the three scores with their bands, labelled an Ansvisor estimate', async () => {
    await render(result);
    const scores = container.querySelector('[aria-label="Quality scores"]')!;
    expect(scores.textContent).toContain('E-E-A-T100Strong');
    // No Trust check is live for a page without agent claims: no fake points.
    expect(scores.textContent).toContain('TrustNot scored yet');
    expect(scores.textContent).toContain('Readability71Can improve');
    expect(scores.textContent).toContain(
      "Ansvisor estimates based on Google's published quality signals. Not a Google score.",
    );
  });

  it('lists what would raise it, the biggest gain first, each with what to do', async () => {
    await render(result);
    const suggestions = container.querySelector('[aria-label="What would raise it"]')!;
    const rows = [...suggestions.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      '+9 Readability3 sentences over 35 wordsSplit each into two. Show goes to the first.Show',
      '+5 ReadabilitySentences average 22.4 wordsAim for 15–20 words: shorter sentences read faster, and AI answers quote them whole.',
      '+5 ReadabilityReading level 52 (Flesch Reading Ease)Aim for 60 or more: shorter words and sentences.',
    ]);
    await act(async () => suggestions.querySelector<HTMLButtonElement>('li button')!.click());
    expect(onShow).toHaveBeenCalledWith('A very long sentence.');
  });

  it('asks to join short sentences when they run under the range', async () => {
    await render({
      ...result,
      checks: result.checks.map((c) =>
        c.id === 'avgSentence' ? { ...c, value: 8, count: -1 } : c,
      ),
    });
    expect(container.textContent).toContain('Sentences average 8 words');
    expect(container.textContent).toContain('join some short ones');
  });

  it('says when the page is too short to read, or reads well', async () => {
    await render({ score: null, unscored: 'tooShort', checks: [], words: 12 });
    expect(container.textContent).toContain('Write a few paragraphs');
    expect(container.querySelector('[aria-label="What would raise it"]')).toBeNull();
    await render({
      ...result,
      score: 100,
      checks: result.checks.map((c) => ({ ...c, points: c.max })),
    });
    expect(container.textContent).toContain('Nothing to raise here for now');
  });

  it("lists picking the page's author as a to-do, and opens the menu", async () => {
    await render(read(result, null));
    const scores = container.querySelector('[aria-label="Quality scores"]')!;
    expect(scores.textContent).toContain('E-E-A-T0Needs work');
    const todos = container.querySelector('[aria-label="Your to-dos"]')!;
    expect(todos.querySelector('h4')!.textContent).toBe(
      'Your to-dos 2 left · only you can do these',
    );
    const [row, profile] = [...todos.querySelectorAll('li')];
    expect(row.textContent).toBe(
      "Pick the page's author · To doIt's by Acme Team now: a named person shows who stands behind the page · +60 E-E-A-TPick author",
    );
    // The profile waits on the author: listed, with no button yet.
    expect(profile.textContent).toBe(
      "Complete the author's profile · To doOnce the page has an author: two sentences on what they know, and a profile link · +40 E-E-A-T",
    );
    expect(profile.querySelector('button, a')).toBeNull();
    await act(async () => row.querySelector('button')!.click());
    expect(onPickAuthor).toHaveBeenCalled();
    // Not a suggestion: the agent can't pick an author.
    expect(
      container.querySelector('[aria-label="What would raise it"]')!.textContent,
    ).not.toContain('author');
  });

  it('checks the author off, then asks to complete their profile in Settings › Authors', async () => {
    await render(read(result, { ...ada, bio: null, sameAs: [] }));
    const todos = container.querySelector('[aria-label="Your to-dos"]')!;
    expect(todos.querySelector('h4')!.textContent).toContain('1 left');
    const [byline, profile] = [...todos.querySelectorAll('li')];
    expect(byline.textContent).toBe("Pick the page's author · DoneBy Ada Lovelace");
    expect(byline.querySelector('.line-through')).not.toBeNull();
    expect(byline.querySelector('button, a')).toBeNull();
    expect(profile.textContent).toContain(
      "Complete Ada Lovelace's profile · To doAdd them in Settings › Authors: two sentences on what they know, and a LinkedIn or other profile link · +40 E-E-A-T",
    );
    expect(profile.querySelector('a')!.textContent).toBe('Edit author');
    expect(profile.querySelector('a')!.getAttribute('href')).toBe('/dashboard/settings/authors');
  });

  it("says who can complete the profile when the reader can't edit the author", async () => {
    await render(read(result, { ...ada, bio: null }, true, false));
    const row = [...container.querySelectorAll('li')].find((li) =>
      li.textContent?.includes("Complete Ada Lovelace's profile"),
    )!;
    expect(row.textContent).toContain(
      'Whoever added Ada Lovelace or an admin can add a short bio in Settings › Authors',
    );
    expect(row.querySelector('a')).toBeNull();
    expect(row.querySelector('button')).toBeNull();
  });

  it('names the author among who can when they are a member', async () => {
    await render(read(result, { ...ada, sameAs: [], userId: 'u2' }, true, false));
    const row = [...container.querySelectorAll('li')].find((li) =>
      li.textContent?.includes("Complete Ada Lovelace's profile"),
    )!;
    expect(row.textContent).toContain(
      'Ada Lovelace, whoever added them or an admin can add a profile link in Settings › Authors',
    );
    expect(row.querySelector('a')).toBeNull();
  });

  it('sends to Settings › Authors when the workspace has no author yet', async () => {
    await render(read(result, null, false));
    const row = container.querySelector('[aria-label="Your to-dos"] li')!;
    expect(row.textContent).toContain('Add an author for the page');
    expect(row.querySelector('a')!.textContent).toBe('Add author');
    expect(row.querySelector('a')!.getAttribute('href')).toBe('/dashboard/settings/authors');
  });

  it('says all done when every to-do is, and nothing is left to raise', async () => {
    await render({
      ...read(result),
      readability: {
        ...result,
        score: 100,
        checks: result.checks.map((c) => ({ ...c, points: c.max })),
      },
    });
    const todos = container.querySelector('[aria-label="Your to-dos"]')!;
    expect(todos.querySelector('h4')!.textContent).toBe('Your to-dos All done');
    expect(container.textContent).toContain('Nothing to raise here for now');
  });

  it('says nothing is left to raise only once the to-dos are done', async () => {
    await render({
      ...read(result, null),
      readability: {
        ...result,
        score: 100,
        checks: result.checks.map((c) => ({ ...c, points: c.max })),
      },
    });
    expect(container.textContent).not.toContain('Nothing to raise');
    expect(container.querySelector('[aria-label="What would raise it"]')).toBeNull();
  });

  it('says only that a short page is too short, with nothing else to raise', async () => {
    await render(read({ score: null, checks: [], words: 12 }));
    expect(container.textContent).toContain('Write a few paragraphs');
    expect(container.textContent).not.toContain('Nothing to raise');
  });

  it('asks to source figures, swap stale sources and fix links, each with Show', async () => {
    const html =
      '<p>Win rates rose 42% last year.</p>' +
      '<p>See <a href="https://old.example/">this study</a> and <a href="https://gone.example/">that one</a>.</p>';
    const links = new Map<string, LinkCheck>([
      [
        'https://old.example/',
        {
          href: 'https://old.example/',
          status: 'ok',
          httpStatus: 200,
          date: '2020-01-01T00:00:00.000Z',
        },
      ],
      [
        'https://gone.example/',
        { href: 'https://gone.example/', status: 'broken', httpStatus: 404, date: null },
      ],
    ]);
    const result = trust({
      blocks: trustBlocks(html),
      links,
      brandDomains: ['acme.com'],
      now: Date.parse('2026-10-23T12:00:00Z'),
    });
    await render({ ...read(null), trust: result });
    const scores = container.querySelector('[aria-label="Quality scores"]')!;
    // Figures 0 of 30, fresh 0 of 7, links 1.5 of 3: 4 of 100.
    expect(scores.textContent).toContain('Trust4Needs work');
    const suggestions = container.querySelector('[aria-label="What would raise it"]')!;
    const rows = [...suggestions.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toContainEqual(expect.stringContaining('1 sentence with a figure has no source'));
    expect(rows).toContainEqual(
      expect.stringContaining('1 of 1 dated source is over 24 months old'),
    );
    expect(rows).toContainEqual(
      expect.stringContaining("1 link doesn't workFix or remove it: https://gone.example/Show"),
    );
    const figure = [...suggestions.querySelectorAll('li')].find((li) =>
      li.textContent?.includes('figure'),
    )!;
    await act(async () => figure.querySelector('button')!.click());
    expect(onShow).toHaveBeenCalledWith('Win rates rose 42% last year.');
  });

  it("shows the site's trust, what is missing and the way to Site Audit", async () => {
    const siteTrust = {
      checks: {
        about: { ok: true, url: 'https://acme.com/about' },
        contact: { ok: true, url: 'https://acme.com/contact' },
        editorial: { ok: false, url: null },
        organizationSchema: { ok: true, url: 'https://acme.com/' },
        authorPages: { ok: false, authors: [{ name: 'Ada', url: null }] },
      },
      score: 3,
      checkedAt: '2026-10-23T12:00:00.000Z',
    };
    await render({ ...read(result), siteTrust });
    const site = container.querySelector('[aria-label="Site trust"]')!;
    expect(site.textContent).toBe(
      'Site trust 3/5· Missing: Editorial policy and Author pagesFix in Site Audit',
    );
    expect(site.querySelector('a')!.getAttribute('href')).toBe('/dashboard/audit#site-trust');

    const all = Object.fromEntries(
      Object.entries(siteTrust.checks).map(([k, v]) => [k, { ...v, ok: true }]),
    ) as typeof siteTrust.checks;
    await render({ ...read(result), siteTrust: { ...siteTrust, checks: all, score: 5 } });
    expect(container.querySelector('[aria-label="Site trust"]')!.textContent).toBe(
      'Site trust 5/5',
    );
  });

  it('lists a broken link before Trust is scored, its gain out of the Phase 1 points', async () => {
    const result = trust({
      blocks: trustBlocks('<p>See <a href="https://gone.example/">that one</a>.</p>'),
      links: new Map<string, LinkCheck>([
        [
          'https://gone.example/',
          { href: 'https://gone.example/', status: 'broken', httpStatus: 404, date: null },
        ],
      ]),
      brandDomains: ['acme.com'],
      now: Date.parse('2026-10-23T12:00:00Z'),
    });
    await render({ ...read(null), trust: result });
    const scores = container.querySelector('[aria-label="Quality scores"]')!;
    expect(scores.textContent).toContain('TrustNot scored yet');
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    // 3 of the 40 Phase 1 points.
    expect(rows).toContainEqual(expect.stringContaining("+8 Trust1 link doesn't work"));
  });

  it('counts the dated sources and the stale ones each in its own number', async () => {
    const dated = (date: string) => ({ status: 'ok' as const, httpStatus: 200, date });
    const result = trust({
      blocks: trustBlocks(
        '<p>See <a href="https://a.example/">a</a>, <a href="https://b.example/">b</a> and <a href="https://c.example/">c</a>.</p>',
      ),
      links: new Map<string, LinkCheck>([
        ['https://a.example/', { href: 'https://a.example/', ...dated('2020-01-01T00:00:00Z') }],
        ['https://b.example/', { href: 'https://b.example/', ...dated('2021-01-01T00:00:00Z') }],
        ['https://c.example/', { href: 'https://c.example/', ...dated('2026-01-01T00:00:00Z') }],
      ]),
      brandDomains: ['acme.com'],
      now: Date.parse('2026-10-23T12:00:00Z'),
    });
    await render({ ...read(null), trust: result });
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toContainEqual(
      expect.stringContaining('2 of 3 dated sources are over 24 months old'),
    );
  });

  it('says when the page’s language isn’t read yet, not that it is too short', async () => {
    await render({ score: null, unscored: 'language', checks: [], words: 240 });
    expect(container.textContent).toContain("Readability isn't read for this language yet.");
    expect(container.textContent).not.toContain('Write a few paragraphs');
    expect(container.querySelector('[aria-label="What would raise it"]')).toBeNull();
  });
});
