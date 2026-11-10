import { describe, expect, it } from 'vitest';
import { FANOUT_SHARING_PLATFORMS, fanoutSharing } from './fanout-platforms';

/** How the Query Fan-out page reads each engine's searches (#332). */
describe('fanoutSharing', () => {
  it('expects searches from no engine now that Perplexity is no longer tracked', () => {
    // It shared its own; its past answers read as an ordinary engine's, so a
    // window without its searches is never flagged.
    expect(fanoutSharing('perplexity-web')).toBe('unknown');
    expect(FANOUT_SHARING_PLATFORMS).toEqual([]);
  });

  it('reads the engines that never send them, or whose searches we miss, as not shared', () => {
    // Copilot among them: asked through Bing AI Mode, it shares none.
    for (const platform of [
      'google-aio',
      'google-aimode',
      'gemini-web',
      'copilot-web',
      'claude',
      'gemini',
    ]) {
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
