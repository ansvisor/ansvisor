import { describe, expect, it } from 'vitest';
import {
  defaultPickCount,
  pickedCount,
  promptRoom,
  withDefaultPicks,
} from './onboarding-prompt-picks';

const group = (topic: string, n: number) => ({
  topic,
  prompts: Array.from({ length: n }, (_, i) => `${topic} ${i + 1}`),
});
const tickedPerTopic = (groups: ReturnType<typeof withDefaultPicks>) =>
  groups.map((g) => g.prompts.filter((p) => p.picked).length);

describe('withDefaultPicks', () => {
  it('ticks 15 a topic at a time, so every topic starts with some', () => {
    const picks = withDefaultPicks(Array.from({ length: 7 }, (_, i) => group(`t${i}`, 5)));
    expect(tickedPerTopic(picks)).toEqual([3, 2, 2, 2, 2, 2, 2]);
    expect(pickedCount(picks)).toBe(15);
    // The first prompts of each topic, in order.
    expect(picks[1].prompts.map((p) => p.picked)).toEqual([true, true, false, false, false]);
  });

  it('ticks everything when there are fewer than 15', () => {
    const picks = withDefaultPicks([group('a', 5), group('b', 3), group('c', 0)]);
    expect(tickedPerTopic(picks)).toEqual([5, 3, 0]);
    expect(pickedCount(picks)).toBe(8);
  });

  it('keeps every prompt offered, ticked or not', () => {
    const picks = withDefaultPicks([group('a', 5), group('b', 5)], 4);
    expect(picks.map((g) => g.prompts.length)).toEqual([5, 5]);
    expect(tickedPerTopic(picks)).toEqual([2, 2]);
  });
});

describe('the default ticks and the plan', () => {
  it('ticks 15, or the room left on the plan when it is less', () => {
    expect(defaultPickCount(promptRoom({ maxPrompts: 50, used: 0 }))).toBe(15);
    expect(defaultPickCount(promptRoom({ maxPrompts: 50, used: 40 }))).toBe(10);
    expect(defaultPickCount(promptRoom({ maxPrompts: 50, used: 60 }))).toBe(0);
  });

  it('ticks 15 when the room is unknown or unlimited', () => {
    expect(promptRoom(null)).toBeNull();
    expect(promptRoom({ maxPrompts: -1, used: 300 })).toBeNull();
    expect(defaultPickCount(null)).toBe(15);
  });

  it('spreads a capped count across the topics too', () => {
    const picks = withDefaultPicks(
      Array.from({ length: 7 }, (_, i) => group(`t${i}`, 5)),
      defaultPickCount(10),
    );
    expect(tickedPerTopic(picks)).toEqual([2, 2, 2, 1, 1, 1, 1]);
  });
});
