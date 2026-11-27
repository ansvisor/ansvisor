import { describe, expect, it } from 'vitest';
import { planBulkPlatformChange, type PlatformChangeRow } from './prompt-platform-change';

/** Adding or removing platforms across selected prompts (00564). Pure. */

const row = (id: string, platforms: string[], over: Partial<PlatformChangeRow> = {}) => ({
  id,
  platforms,
  waiting_platforms: [],
  models: [],
  regions: ['US', 'GB'],
  is_active: true,
  ...over,
});

describe('planBulkPlatformChange', () => {
  it('adds a platform, counting the slots active prompts’ locations take', () => {
    const change = planBulkPlatformChange(
      [
        row('a', ['chatgpt-web']),
        row('b', ['chatgpt-web', 'claude-web']),
        row('c', ['chatgpt-web'], { is_active: false }),
      ],
      'add',
      ['claude-web'],
    );
    expect(change.changes.map((c) => [c.promptId, c.platforms])).toEqual([
      ['a', ['chatgpt-web', 'claude-web']],
      ['c', ['chatgpt-web', 'claude-web']],
    ]);
    expect(change.unchanged).toBe(1);
    // A paused prompt uses no slots.
    expect([...change.needed]).toEqual([['claude-web', 2]]);
  });

  it('runs a platform a prompt waits on again', () => {
    const change = planBulkPlatformChange(
      [row('a', ['chatgpt-web'], { waiting_platforms: ['claude-web', 'grok-web'] })],
      'add',
      ['claude-web'],
    );
    expect(change.changes[0]).toEqual({
      promptId: 'a',
      platforms: ['chatgpt-web', 'claude-web'],
      waiting_platforms: ['grok-web'],
    });
  });

  it('removes a platform from both lists', () => {
    const change = planBulkPlatformChange(
      [
        row('a', ['chatgpt-web', 'claude-web']),
        row('b', ['chatgpt-web'], { waiting_platforms: ['claude-web'] }),
        row('c', ['gemini-web']),
      ],
      'remove',
      ['claude-web'],
    );
    expect(change.changes).toEqual([
      { promptId: 'a', platforms: ['chatgpt-web'], waiting_platforms: [] },
      { promptId: 'b', platforms: ['chatgpt-web'], waiting_platforms: [] },
    ]);
    expect(change.unchanged).toBe(1);
    expect(change.needed.size).toBe(0);
  });

  it('never leaves a prompt with nothing to run', () => {
    const change = planBulkPlatformChange(
      [
        row('a', ['claude-web', 'chatgpt-shopping']),
        row('b', ['claude-web'], { models: ['claude-sonnet-5'] }),
      ],
      'remove',
      ['claude-web'],
    );
    expect(change.blocked).toBe(1);
    expect(change.changes.map((c) => c.promptId)).toEqual(['b']);
  });
});
