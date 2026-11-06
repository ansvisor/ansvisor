import { describe, expect, it } from 'vitest';
import { FANOUT_SHARING_PLATFORMS, fanoutSharing } from './fanout-platforms';

/** How the Query Fan-out page reads each engine's searches (#332). */
describe('fanoutSharing', () => {
  it('expects searches from no engine now that Copilot and Perplexity are no longer tracked', () => {
    // They shared theirs; their past answers read as an ordinary engine's,
    // so a window without their searches is never flagged.
    expect(fanoutSharing('copilot-web')).toBe('unknown');
    expect(fanoutSharing('perplexity-web')).toBe('unknown');
    expect(FANOUT_SHARING_PLATFORMS).toEqual([]);
  });

  it('reads the engines that never send them, or whose searches we miss, as not shared', () => {
    for (const platform of ['google-aio', 'google-aimode', 'gemini-web', 'claude', 'gemini']) {
      expect(fanoutSharing(platform)).toBe('not-shared');
    }
  });

  it('expects nothing either way from ChatGPT and the ChatGPT API, which send them some days', () => {
    // ChatGPT: sampled one day a week per prompt. The API model: when it searches.
    expect(fanoutSharing('chatgpt-web')).toBe('unknown');
    expect(fanoutSharing('chatgpt')).toBe('unknown');
    expect(fanoutSharing('something-new')).toBe('unknown');
  });
});
