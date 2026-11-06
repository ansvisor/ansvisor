import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOUR_TARGETS, TOUR_TOPICS, type TourTopic } from '@/lib/chat/tour';
import { TOUR_HIGHLIGHT_CLASSES, TOUR_HIGHLIGHT_MS, useTourHighlight } from './tour-highlight';

/**
 * The tour outlines the element its turn about the page explains, for a
 * few seconds, and does nothing when the element isn't there.
 */

function Highlight({ topic, at }: { topic: TourTopic | null; at: string }) {
  useTourHighlight(topic, at);
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const outlined = (el: Element) => TOUR_HIGHLIGHT_CLASSES.every((c) => el.classList.contains(c));

describe('useTourHighlight', () => {
  it('outlines the element and brings it into view, then lets it go', async () => {
    const cards = document.createElement('div');
    cards.setAttribute('data-tour', 'visibility');
    cards.scrollIntoView = vi.fn();
    document.body.appendChild(cards);

    await act(async () => root.render(<Highlight topic="visibility" at="/dashboard/insights:2" />));
    expect(outlined(cards)).toBe(true);
    expect(cards.scrollIntoView).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(TOUR_HIGHLIGHT_MS));
    expect(outlined(cards)).toBe(false);
  });

  it('finds an element the page draws a moment later', async () => {
    await act(async () => root.render(<Highlight topic="content" at="/dashboard/content:4" />));
    const list = document.createElement('div');
    list.setAttribute('data-tour', 'content');
    document.body.appendChild(list);
    await act(async () => vi.advanceTimersByTime(300));
    expect(outlined(list)).toBe(true);
  });

  it('does nothing without a topic, or without the element on the page', async () => {
    const cards = document.createElement('div');
    cards.setAttribute('data-tour', 'visibility');
    document.body.appendChild(cards);
    await act(async () => root.render(<Highlight topic={null} at="/dashboard/insights:2" />));
    expect(outlined(cards)).toBe(false);

    await act(async () => root.render(<Highlight topic="prompts" at="/dashboard/prompts:4" />));
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(outlined(cards)).toBe(false);
  });

  it('takes the outline off when the page changes', async () => {
    const cards = document.createElement('div');
    cards.setAttribute('data-tour', 'visibility');
    document.body.appendChild(cards);
    await act(async () => root.render(<Highlight topic="visibility" at="/dashboard/insights:2" />));
    expect(outlined(cards)).toBe(true);
    await act(async () => root.render(<Highlight topic={null} at="/dashboard/settings:2" />));
    expect(outlined(cards)).toBe(false);
  });
});

describe('the elements the tour explains', () => {
  const app = path.join(__dirname, '../../../app/[locale]/(dashboard)/dashboard');
  // The file that draws each topic's element, so a mark taken off fails here.
  const SOURCES: Record<TourTopic, [file: string, mark: string]> = {
    visibility: [`${app}/(brand-visibility)/insights/page.tsx`, 'data-tour="visibility"'],
    prompts: [`${app}/prompts/page.tsx`, 'data-tour="prompts"'],
    positions: [`${app}/prompts/page.tsx`, 'data-tour="positions"'],
    content: [`${app}/content/page.tsx`, 'data-tour="content"'],
    connections: [
      path.join(__dirname, '../../settings/integrations-section.tsx'),
      'anchor="google-search-console"',
    ],
  };

  it('are each marked on their page', () => {
    for (const topic of TOUR_TOPICS) {
      const [file, mark] = SOURCES[topic];
      expect(readFileSync(file, 'utf8'), `${topic}: ${TOUR_TARGETS[topic]}`).toContain(mark);
    }
  });
});
