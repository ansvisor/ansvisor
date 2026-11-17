import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformColor, PLATFORM_FALLBACK_COLOR } from '@/lib/platform-colors';
import { getColor as trafficColor } from '../traffic/_charts';
import { PlatformVolumeChart } from './_charts';
import { AI_PLATFORM_SHARES } from './_platform-shares';

/**
 * The Prompt Volumes chart on Prompts › Insights colors each engine from the
 * product's platform palette, as AI Traffic does, not in the engines' own
 * brand colors.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
// jsdom has no layout: the chart's container measures 0 wide and draws nothing.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 640,
  });
});

afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The fill of each bar, top to bottom. */
function barFills(): string[] {
  return [...container.querySelectorAll('.recharts-bar-rectangle path')].map(
    (path) => path.getAttribute('fill') ?? '',
  );
}

describe('the Prompt Volumes chart', () => {
  it('colors each engine from the shared platform palette', () => {
    // The bars grow in from zero width, and a zero-width bar draws no path: run the animation out.
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      act(() => {
        root.render(
          <PlatformVolumeChart
            totalVolume={1_000_000}
            totalRange={{ low: 700_000, high: 1_400_000 }}
          />,
        );
      });
      act(() => vi.advanceTimersByTime(5_000));
    } finally {
      vi.useRealTimers();
    }
    const names = [...AI_PLATFORM_SHARES].sort((a, b) => b.share - a.share).map((p) => p.name);
    expect(names[0]).toBe('Google AI Overviews');
    expect(barFills()).toEqual(names.map(getPlatformColor));
    expect(barFills()).toEqual([
      '#c47989',
      'var(--primary)',
      '#c9973b',
      '#5f7f9a',
      '#3f6f68',
      '#c2603f',
      '#7a62a6',
      '#a08c74',
    ]);
  });

  it('gives an engine the color AI Traffic gives the same platform', () => {
    const domains: Record<string, string> = {
      ChatGPT: 'chatgpt.com',
      'Google Gemini': 'gemini.google.com',
      'Microsoft Copilot': 'copilot.microsoft.com',
      Perplexity: 'perplexity.ai',
      Claude: 'claude.ai',
      Grok: 'grok.com',
    };
    for (const [name, domain] of Object.entries(domains)) {
      expect(getPlatformColor(name), name).toBe(trafficColor(domain));
    }
  });

  it('knows every engine it splits the volume between, none in the color it had', () => {
    const before = [
      '#4285f4',
      '#10a37f',
      '#8ab4f8',
      '#0ea5e9',
      '#6366f1',
      '#d97706',
      '#1a73e8',
      '#18181b',
    ];
    for (const { name } of AI_PLATFORM_SHARES) {
      expect(getPlatformColor(name), name).not.toBe(PLATFORM_FALLBACK_COLOR);
      expect(before, name).not.toContain(getPlatformColor(name));
    }
  });
});
