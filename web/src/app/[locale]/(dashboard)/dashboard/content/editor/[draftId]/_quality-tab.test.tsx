import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { eeat } from '@/lib/content/quality-checks';
import type { ContentAuthor } from '@/lib/content/authors';
import type { Readability } from '@/lib/content/readability';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

const { QualityTab } = await import('./_quality-tab');
type QualityRead = import('./_quality-tab').QualityRead;

/** Instructions › Quality (Quality spec §3, CE-039): the scores, their label, what would raise them. */

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
  return {
    readability,
    eeat: eeat({ author }),
    trust: null,
    author,
    canEdit,
    hasAuthors,
    brandName: 'Acme',
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
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      '+9 Readability3 sentences over 35 wordsSplit each into two. Show goes to the first.Show',
      '+5 ReadabilitySentences average 22.4 wordsAim for 15–20 words: shorter sentences read faster, and AI answers quote them whole.',
      '+5 ReadabilityReading level 52 (Flesch Reading Ease)Aim for 60 or more: shorter words and sentences.',
    ]);
    await act(async () => container.querySelector<HTMLButtonElement>('li button')!.click());
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
    expect(container.querySelector('li')).toBeNull();
    await render({
      ...result,
      score: 100,
      checks: result.checks.map((c) => ({ ...c, points: c.max })),
    });
    expect(container.textContent).toContain('Nothing to raise here for now');
  });

  it('asks for a real author when the page is by the team, and opens the menu', async () => {
    await render(read(result, null));
    const scores = container.querySelector('[aria-label="Quality scores"]')!;
    expect(scores.textContent).toContain('E-E-A-T0Needs work');
    const first = container.querySelector('li')!;
    expect(first.textContent).toBe(
      '+60 E-E-A-TThe page is by Acme Team, not a personPick the person who wrote it: a named author with a short bio and profile links shows who stands behind the page.Pick author',
    );
    await act(async () => first.querySelector('button')!.click());
    expect(onPickAuthor).toHaveBeenCalled();
  });

  it("asks to complete the author's profile in Settings › Authors", async () => {
    await render(read(result, { ...ada, bio: null, sameAs: [] }));
    const row = [...container.querySelectorAll('li')].find((li) =>
      li.textContent?.includes('Ada Lovelace'),
    )!;
    expect(row.textContent).toContain('+40 E-E-A-TAda Lovelace has no short bio or profile links');
    expect(row.querySelector('a')!.getAttribute('href')).toBe('/dashboard/settings/authors');
  });

  it("says who can complete the profile when the reader can't edit the author", async () => {
    await render(read(result, { ...ada, bio: null }, true, false));
    const row = [...container.querySelectorAll('li')].find((li) =>
      li.textContent?.includes('Ada Lovelace'),
    )!;
    expect(row.textContent).toContain('Ada Lovelace has no short bio');
    expect(row.textContent).toContain(
      'Whoever added Ada Lovelace or an admin can add a short bio in Settings › Authors.',
    );
    expect(row.querySelector('a')).toBeNull();
    expect(row.querySelector('button')).toBeNull();
  });

  it('names the author among who can when they are a member', async () => {
    await render(read(result, { ...ada, sameAs: [], userId: 'u2' }, true, false));
    const row = [...container.querySelectorAll('li')].find((li) =>
      li.textContent?.includes('Ada Lovelace'),
    )!;
    expect(row.textContent).toContain(
      'Ada Lovelace, whoever added them or an admin can add a profile link in Settings › Authors.',
    );
    expect(row.querySelector('a')).toBeNull();
  });

  it('sends to Settings › Authors when the workspace has no author yet', async () => {
    await render(read(result, null, false));
    const row = container.querySelector('li')!;
    expect(row.querySelector('a')!.textContent).toBe('Add author');
    expect(row.querySelector('a')!.getAttribute('href')).toBe('/dashboard/settings/authors');
  });

  it('says only that a short page is too short, with nothing else to raise', async () => {
    await render(read({ score: null, checks: [], words: 12 }));
    expect(container.textContent).toContain('Write a few paragraphs');
    expect(container.textContent).not.toContain('Nothing to raise');
  });

  it('says when the page’s language isn’t read yet, not that it is too short', async () => {
    await render({ score: null, unscored: 'language', checks: [], words: 240 });
    expect(container.textContent).toContain("Readability isn't read for this language yet.");
    expect(container.textContent).not.toContain('Write a few paragraphs');
    expect(container.querySelector('li')).toBeNull();
  });
});
