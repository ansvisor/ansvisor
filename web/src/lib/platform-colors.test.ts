import { describe, expect, it } from 'vitest';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import { getPlatformName } from '@/lib/traffic-platforms';
import {
  getPlatformColor,
  PLATFORM_COLORS,
  PLATFORM_FALLBACK_COLOR,
  platformColorKey,
} from './platform-colors';

/**
 * One palette for every chart that colors an AI platform: a platform's key,
 * domain or name all give the color its key has, so a platform reads the
 * same on AI Traffic and on Prompts › Insights.
 */

describe('getPlatformColor', () => {
  it('gives an engine name the color of its domain', () => {
    const pairs: [string, string][] = [
      ['ChatGPT', 'chatgpt.com'],
      ['ChatGPT Shopping', 'chatgpt.com'],
      ['Google Gemini', 'gemini.google.com'],
      ['Gemini', 'gemini.google.com'],
      ['Microsoft Copilot', 'copilot.microsoft.com'],
      ['Copilot', 'copilot.microsoft.com'],
      ['Perplexity', 'perplexity.ai'],
      ['Claude', 'claude.ai'],
      ['Grok', 'grok.com'],
      ['DeepSeek', 'deepseek.com'],
      ['Meta AI', 'meta.ai'],
      ['You.com', 'you.com'],
      ['Phind', 'phind.com'],
      ['Poe', 'poe.com'],
      ['Google Labs', 'labs.google'],
      ['Bing', 'bing.com'],
      ['Google AI Overviews', 'google-ai-overviews'],
      ['Google AI Mode', 'google-ai-mode'],
    ];
    for (const [name, domain] of pairs) {
      expect(platformColorKey(name), name).toBe(domain);
      expect(getPlatformColor(name), name).toBe(PLATFORM_COLORS[domain]);
    }
  });

  it('names every platform AI Traffic names, in the color of its domain', () => {
    for (const domain of Object.keys(PLATFORM_COLORS)) {
      expect(getPlatformColor(getPlatformName(domain)), domain).toBe(getPlatformColor(domain));
    }
  });

  it('gives a tracked platform’s slug and its label the same color', () => {
    const slugs = [
      'chatgpt',
      'gemini',
      'perplexity',
      'claude',
      'grok',
      'copilot',
      'meta-ai',
      'google-ai-overviews',
      'google-ai-mode',
      'chatgpt-web',
      'chatgpt-shopping',
      'google-aio',
      'google-aimode',
      'copilot-web',
      'grok-web',
      'perplexity-web',
      'gemini-web',
    ];
    for (const slug of slugs) {
      expect(getPlatformColor(slug), slug).not.toBe(PLATFORM_FALLBACK_COLOR);
      expect(getPlatformColor(PLATFORM_LABELS[slug]), slug).toBe(getPlatformColor(slug));
    }
  });

  it('reads a name in any case and with spaces around it', () => {
    expect(getPlatformColor('  google ai overviews ')).toBe(PLATFORM_COLORS['google-ai-overviews']);
    expect(getPlatformColor('CHATGPT')).toBe('var(--primary)');
    expect(getPlatformColor('Claude.ai')).toBe(PLATFORM_COLORS['claude.ai']);
  });

  it('puts a platform it doesn’t know on the neutral grey', () => {
    expect(PLATFORM_FALLBACK_COLOR).toBe('#a8a29a');
    for (const platform of ['not-an-engine.example', '', 'unknown', 'constructor', '__proto__']) {
      expect(getPlatformColor(platform), platform).toBe(PLATFORM_FALLBACK_COLOR);
    }
    expect(platformColorKey('constructor')).toBeNull();
  });
});

// ─── The two Google AI answers' colors ────────────────────────────────────────

/** sRGB hex → OKLab, ×100 so a distance reads as ΔE. */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s),
    100 * (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s),
    100 * (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s),
  ];
}

function deltaE(a: string, b: string): number {
  const [p, q] = [oklab(a), oklab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the Google AI Overviews and AI Mode colors', () => {
  const overviews = PLATFORM_COLORS['google-ai-overviews'];
  const mode = PLATFORM_COLORS['google-ai-mode'];
  /** The theme's primary: oklch(0.205 0 0) on light, oklch(0.87 0 0) on dark. */
  const ink = { light: '#171717', dark: '#d4d4d4' };
  /** The card: oklch(1 0 0) on light, oklch(0.205 0 0) on dark. */
  const card = { light: '#ffffff', dark: '#171717' };

  it('sets them apart from each other, from Gemini and from every other color', () => {
    expect(deltaE(overviews, mode)).toBeGreaterThanOrEqual(15);
    expect(deltaE(overviews, PLATFORM_COLORS['gemini.google.com'])).toBeGreaterThanOrEqual(12);
    expect(deltaE(mode, PLATFORM_COLORS['gemini.google.com'])).toBeGreaterThanOrEqual(12);
    const others = Object.entries(PLATFORM_COLORS)
      .filter(([key]) => key !== 'google-ai-overviews' && key !== 'google-ai-mode')
      .map(([key, color]) => [key, color === 'var(--primary)' ? ink.light : color]);
    for (const [key, color] of [...others, ['ink on dark', ink.dark]]) {
      expect(deltaE(overviews, color), key).toBeGreaterThanOrEqual(8);
      expect(deltaE(mode, color), key).toBeGreaterThanOrEqual(8);
    }
  });

  it('sets them well apart from the bars beside them on the Prompt Volumes chart', () => {
    // AI Overviews sits above ChatGPT; AI Mode between Claude and Grok.
    expect(deltaE(overviews, ink.light)).toBeGreaterThanOrEqual(15);
    expect(deltaE(overviews, ink.dark)).toBeGreaterThanOrEqual(15);
    expect(deltaE(mode, PLATFORM_COLORS['claude.ai'])).toBeGreaterThanOrEqual(15);
    expect(deltaE(mode, PLATFORM_COLORS['grok.com'])).toBeGreaterThanOrEqual(15);
  });

  it('reads at 3:1 or more on the card in both themes', () => {
    for (const color of [overviews, mode]) {
      expect(contrast(color, card.light), color).toBeGreaterThanOrEqual(3);
      expect(contrast(color, card.dark), color).toBeGreaterThanOrEqual(3);
    }
  });
});
