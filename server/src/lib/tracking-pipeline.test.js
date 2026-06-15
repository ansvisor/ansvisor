import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPrompt } from './openai-tracker.js';
import { parseResponse } from './response-parser.js';

vi.mock('./openai-tracker.js', () => ({
  runPrompt: vi.fn(),
}));

describe('test-tracking pipeline (mocked)', () => {
  const brand = {
    brandName: 'Empler AI',
    domains: ['empler.ai'],
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should parse a tracked response with brand mentions and citations', async () => {
    const mockResponse = {
      text: 'Empler AI is a great platform for automation. Visit empler.ai for more.',
      citations: [
        { url: 'https://empler.ai/about', title: 'Empler AI About' },
        { url: 'https://other.com/review', title: 'Review' },
      ],
      model: 'gpt-5-chat-latest',
    };

    runPrompt.mockResolvedValue(mockResponse);

    const response = await runPrompt('Best AI automation platforms');
    const metrics = parseResponse(response, brand);

    expect(metrics.mentionCount).toBeGreaterThan(0);
    expect(metrics.citationCount).toBeGreaterThanOrEqual(0);
    expect(metrics.visibilityScore).toBeGreaterThanOrEqual(0);
    expect(metrics.visibilityScore).toBeLessThanOrEqual(100);
  });

  it('should handle a response with no brand mentions', async () => {
    const mockResponse = {
      text: 'Some other platform is popular in this space.',
      citations: [{ url: 'https://other.com', title: 'Other' }],
      model: 'gpt-5-chat-latest',
    };

    runPrompt.mockResolvedValue(mockResponse);

    const response = await runPrompt('Best AI automation platforms');
    const metrics = parseResponse(response, brand);

    expect(metrics.mentionCount).toBe(0);
    expect(metrics.citationCount).toBe(0);
    expect(metrics.visibilityScore).toBe(0);
    expect(metrics.sentiment).toBe('neutral');
  });

  it('should handle a response with brand mentions but no citations', async () => {
    const mockResponse = {
      text: 'Empler AI offers strong automation features.',
      citations: [],
      model: 'gpt-5-chat-latest',
    };

    runPrompt.mockResolvedValue(mockResponse);

    const response = await runPrompt('Best AI automation platforms');
    const metrics = parseResponse(response, brand);

    expect(metrics.mentionCount).toBeGreaterThan(0);
    expect(metrics.citationCount).toBe(0);
  });

  it('should handle a response with citations but no brand mentions', async () => {
    const mockResponse = {
      text: 'Several tools exist for this use case.',
      citations: [
        { url: 'https://other.com', title: 'Other Tool' },
        { url: 'https://another.com', title: 'Another' },
      ],
      model: 'gpt-5-chat-latest',
    };

    runPrompt.mockResolvedValue(mockResponse);

    const response = await runPrompt('Best AI automation platforms');
    const metrics = parseResponse(response, brand);

    expect(metrics.mentionCount).toBe(0);
    expect(metrics.citationCount).toBe(0);
    expect(metrics.visibilityScore).toBe(0);
  });

  it('should correctly score a strong brand presence response', async () => {
    const mockResponse = {
      text: 'Empler AI, found at empler.ai, is the top choice. Empler AI leads the market.',
      citations: [
        { url: 'https://empler.ai', title: 'Empler AI' },
        { url: 'https://news.com/empler-ai-review', title: 'Review' },
      ],
      model: 'gpt-5-chat-latest',
    };

    runPrompt.mockResolvedValue(mockResponse);

    const response = await runPrompt('Best AI automation platforms');
    const metrics = parseResponse(response, brand);

    expect(metrics.mentionCount).toBeGreaterThanOrEqual(2);
    expect(metrics.citationCount).toBeGreaterThanOrEqual(1);
    expect(metrics.visibilityScore).toBeGreaterThan(30);
  });

  it('should pass through the model name from the response', async () => {
    const mockResponse = {
      text: 'Empler AI is great.',
      citations: [],
      model: 'gpt-5-chat-latest',
    };

    runPrompt.mockResolvedValue(mockResponse);

    const response = await runPrompt('Best AI automation platforms');

    expect(response.model).toBe('gpt-5-chat-latest');
  });
});
