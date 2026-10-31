import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ChatWhy } from '@/lib/chat/why/view';

/**
 * A Why did it move card (CHAT-22 §1 item 4, mockup #f-why): the metric's
 * two values and its change, "What explains the …" with each cause's share
 * and its prompts' table, an offset in points, and an answer opened in the
 * evidence drawer from the run's own route, by places, never an id.
 */

const { WhyCard } = await import('./why-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const RUN = '44444444-4444-4444-8444-444444444444';

const why: ChatWhy = {
  n: 1,
  metric: 'citations',
  unit: 'pts',
  periodA: { from: '2026-10-12', to: '2026-10-18' },
  periodB: { from: '2026-10-19', to: '2026-10-25' },
  valueA: 58,
  valueB: 52,
  delta: -6,
  se: 0.75,
  noise: 'beyond_normal_swing',
  direction: 'declined',
  changeDay: '2026-10-24',
  causes: [
    {
      kind: 'lost_citation_to_competitor',
      share: 62,
      points: -3.7,
      offset: false,
      confidence: 'high',
      cells: 14,
      urls: ['acme.example/blog/what-is-aeo'],
      rows: [
        {
          prompt: 'what is answer engine optimization',
          before: 'acme.example/blog/what-is-aeo',
          now: 'lumora.example/aeo-guide-2026',
          date: '2026-10-23',
          answer: true,
        },
      ],
    },
    {
      kind: 'gained_citation',
      share: null,
      points: 0.8,
      offset: true,
      confidence: 'medium',
      cells: 3,
      urls: ['acme.example/pricing'],
      rows: [],
    },
  ],
  remainder: { kind: 'unexplained', points: -3.1, share: 38 },
  excludedCells: 2,
  stableCells: 40,
  partial: false,
  engines: ['google-aio'],
  runs: { a: 214, b: 198, cells: 42 },
};

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn(
  async () =>
    new Response(
      JSON.stringify({
        answer: {
          engine: 'google-aio',
          date: '2026-10-24',
          passage: [
            { text: 'For AEO tracking, ', mark: false },
            { text: 'Acme', mark: true },
            { text: ' and Lumora are cited most.', mark: false },
          ],
          citations: [{ url: 'lumora.example/aeo-guide-2026', own: false }],
        },
      }),
      { status: 200 },
    ),
);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function render(value: ChatWhy = why) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WhyCard runId={RUN} why={value} />
      </NextIntlClientProvider>,
    );
  });
}

describe('WhyCard', () => {
  it('gives the metric’s two values and its change, then what explains it', async () => {
    await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Google AI Overviews citation rate');
    expect(text).toContain('58 → 52');
    expect(text).toContain('▼ 6 pts · 7 days');
    expect(text).toContain('What explains the −6 pts');
    expect(text).toContain('62%');
    expect(text).not.toContain('%%');
    expect(text).toContain('Lost citation · /blog/what-is-aeo');
    expect(text).toContain('about 3.7 pts · 1 answer now cites lumora.example/aeo-guide-2026');
    // An offset in points, never a share.
    expect(text).toContain('+0.8');
    expect(text).toContain('partly offset the change');
    expect(text).toContain('Unexplained');
    expect(text).toContain('Detection from stored snapshots, no model reads');
  });

  it('opens a cause to its prompts: cited before, cited now and the day', async () => {
    await render();
    const first = container.querySelector('[data-action="why.toggleCause"]')!;
    expect(first.getAttribute('aria-expanded')).toBe('true');
    const table = container.textContent ?? '';
    expect(table).toContain('what is answer engine optimization');
    expect(table).toContain('acme.example/blog/what-is-aeo');
    expect(table).toContain('Oct 23');
    const second = container.querySelectorAll('[data-action="why.toggleCause"]')[1];
    await act(async () => (second as HTMLButtonElement).click());
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('No single prompt explains this part.');
  });

  it('opens an answer in the drawer by the run’s route and its places', async () => {
    await render();
    const answer = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Answer',
    )!;
    await act(async () => answer.click());
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/runs/${RUN}/why/1/0/0`);
    const drawer = document.body.textContent ?? '';
    expect(drawer).toContain('Acme');
    expect(drawer).toContain('lumora.example/aeo-guide-2026');
    expect(document.body.querySelector('mark')?.textContent).toBe('Acme');
  });

  it('says first when the change is within normal swing, with no shares', async () => {
    await render({
      ...why,
      noise: 'within_normal_swing',
      causes: why.causes.map((c) => ({ ...c, share: null })),
      remainder: { ...why.remainder, share: null },
    });
    expect(container.textContent).toContain('Within normal swing (±1.5 pts at this sample size)');
    expect(container.textContent).not.toContain('%');
  });
});
