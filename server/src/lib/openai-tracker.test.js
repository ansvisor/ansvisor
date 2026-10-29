import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The OpenAI API model's searches (#332): read from the same Responses
 * answer the tracking already asks for, its web_search calls' queries kept
 * as the query fan-out. No other call.
 */

const create = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class {
    responses = { create };
  },
}));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENAI_API_KEY = 'sk-test';
const { runPrompt, searchQueriesOf } = await import('./openai-tracker.js');

const search = (action) => ({ type: 'web_search_call', id: 'ws_1', status: 'completed', action });

beforeEach(() => {
  create.mockReset();
});

describe('searchQueriesOf', () => {
  it("keeps each search's query and queries once, trimmed, and nothing else", () => {
    expect(
      searchQueriesOf([
        search({ type: 'search', query: ' best electric kettle 2026 ' }),
        search({ type: 'search', queries: ['kettle reviews', 'best electric kettle 2026', ' '] }),
        search({ type: 'open_page', url: 'https://example.com' }),
        search({ type: 'find_in_page', pattern: 'price' }),
        { type: 'message', content: [] },
        search({ type: 'search', query: 42 }),
      ]),
    ).toEqual([
      { query: 'best electric kettle 2026', source_platform: 'chatgpt' },
      { query: 'kettle reviews', source_platform: 'chatgpt' },
    ]);
    expect(searchQueriesOf(undefined)).toEqual([]);
  });
});

describe('runPrompt', () => {
  it('returns the searches beside the answer and its citations, from one call', async () => {
    create.mockResolvedValue({
      output_text: 'The Acme Kettle is a good pick.',
      output: [
        search({ type: 'search', query: 'best electric kettle' }),
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              annotations: [
                {
                  type: 'url_citation',
                  url: 'https://acme.com/kettle',
                  title: 'Acme Kettle',
                  start_index: 4,
                  end_index: 15,
                },
              ],
            },
          ],
        },
      ],
    });
    const result = await runPrompt('best electric kettle?', undefined, 'US');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'gpt-5-chat-latest',
      tools: [{ type: 'web_search' }],
    });
    expect(result).toEqual({
      text: 'The Acme Kettle is a good pick.',
      citations: [
        { url: 'https://acme.com/kettle', title: 'Acme Kettle', startIndex: 4, endIndex: 15 },
      ],
      model: 'gpt-5-chat-latest',
      search_queries: [{ query: 'best electric kettle', source_platform: 'chatgpt' }],
    });
  });

  it('gives no searches for an answer that ran none', async () => {
    create.mockResolvedValue({ output_text: 'Hello.', output: [] });
    expect((await runPrompt('hi', 'gpt-4.1')).search_queries).toEqual([]);
  });
});
