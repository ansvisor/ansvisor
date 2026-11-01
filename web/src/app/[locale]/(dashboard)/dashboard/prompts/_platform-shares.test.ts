import { describe, expect, it } from 'vitest';
import { AI_PLATFORM_SHARES, AIO_SEARCH_SHARE } from './_platform-shares';

/**
 * The Prompt Volumes chart's split: AI Overviews' share comes from the share
 * of Google searches that show one (AIO_SEARCH_SHARE, ~35%), and the other
 * engines split the rest by their weights.
 */

const share = (name: string) => AI_PLATFORM_SHARES.find((p) => p.name === name)!.share;

describe('AI_PLATFORM_SHARES', () => {
  it('rests on AI Overviews showing on ~35% of Google searches, not the 45% adoption rate', () => {
    expect(AIO_SEARCH_SHARE).toBe(0.35);
    expect(share('Google AI Overviews')).toBeCloseTo(0.602, 3);
    expect(share('ChatGPT')).toBeCloseTo(0.27, 3);
    expect(share('Grok')).toBeCloseTo(0.005, 3);
  });

  it('adds up to every AI-answered query', () => {
    expect(AI_PLATFORM_SHARES.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(1, 10);
    expect(AI_PLATFORM_SHARES).toHaveLength(8);
  });
});
