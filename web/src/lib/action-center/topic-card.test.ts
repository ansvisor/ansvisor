import { describe, expect, it } from 'vitest';
import {
  accountOldEnough,
  nameKey,
  pickTopicCandidate,
  snoozeUntil,
  topicCandidates,
  topicCardTime,
  waitingMarks,
  type PickInput,
  type PromptIdeaRow,
} from './topic-card';

const now = new Date('2026-11-16T09:00:00Z');

const idea = (
  id: string,
  topicName: string,
  source: string,
  over: Partial<PromptIdeaRow> = {},
): PromptIdeaRow => ({ id, topicId: null, topicName, source, expiresAt: null, ...over });

const catalog = (id: string, name: string, products: number) => ({
  id,
  name,
  source: 'catalog',
  sourceData: { category: `Coffee > ${name}`, categoryId: 'c1', products, inStock: products },
});

const input = (over: Partial<PickInput> = {}): PickInput => ({
  topicSuggestions: [],
  promptIdeas: [],
  topics: [],
  coveredTopicIds: new Set(),
  hidden: {},
  now,
  ...over,
});

describe('New area to track: the candidate', () => {
  it('takes a catalog category with 3 or more products, and not one with fewer', () => {
    const picked = pickTopicCandidate(
      input({ topicSuggestions: [catalog('t1', 'Cold brew', 4), catalog('t2', 'Mugs', 2)] }),
    );
    expect(picked).toMatchObject({
      key: 'cold brew',
      name: 'Cold brew',
      source: 'catalog',
      catalog: { suggestionId: 't1', category: 'Coffee > Cold brew', products: 4 },
      search: null,
      businessHub: null,
    });
    expect(topicCandidates(input({ topicSuggestions: [catalog('t2', 'Mugs', 2)] }))).toEqual([]);
  });

  it('takes 3 or more Search Console or Analytics ideas under one topic name, case aside', () => {
    const ideas = [
      idea('p1', 'Decaf', 'gsc'),
      idea('p2', 'decaf ', 'ga'),
      idea('p3', 'DECAF', 'gsc'),
      idea('p4', 'Espresso', 'gsc'),
      idea('p5', 'Espresso', 'gsc'),
    ];
    const candidates = topicCandidates(input({ promptIdeas: ideas }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      key: 'decaf',
      name: 'Decaf',
      source: 'search',
      search: { count: 3, sources: ['ga', 'gsc'] },
    });
  });

  it('takes 2 or more Business Hub ideas under one discovery topic, while they last', () => {
    const live = [
      idea('b1', 'Office coffee', 'business_hub', { expiresAt: '2026-12-01T00:00:00Z' }),
      idea('b2', 'Office coffee', 'business_hub', { expiresAt: '2026-12-01T00:00:00Z' }),
    ];
    expect(pickTopicCandidate(input({ promptIdeas: live }))).toMatchObject({
      source: 'business_hub',
      businessHub: { count: 2 },
    });
    const expired = live.map((row) => ({ ...row, expiresAt: '2026-11-10T00:00:00Z' }));
    expect(pickTopicCandidate(input({ promptIdeas: expired }))).toBeNull();
  });

  it("counts the model's topic idea only beside stored evidence", () => {
    const llm = { id: 'l1', name: 'cold brew', source: 'llm', sourceData: null };
    expect(pickTopicCandidate(input({ topicSuggestions: [llm] }))).toBeNull();
    expect(
      pickTopicCandidate(input({ topicSuggestions: [llm, catalog('t1', 'Cold brew', 4)] })),
    ).toMatchObject({ llmSuggestionId: 'l1', catalog: { suggestionId: 't1' } });
  });

  it('leaves out ideas from other sources, and those without a topic name', () => {
    const ideas = ['catalog', 'llm', 'heuristic'].map((source, i) =>
      idea(`x${i}`, 'Grinders', source),
    );
    ideas.push(idea('n1', '', 'gsc'), { ...idea('n2', '', 'gsc'), topicName: null });
    expect(topicCandidates(input({ promptIdeas: ideas }))).toEqual([]);
  });

  it('leaves out a topic the brand tracks or keeps waiting, by name or by the ideas’ topic', () => {
    const ideas = [1, 2, 3].map((n) => idea(`p${n}`, 'Decaf', 'gsc', { topicId: 'topic-1' }));
    // The refresh made the topic and nothing tracks in it yet: still a new area, with its topic.
    expect(
      pickTopicCandidate(input({ promptIdeas: ideas, topics: [{ id: 'topic-1', name: 'Decaf' }] })),
    ).toMatchObject({ key: 'decaf', topicId: 'topic-1' });
    expect(
      pickTopicCandidate(input({ promptIdeas: ideas, coveredTopicIds: new Set(['topic-1']) })),
    ).toBeNull();
    expect(
      pickTopicCandidate(
        input({
          topicSuggestions: [catalog('t1', 'Cold Brew', 5)],
          topics: [{ id: 'topic-2', name: 'cold  brew' }],
          coveredTopicIds: new Set(['topic-2']),
        }),
      ),
    ).toBeNull();
  });

  it('leaves out a topic the person snoozed until the snooze ends', () => {
    const suggestions = [catalog('t1', 'Cold brew', 4)];
    expect(
      pickTopicCandidate(
        input({
          topicSuggestions: suggestions,
          hidden: { 'topic:cold brew': '2026-12-01T00:00:00Z' },
        }),
      ),
    ).toBeNull();
    // The snooze kept has passed: the topic can come back.
    expect(
      pickTopicCandidate(
        input({
          topicSuggestions: suggestions,
          hidden: { 'topic:cold brew': '2026-11-01T00:00:00Z' },
        }),
      ),
    ).toMatchObject({ key: 'cold brew' });
    expect(snoozeUntil(now).toISOString()).toBe('2026-12-16T09:00:00.000Z');
  });

  it('puts the topic with the most sources first, then a model idea, then the most evidence', () => {
    const ranked = topicCandidates(
      input({
        topicSuggestions: [
          catalog('t1', 'Mugs', 9),
          catalog('t2', 'Cold brew', 4),
          { id: 'l1', name: 'Decaf', source: 'llm', sourceData: null },
        ],
        promptIdeas: [
          ...[1, 2, 3].map((n) => idea(`c${n}`, 'Cold brew', 'gsc')),
          ...[1, 2, 3].map((n) => idea(`d${n}`, 'Decaf', 'gsc')),
          ...[1, 2, 3, 4].map((n) => idea(`e${n}`, 'Espresso', 'ga')),
        ],
      }),
    );
    expect(ranked.map((c) => c.key)).toEqual(['cold brew', 'decaf', 'mugs', 'espresso']);
  });

  it('keys a name as Not now keeps it: one space, lower case, no control characters', () => {
    expect(nameKey('  Cold\tBrew \u0007 Gear ')).toBe('cold brew gear');
    expect(nameKey('x'.repeat(200))).toHaveLength(120);
  });
});

describe('New area to track: when', () => {
  it('waits until the workspace’s first brand is 14 days old', () => {
    expect(accountOldEnough('2026-11-02T09:00:00Z', now)).toBe(true);
    expect(accountOldEnough('2026-11-02T09:00:01Z', now)).toBe(false);
    expect(accountOldEnough(null, now)).toBe(false);
    expect(accountOldEnough('not a date', now)).toBe(false);
  });

  it("shows on the person's Monday, or once today's focus is read and finished", () => {
    expect(topicCardTime(true, null)).toBe(true);
    expect(topicCardTime(false, [])).toBe(true);
    expect(topicCardTime(false, [{ id: 'a1' }])).toBe(false);
    // Not read yet, or the read failed: not finished.
    expect(topicCardTime(false, null)).toBe(false);
  });

  it('marks the ticked prompts past the spots left as waiting, none when unlimited', () => {
    const ticked = new Set([0, 1, 3, 4]);
    expect(waitingMarks(5, ticked, 2)).toEqual([false, false, false, true, true]);
    expect(waitingMarks(5, ticked, 0)).toEqual([true, true, false, true, true]);
    expect(waitingMarks(5, ticked, null)).toEqual([false, false, false, false, false]);
  });
});
