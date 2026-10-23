import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { Readability } from '@/lib/content/readability';
import { QualityTab } from './_quality-tab';

/** Instructions › Quality (Quality spec §3, CE-039): the score, its label, what would raise it. */

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

let container: HTMLDivElement;
let root: Root;
const onShow = vi.fn();

async function render(readability: Readability | null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QualityTab readability={readability} onShow={onShow} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  onShow.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('QualityTab', () => {
  it('shows the score with its band, labelled an Ansvisor estimate', async () => {
    await render(result);
    const scores = container.querySelector('[aria-label="Quality scores"]')!;
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
    expect(container.textContent).toContain('Nothing to raise here: the page reads well.');
  });

  it('says when the page’s language isn’t read yet, not that it is too short', async () => {
    await render({ score: null, unscored: 'language', checks: [], words: 240 });
    expect(container.textContent).toContain("Readability isn't read for this language yet.");
    expect(container.textContent).not.toContain('Write a few paragraphs');
    expect(container.querySelector('li')).toBeNull();
  });
});
