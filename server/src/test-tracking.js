/**
 * Quick test script for the prompt tracking pipeline.
 * Run: node src/test-tracking.js
 *
 * Tests: OpenAI Responses API (web_search) -> response parser -> console output
 * No Redis or Supabase required.
 */

import 'dotenv/config';
import { runPrompt } from './lib/openai-tracker.js';
import { parseResponse } from './lib/response-parser.js';

const TEST_PROMPT = 'Best AI automation platforms for sales and marketing teams';
const TEST_BRAND = {
  brandName: 'Empler AI',
  domains: ['empler.ai'],
};

async function main() {
  console.log('=== Prompt Tracking Test ===\n');
  console.log(`Prompt: "${TEST_PROMPT}"`);
  console.log(`Brand:  ${TEST_BRAND.brandName}`);
  console.log(`Domains: ${TEST_BRAND.domains.join(', ')}`);
  console.log(`Model:  gpt-5-chat-latest (default)\n`);
  console.log('Calling OpenAI Responses API with web_search...\n');

  const startTime = Date.now();

  try {
    const response = await runPrompt(TEST_PROMPT);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`--- Response (${elapsed}s) ---`);
    console.log(response.text.slice(0, 500));
    if (response.text.length > 500) console.log(`... (${response.text.length} chars total)`);
    console.log();

    console.log(`--- Citations (${response.citations.length}) ---`);
    for (const cite of response.citations.slice(0, 5)) {
      console.log(`  ${cite.title || 'No title'}`);
      console.log(`  ${cite.url}`);
      console.log();
    }
    if (response.citations.length > 5) {
      console.log(`  ... and ${response.citations.length - 5} more`);
    }

    const metrics = parseResponse(response, TEST_BRAND);
    console.log('--- Metrics ---');
    console.log(`  Mention Count:    ${metrics.mentionCount}`);
    console.log(`  Citation Count:   ${metrics.citationCount}`);
    console.log(`  Sentiment:        ${metrics.sentiment}`);
    console.log(`  Visibility Score: ${metrics.visibilityScore}/100`);
    console.log(`  Model Used:       ${response.model}`);
    console.log('\nTest completed successfully!');
  } catch (err) {
    console.error('Test failed:', err.message);
    if (err.message.includes('API key')) {
      console.error('\nMake sure OPENAI_API_KEY is set in .env');
    }
    process.exit(1);
  }
}

main();
