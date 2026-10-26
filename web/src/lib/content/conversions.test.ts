import { describe, expect, it } from 'vitest';
import {
  conversionCards,
  conversionSources,
  journeyPages,
  pageKey,
  type ContentConversions,
} from './conversions';

const read = (over: Partial<ContentConversions> = {}): ContentConversions => ({
  enabled: true,
  goals: [],
  revenue: [],
  sources: [],
  journeys: [],
  ...over,
});

describe('conversionCards', () => {
  it('shows each kind of site its own goals, at 0 when there are none', () => {
    expect(conversionCards(read(), 'b2b')).toEqual([
      { key: 'signup', value: 0 },
      { key: 'demo', value: 0 },
    ]);
    expect(conversionCards(read(), 'b2c').map((card) => card.key)).toEqual([
      'booking',
      'revenue',
      'newsletter',
    ]);
  });

  it('reads a shop’s units from its orders, and adds the goals its site leaves out', () => {
    const conversions = read({
      goals: [
        { goal: 'order', count: 3, units: 7 },
        { goal: 'signup', count: 2, units: 0 },
        { goal: 'custom', count: 1, units: 0 },
      ],
      revenue: [{ currency: 'USD', value: 120 }],
    });
    expect(conversionCards(conversions, 'ecommerce')).toEqual([
      { key: 'order', value: 3 },
      { key: 'revenue', value: [{ currency: 'USD', value: 120 }] },
      { key: 'units', value: 7 },
      { key: 'other', value: 3 },
    ]);
  });
});

describe('conversionSources', () => {
  it('names each source, ChatGPT’s old host as ChatGPT, keys it can’t name as Other, last', () => {
    expect(
      conversionSources(
        read({
          sources: [
            { platform: 'unknown-ai.example', conversions: 9 },
            { platform: 'chatgpt.com', conversions: 2 },
            { platform: 'chat.openai.com', conversions: 1 },
            { platform: 'perplexity.ai', conversions: 4 },
          ],
        }),
      ),
    ).toEqual([
      { name: 'Perplexity', conversions: 4 },
      { name: 'ChatGPT', conversions: 3 },
      { name: null, conversions: 9 },
    ]);
  });
});

describe('pageKey', () => {
  it('keys a page as the database does: no host, query, fragment or trailing slash, lower case', () => {
    expect(pageKey('https://Acme.example/Pricing/?plan=pro#faq')).toBe('/pricing');
    expect(pageKey('https://acme.example')).toBe('/');
    expect(pageKey('https://acme.example/caf%C3%A9')).toBe('/café');
    expect(pageKey('https://acme.example/100%')).toBe('/100%');
  });
});

describe('journeyPages', () => {
  it('keeps up to five pages, or the first, a gap and the last three', () => {
    expect(journeyPages(['/a', '/b'])).toEqual(['/a', '/b']);
    expect(journeyPages(['/a', '/b', '/c', '/d', '/e', '/f'])).toEqual([
      '/a',
      null,
      '/d',
      '/e',
      '/f',
    ]);
  });
});
