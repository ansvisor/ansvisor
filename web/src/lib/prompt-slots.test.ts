import { describe, expect, it } from 'vitest';
import {
  freeSlots,
  platformsToWait,
  settlePrompt,
  slotUsage,
  stillWaiting,
  type SlottedPrompt,
} from './prompt-slots';

const prompt = (
  id: string,
  platforms: string[],
  regions: string[] | null = null,
  extra: Partial<SlottedPrompt> = {},
): SlottedPrompt => ({ id, platforms, regions, ...extra });

describe('slotUsage', () => {
  it('counts each prompt location on each platform it runs on', () => {
    const used = slotUsage([
      prompt('a', ['chatgpt-web', 'gemini-web'], ['US', 'GB', 'DE']),
      prompt('b', ['chatgpt-web']),
      prompt('c', ['chatgpt-shopping', 'chatgpt-web']),
    ]);
    expect(used.get('chatgpt-web')).toBe(5);
    expect(used.get('gemini-web')).toBe(3);
    expect(used.has('chatgpt-shopping')).toBe(false);
  });
});

describe('freeSlots', () => {
  const used = new Map([['chatgpt-web', 240]]);
  it('is what is left of the platform’s slots', () => {
    expect(freeSlots({ 'chatgpt-web': 250 }, used, 'chatgpt-web')).toBe(10);
    expect(freeSlots({ 'chatgpt-web': 200 }, used, 'chatgpt-web')).toBe(0);
  });
  it('is 0 on a platform with no slots, Infinity with no limit', () => {
    expect(freeSlots({}, used, 'claude-web')).toBe(0);
    expect(freeSlots({ 'claude-web': -1 }, used, 'claude-web')).toBe(Infinity);
  });
});

describe('platformsToWait', () => {
  it('lets the newest prompts wait on a platform over its slots, and nothing else', () => {
    const newestFirst = [
      prompt('new', ['chatgpt-web', 'perplexity-web'], ['US', 'GB']),
      prompt('mid', ['perplexity-web']),
      prompt('old', ['chatgpt-web', 'perplexity-web']),
    ];
    const moves = platformsToWait(newestFirst, { 'chatgpt-web': 250, 'perplexity-web': 2 });
    expect([...moves]).toEqual([['new', ['perplexity-web']]]);
  });

  it('makes every prompt on an unslotted platform wait', () => {
    const moves = platformsToWait(
      [prompt('a', ['chatgpt-web', 'grok-web']), prompt('b', ['grok-web'])],
      { 'chatgpt-web': 250 },
    );
    expect(moves.get('a')).toEqual(['grok-web']);
    expect(moves.get('b')).toEqual(['grok-web']);
  });

  it('leaves everything when each platform fits', () => {
    expect(platformsToWait([prompt('a', ['chatgpt-web'])], { 'chatgpt-web': 1 }).size).toBe(0);
  });
});

describe('settlePrompt', () => {
  it('moves the waiting platforms out of the running ones', () => {
    expect(
      settlePrompt(prompt('a', ['chatgpt-web', 'perplexity-web'], null, { models: [] }), [
        'perplexity-web',
      ]),
    ).toEqual({ platforms: ['chatgpt-web'], waiting_platforms: ['perplexity-web'], idle: false });
  });

  it('is idle when only ChatGPT Shopping and no model is left', () => {
    expect(
      settlePrompt(prompt('a', ['grok-web', 'chatgpt-shopping'], null, { models: [] }), [
        'grok-web',
      ]).idle,
    ).toBe(true);
    expect(
      settlePrompt(prompt('a', ['grok-web'], null, { models: ['gpt-5-mini'] }), ['grok-web']).idle,
    ).toBe(false);
  });

  it('keeps what already waited', () => {
    expect(
      settlePrompt(
        prompt('a', ['chatgpt-web', 'claude-web'], null, { waiting_platforms: ['grok-web'] }),
        ['claude-web'],
      ).waiting_platforms,
    ).toEqual(['grok-web', 'claude-web']);
  });
});

describe('stillWaiting', () => {
  it('drops the platforms that run again', () => {
    expect(stillWaiting(['grok-web', 'claude-web'], ['chatgpt-web', 'claude-web'])).toEqual([
      'grok-web',
    ]);
    expect(stillWaiting(null, ['chatgpt-web'])).toEqual([]);
  });
});
