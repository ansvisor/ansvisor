import { describe, expect, it } from 'vitest';
import { getPlatformName } from '@/lib/traffic-platforms';
import { formatTrafficBucketDate, getColor, getPlatformFilterItems } from './_charts';

describe('getColor', () => {
  it('colors each platform as AI Traffic always has, now from the shared palette', () => {
    // AI Traffic's map before it moved to @/lib/platform-colors: the page must not change.
    const before: Record<string, string> = {
      'chatgpt.com': 'var(--primary)',
      'chat.openai.com': 'var(--primary)',
      'search.chatgpt.com': 'var(--primary)',
      'perplexity.ai': '#3f6f68',
      'claude.ai': '#c2603f',
      'gemini.google.com': '#c9973b',
      'copilot.microsoft.com': '#5f7f9a',
      'you.com': '#7a8450',
      'phind.com': '#c9b79c',
      'meta.ai': '#8c5e73',
      'poe.com': '#9a4a2e',
      'labs.google': '#d4b26a',
      'bing.com': '#6b8a99',
      'grok.com': '#a08c74',
      'deepseek.com': '#4f6f8f',
      unknown: '#a8a29a',
    };
    expect(Object.fromEntries(Object.keys(before).map((key) => [key, getColor(key)]))).toEqual(
      before,
    );
    expect(getColor('not-an-engine.example')).toBe('#a8a29a');
  });
});

describe('getPlatformFilterItems', () => {
  it('starts with the all-platforms option, whose value is empty', () => {
    expect(getPlatformFilterItems([], 'All platforms')).toEqual([
      { value: '', label: 'All platforms' },
    ]);
    expect(getPlatformFilterItems(['chatgpt.com'], 'All platforms')[0]).toEqual({
      value: '',
      label: 'All platforms',
    });
  });

  it('labels each platform with its display name while keeping its domain as the value', () => {
    expect(
      getPlatformFilterItems(['chatgpt.com', 'perplexity.ai', 'claude.ai'], 'All platforms').slice(
        1,
      ),
    ).toEqual([
      { value: 'chatgpt.com', label: 'ChatGPT' },
      { value: 'perplexity.ai', label: 'Perplexity' },
      { value: 'claude.ai', label: 'Claude' },
    ]);
  });

  it('falls back to the domain for a platform without a display name', () => {
    expect(getPlatformFilterItems(['example.org'], 'All platforms').slice(1)).toEqual([
      { value: 'example.org', label: 'example.org' },
    ]);
    expect(getPlatformName('example.org')).toBe('example.org');
  });

  it('keeps the order of the platforms it is given', () => {
    const values = getPlatformFilterItems(['poe.com', 'bing.com', 'you.com'], 'All platforms').map(
      (item) => item.value,
    );
    expect(values).toEqual(['', 'poe.com', 'bing.com', 'you.com']);
  });
});

describe('formatTrafficBucketDate', () => {
  it('names a UTC day in English, whatever the browser language (F7)', () => {
    // A Turkish browser used to show "12 Eki".
    const toLocaleDateString = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = function (
      this: Date,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      return toLocaleDateString.call(this, locales ?? 'tr-TR', options);
    };
    try {
      expect(formatTrafficBucketDate('2026-10-12')).toBe('Oct 12');
    } finally {
      Date.prototype.toLocaleDateString = toLocaleDateString;
    }
  });
});

describe('formatTrafficBucketDate for the 24-hour range', () => {
  it("names an hour on the axis, and its day too in the tooltip, in the member's time zone", () => {
    const hour = '2026-10-17T13:00:00.000Z';
    expect(formatTrafficBucketDate(hour, { timeZone: 'UTC' })).toBe('13:00');
    expect(formatTrafficBucketDate(hour, { withDay: true, timeZone: 'UTC' })).toBe('Oct 17, 13:00');
    expect(formatTrafficBucketDate(hour, { timeZone: 'Europe/Istanbul' })).toBe('16:00');
  });
});
