/**
 * Anthropic Messages API client with web_search tool for prompt tracking.
 * Sends prompts to Claude and returns the response with citations.
 */

import Anthropic from '@anthropic-ai/sdk';

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Run a single prompt through Anthropic Messages API with web_search enabled.
 * @param {string} promptText
 * @param {string} model - e.g. "claude-sonnet-5"
 * @param {string} [region] - ISO 2-letter country code for web_search user_location
 * @returns {Promise<{ text: string, citations: Array<{ url: string, title: string, startIndex: number, endIndex: number }>, model: string }>}
 */
export async function runPromptAnthropic(promptText, model, region) {
  const anthropic = getClient();

  const webSearchTool = {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  };

  if (region) {
    webSearchTool.user_location = { type: 'approximate', country: region };
  }

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: promptText }],
    tools: [webSearchTool],
  });

  let text = '';
  const citations = [];

  for (const block of response.content || []) {
    if (block.type === 'text') {
      text += block.text;

      if (block.citations) {
        for (const cite of block.citations) {
          if (cite.type === 'web_search_result_location') {
            citations.push({
              url: cite.url || '',
              title: cite.title || '',
              startIndex: cite.start_index ?? 0,
              endIndex: cite.end_index ?? 0,
            });
          }
        }
      }
    }
  }

  return { text, citations, model };
}
