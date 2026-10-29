import { describe, expect, it } from 'vitest';
import { fanoutSharing } from './fanout-platforms';

/** Which engines share the searches they ran (#332), for the Query Fan-out page. */
describe('fanoutSharing', () => {
  it("counts the OpenAI API model's web_search queries as shared, Claude's and Gemini's not", () => {
    expect(fanoutSharing('chatgpt')).toBe('shares');
    expect(fanoutSharing('copilot-web')).toBe('shares');
    expect(fanoutSharing('claude')).toBe('not-shared');
    expect(fanoutSharing('gemini')).toBe('not-shared');
    // ChatGPT's own interface: unchanged here.
    expect(fanoutSharing('chatgpt-web')).toBe('not-shared');
    expect(fanoutSharing('something-new')).toBe('unknown');
  });
});
