import { describe, expect, it } from 'vitest';
import { NO_WHERE, signalWhere, type PromptPlace } from './where';

const prompts = new Map<string, PromptPlace>([
  [
    'p1',
    { platforms: ['chatgpt-web', 'google-aio'], regions: ['US'], topicId: 't1', isActive: true },
  ],
  [
    'p2',
    {
      platforms: ['chatgpt-web', 'chatgpt-shopping'],
      regions: ['US', 'GB'],
      topicId: 't1',
      isActive: true,
    },
  ],
  ['p3', { platforms: ['gemini-web'], regions: [], topicId: 't2', isActive: true }],
  // Paused: still a prompt's own place, but no longer part of its topic's measure.
  ['p4', { platforms: ['grok-web'], regions: ['DE'], topicId: 't1', isActive: false }],
]);

describe('signalWhere', () => {
  it('takes a platform or a location the payload names, without reading prompts', () => {
    expect(signalWhere({ entity: 'platforms', platform: 'gemini-web' }, prompts)).toEqual({
      platforms: ['gemini-web'],
      regions: [],
    });
    expect(signalWhere({ entity: 'regions', region: 'JP', bestRegion: 'US' }, prompts)).toEqual({
      platforms: [],
      regions: ['JP'],
    });
  });

  it("reads a prompt signal's place from its prompt", () => {
    expect(signalWhere({ promptId: 'p1', promptText: 'best tracker' }, prompts)).toEqual({
      platforms: ['chatgpt-web', 'google-aio'],
      regions: ['US'],
    });
  });

  it('joins several prompts, most common first, and leaves shopping out', () => {
    expect(signalWhere({ promptIds: ['p2', 'p1'] }, prompts)).toEqual({
      platforms: ['chatgpt-web', 'google-aio'],
      regions: ['US', 'GB'],
    });
    expect(
      signalWhere({ entity: 'prompts', targets: [{ id: 'p3' }, { id: 'p1' }] }, prompts),
    ).toEqual({ platforms: ['chatgpt-web', 'gemini-web', 'google-aio'], regions: ['US'] });
  });

  it("reads a topic signal's place from the topic's tracked prompts, not its paused ones", () => {
    expect(
      signalWhere({ entity: 'topics', targets: [{ id: 't1', label: 'AEO' }] }, prompts),
    ).toEqual({ platforms: ['chatgpt-web', 'google-aio'], regions: ['US', 'GB'] });
  });

  it('has no place for a competitor, a source domain, or a prompt it cannot find', () => {
    expect(signalWhere({ competitorName: 'Profound' }, prompts)).toBe(NO_WHERE);
    expect(signalWhere({ entity: 'sources', targets: [{ id: 'yotpo.com' }] }, prompts)).toBe(
      NO_WHERE,
    );
    expect(signalWhere({ promptId: 'deleted' }, prompts)).toBe(NO_WHERE);
    expect(signalWhere({ promptId: 'p4' }, prompts)).toEqual({
      platforms: ['grok-web'],
      regions: ['DE'],
    });
  });
});
