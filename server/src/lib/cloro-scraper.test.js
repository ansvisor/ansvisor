import { describe, it, expect } from 'vitest';
import { parseScraperResponse } from './cloro-scraper.js';

describe('cloro-scraper – parseScraperResponse', () => {
  describe('chatgpt-shopping', () => {
    it('should parse text, citations, model, shopping_cards and inline_products', () => {
      const result = {
        markdown: 'Hello shopping world',
        model: 'gpt-5-3-mini',
        sources: [
          { url: 'https://a.com', label: 'A' },
          { url: 'https://b.com', label: 'B' },
        ],
        shoppingCards: [{ id: 'card1' }],
        inlineProducts: [{ id: 'prod1' }],
      };

      const parsed = parseScraperResponse(result, 'chatgpt-shopping');

      expect(parsed.text).toBe('Hello shopping world');
      expect(parsed.citations).toEqual([
        { url: 'https://a.com', title: 'A', startIndex: 0, endIndex: 50 },
        { url: 'https://b.com', title: 'B', startIndex: 100, endIndex: 150 },
      ]);
      expect(parsed.model).toBe('gpt-5-3-mini');
      expect(parsed.shopping_cards).toEqual([{ id: 'card1' }]);
      expect(parsed.inline_products).toEqual([{ id: 'prod1' }]);
    });

    it('should fall back to text when markdown is missing', () => {
      const result = { text: 'fallback text', sources: [] };
      const parsed = parseScraperResponse(result, 'chatgpt-shopping');
      expect(parsed.text).toBe('fallback text');
    });

    it('should default model to gpt-5-3-mini when missing', () => {
      const result = { markdown: 'hi', sources: [] };
      const parsed = parseScraperResponse(result, 'chatgpt-shopping');
      expect(parsed.model).toBe('gpt-5-3-mini');
    });

    it('should default shopping_cards and inline_products to empty arrays', () => {
      const result = { markdown: 'hi', sources: [] };
      const parsed = parseScraperResponse(result, 'chatgpt-shopping');
      expect(parsed.shopping_cards).toEqual([]);
      expect(parsed.inline_products).toEqual([]);
    });
  });

  describe('google-aio', () => {
    it('should parse aioverview text and citations', () => {
      const result = {
        aioverview: {
          markdown: 'AI overview text',
          sources: [{ url: 'https://x.com', label: 'X' }],
        },
      };

      const parsed = parseScraperResponse(result, 'google-aio');

      expect(parsed.text).toBe('AI overview text');
      expect(parsed.citations).toEqual([
        { url: 'https://x.com', title: 'X', startIndex: 0, endIndex: 50 },
      ]);
      expect(parsed.model).toBe('google-aio');
      expect(parsed.shopping_cards).toEqual([]);
    });

    it('should fall back to text inside aioverview when markdown is missing', () => {
      const result = {
        aioverview: {
          text: 'fallback aio text',
          sources: [],
        },
      };

      const parsed = parseScraperResponse(result, 'google-aio');
      expect(parsed.text).toBe('fallback aio text');
    });

    it('should throw when aioverview is missing', () => {
      const result = { markdown: 'no aioverview here', sources: [] };
      expect(() => parseScraperResponse(result, 'google-aio')).toThrow(
        'Google did not return an AI Overview for this query',
      );
    });
  });

  describe('google-aimode', () => {
    it('should use result.result when present', () => {
      const inner = {
        markdown: 'ai mode text',
        sources: [{ url: 'https://y.com', label: 'Y' }],
        shoppingCards: [{ sku: 'abc' }],
      };

      const parsed = parseScraperResponse({ result: inner }, 'google-aimode');

      expect(parsed.text).toBe('ai mode text');
      expect(parsed.citations).toEqual([
        { url: 'https://y.com', title: 'Y', startIndex: 0, endIndex: 50 },
      ]);
      expect(parsed.model).toBe('google-aimode');
      expect(parsed.shopping_cards).toEqual([{ sku: 'abc' }]);
    });

    it('should fall back to root result when result.result is absent', () => {
      const result = {
        markdown: 'root aimode text',
        sources: [{ url: 'https://z.com', label: 'Z' }],
        shoppingCards: [],
      };

      const parsed = parseScraperResponse(result, 'google-aimode');
      expect(parsed.text).toBe('root aimode text');
      expect(parsed.citations).toEqual([
        { url: 'https://z.com', title: 'Z', startIndex: 0, endIndex: 50 },
      ]);
      expect(parsed.shopping_cards).toEqual([]);
    });

    it('should normalize missing sources to empty array', () => {
      const result = { result: { markdown: 'no sources', shoppingCards: [] } };
      const parsed = parseScraperResponse(result, 'google-aimode');
      expect(parsed.citations).toEqual([]);
    });
  });

  describe('default / other providers', () => {
    it('should parse text, citations and model', () => {
      const result = {
        markdown: 'generic text',
        model: 'gpt-4',
        sources: [
          { url: 'https://foo.com', label: 'Foo' },
          { url: 'https://bar.com', label: 'Bar' },
        ],
        shopping_cards: [{ id: 's1' }],
      };

      const parsed = parseScraperResponse(result, 'perplexity-web');

      expect(parsed.text).toBe('generic text');
      expect(parsed.citations).toEqual([
        { url: 'https://foo.com', title: 'Foo', startIndex: 0, endIndex: 50 },
        { url: 'https://bar.com', title: 'Bar', startIndex: 100, endIndex: 150 },
      ]);
      expect(parsed.model).toBe('gpt-4');
      expect(parsed.shopping_cards).toEqual([{ id: 's1' }]);
    });

    it('should fall back to text when markdown is missing', () => {
      const parsed = parseScraperResponse({ text: 'text only', sources: [] }, 'copilot-web');
      expect(parsed.text).toBe('text only');
    });

    it('should fall back to scraperId as model when model is missing', () => {
      const parsed = parseScraperResponse({ markdown: 'no model', sources: [] }, 'grok-web');
      expect(parsed.model).toBe('grok-web');
    });

    it('should normalize missing sources to empty citations', () => {
      const parsed = parseScraperResponse({ markdown: 'no sources', model: 'x' }, 'gemini-web');
      expect(parsed.citations).toEqual([]);
    });

    it('should default shopping_cards to empty array when neither key is present', () => {
      const parsed = parseScraperResponse({ markdown: 'no cards', sources: [] }, 'gemini-web');
      expect(parsed.shopping_cards).toEqual([]);
    });
  });
});
