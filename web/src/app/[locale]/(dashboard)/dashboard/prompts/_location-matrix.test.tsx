import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PromptLocationCell } from '@/lib/prompt-location-matrix';
import type { Prompt } from '@/types';

const getPromptLocationMatrix = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/prompt', () => ({ getPromptLocationMatrix }));

const { LocationMatrix } = await import('./_location-matrix');

/** Tracked Prompts' Locations view (PROMPT-015b). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '11111111-1111-1111-1111-111111111111';
let container: HTMLDivElement;
let root: Root;

const prompt = (id: string, text: string, regions: string[], category = 'Coffee'): Prompt =>
  ({ id, text, regions, category }) as unknown as Prompt;
const cell = (score: number, position: number | null = 3.2): PromptLocationCell => ({
  score,
  mentions: Math.round(score / 2),
  citations: 2,
  position,
  runs: 6,
});

const rows = [
  prompt('p1', 'best specialty coffee subscription', ['US', 'TR']),
  prompt('p2', 'same day coffee delivery near me', ['US']),
];
const onOpenCell = vi.fn();
const onTrack = vi.fn();

async function render(canTrack = true) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <LocationMatrix
          brandId={BRAND}
          rows={rows}
          pageRows={rows}
          window={{ from: '2026-10-21T00:00:00Z' }}
          onOpenCell={onOpenCell}
          onTrack={canTrack ? onTrack : undefined}
        />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

const bodyRows = () =>
  [...container.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent),
  );

beforeEach(() => {
  getPromptLocationMatrix.mockReset().mockResolvedValue({
    p1: { US: cell(62), TR: cell(35, null) },
    p2: { US: cell(20, 6.4) },
  });
  onOpenCell.mockReset();
  onTrack.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('LocationMatrix', () => {
  it('reads each tracked location, the most tracked first, and shows each prompt there', async () => {
    const text = await render();
    expect(getPromptLocationMatrix).toHaveBeenCalledWith(BRAND, {
      from: '2026-10-21T00:00:00Z',
      to: undefined,
      regions: ['US', 'TR'],
    });
    expect(text).toContain('United States');
    expect(text).toContain('Turkey');
    expect(bodyRows()).toEqual([
      ['All prompts · average', '—', '41', '35', '—'],
      ['best specialty coffee subscription', 'Coffee', '62', '35', '27'],
      ['same day coffee delivery near me', 'Coffee', '20', '+ Track', '—'],
    ]);
    expect(text).toContain('Weakest location');
    expect(text).toContain('Biggest gap between locations');
  });

  it('marks a city column with the engines that answer from it (PROMPT-015d)', async () => {
    rows[0] = prompt('p1', 'best specialty coffee subscription', ['US', 'TR', 'TR~ISTANBUL']);
    getPromptLocationMatrix.mockResolvedValue({
      p1: { US: cell(62), TR: cell(35), 'TR~ISTANBUL': cell(41) },
    });
    const text = await render();
    expect(text).toContain('İstanbul');
    expect(text).toContain('City');
    expect(text).toContain('AI Mode · AIO · APIs');
    rows[0] = prompt('p1', 'best specialty coffee subscription', ['US', 'TR']);
  });

  it('switches the metric, and reads a prompt never named there as such', async () => {
    await render();
    const position = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Position',
    )!;
    await act(async () => position.click());
    expect(position.getAttribute('aria-pressed')).toBe('true');
    expect(bodyRows()[1]).toEqual([
      'best specialty coffee subscription',
      'Coffee',
      '#3.2',
      'Not named',
      '—',
    ]);
  });

  it("opens a cell's positions for its location, and tracks a prompt where it isn't", async () => {
    await render();
    (
      container.querySelector(
        'button[aria-label="best specialty coffee subscription in Turkey: open its positions"]',
      ) as HTMLButtonElement
    ).click();
    expect(onOpenCell).toHaveBeenCalledWith('p1', 'TR');
    (
      container.querySelector(
        'button[aria-label="Track “same day coffee delivery near me” in Turkey"]',
      ) as HTMLButtonElement
    ).click();
    expect(onTrack).toHaveBeenCalledWith(rows[1], 'TR');
  });

  it("offers no + Track to a member who can't edit, and says when nothing is tracked in a location", async () => {
    await render(false);
    expect(container.textContent).not.toContain('+ Track');
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <LocationMatrix
            brandId={BRAND}
            rows={[prompt('p3', 'untargeted', [])]}
            pageRows={[prompt('p3', 'untargeted', [])]}
            window={{ from: '2026-10-21T00:00:00Z' }}
            onOpenCell={onOpenCell}
          />
        </NextIntlClientProvider>,
      );
    });
    expect(container.textContent).toContain("Your prompts aren't tracked in a location yet.");
  });
});
