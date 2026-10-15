import { describe, expect, it } from 'vitest';
import type { Signal } from '@/lib/signals/map';
import { affectedChips, affectedCounts, affectedOf, affectedTotal, leaderText } from './affected';

const signal = (over: Partial<Signal> = {}): Signal =>
  ({
    id: 's1',
    category: 'citation',
    kind: 'lost_citations',
    impact: 'high',
    status: 'new',
    source: ['ai_results'],
    detectedAt: '2026-10-09T00:00:00Z',
    lastDetectedAt: '2026-10-09T00:00:00Z',
    resolvedAt: null,
    previousValue: null,
    currentValue: null,
    changeValue: null,
    payload: {},
    kpiKeys: [],
    actionId: 'a1',
    where: { platforms: [], regions: [], topics: [] },
    ...over,
  }) as Signal;

describe('affectedOf', () => {
  it('lists each lost prompt with where it was lost, the page lost and what is cited instead', () => {
    const affected = affectedOf([
      signal({
        payload: {
          promptId: 'p1',
          promptText: 'Which tools track AI search?',
          lostUrls: [{ url: 'https://acme.example/blog/best-tools', position: 2 }],
          citedNow: [{ url: 'https://profound.com/features', position: 1 }],
        },
        where: { platforms: ['chatgpt-web', 'gemini-web'], regions: ['US'], topics: [] },
      }),
      // A second finding on the same prompt, on another platform: one row.
      signal({
        id: 's2',
        payload: { promptId: 'p1', promptText: 'Which tools track AI search?' },
        where: { platforms: ['google-aio'], regions: ['US'], topics: [] },
      }),
      signal({
        id: 's3',
        payload: { promptId: 'p2', promptText: 'Best AI rank tracker?' },
        where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
      }),
    ]);

    expect(affected.prompts).toEqual([
      {
        id: 'p1',
        text: 'Which tools track AI search?',
        platforms: ['chatgpt-web', 'gemini-web', 'google-aio'],
        lostPages: ['https://acme.example/blog/best-tools'],
        citedInstead: ['https://profound.com/features'],
        leaders: [],
        topics: [],
      },
      {
        id: 'p2',
        text: 'Best AI rank tracker?',
        platforms: ['chatgpt-web'],
        lostPages: [],
        citedInstead: [],
        leaders: [],
        topics: [],
      },
    ]);
    expect(affected.promptTotal).toBe(2);
    expect(affected.platforms).toEqual(['chatgpt-web', 'gemini-web', 'google-aio']);
    expect(affected.lostPages).toEqual(['https://acme.example/blog/best-tools']);
  });

  it('names the prompts a competitor is ahead on, platform by platform', () => {
    const affected = affectedOf([
      signal({
        category: 'competitor',
        kind: 'competitor_leads',
        payload: {
          competitorName: 'Profound',
          positions: [
            {
              promptId: 'p1',
              promptText: 'Best AI rank tracker?',
              platform: 'chatgpt-web',
              competitor: { now: 1, before: 2 },
              you: { now: 4, before: 3 },
            },
          ],
        },
      }),
    ]);

    expect(affected.prompts[0]).toMatchObject({
      id: 'p1',
      platforms: ['chatgpt-web'],
      leaders: [{ competitor: 'Profound', platform: 'chatgpt-web', them: 1, you: 4 }],
    });
    expect(affected.competitors).toEqual(['Profound']);
  });

  it('counts the prompts a grouped finding names beyond its first ones', () => {
    const affected = affectedOf([
      signal({
        category: 'visibility',
        kind: 'prompt_visibility_gap',
        currentValue: 60,
        payload: {
          entity: 'prompts',
          targets: [
            { id: 'p1', label: 'One' },
            { id: 'p2', label: 'Two' },
          ],
        },
      }),
    ]);
    expect(affected.prompts.map((p) => p.text)).toEqual(['One', 'Two']);
    expect(affected.promptTotal).toBe(60);
  });

  it('lists AI-traffic pages with their visits and where they came from', () => {
    const affected = affectedOf([
      signal({
        category: 'traffic',
        kind: 'ai_traffic_drop',
        payload: {
          entity: 'pages',
          targets: [{ id: '/subscriptions', label: '/subscriptions', before: 40, now: 32 }],
          referrals: [
            {
              page: '/subscriptions',
              source: 'analytics',
              sessions: 32,
              before: 40,
              platforms: [{ platform: 'chatgpt.com', sessions: 22, before: 31 }],
            },
          ],
        },
      }),
    ]);
    expect(affected.pages).toEqual([
      {
        url: '/subscriptions',
        sessions: 32,
        before: 40,
        platforms: ['chatgpt.com'],
        issues: [],
      },
    ]);
    expect(affected.pageTotal).toBe(1);
  });

  it('takes an Improve action’s prompt and platforms from what was sent', () => {
    const affected = affectedOf([], {
      promptId: 'p9',
      promptText: 'What are the best coffee subscriptions?',
      platforms: [
        { id: 'gemini-web', label: 'Gemini', state: 'no_runs' },
        { id: 'perplexity-web', label: 'Perplexity', state: 'not_mentioned' },
      ],
    });
    expect(affected.prompts).toEqual([
      expect.objectContaining({
        id: 'p9',
        platforms: ['gemini-web', 'perplexity-web'],
      }),
    ]);
  });

  it('is empty for an action with nothing to list', () => {
    expect(affectedOf([], {})).toMatchObject({ prompts: [], pages: [], promptTotal: 0 });
  });
});

describe('affectedCounts', () => {
  it('counts the pages that lost a citation with the listed ones, once each', () => {
    const affected = affectedOf([
      signal({
        payload: {
          promptId: 'p1',
          promptText: 'One',
          lostUrls: [{ url: 'https://acme.example/a' }, { url: 'https://acme.example/b' }],
        },
        where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
      }),
      signal({
        id: 's2',
        payload: {
          promptId: 'p2',
          promptText: 'Two',
          lostUrls: [{ url: 'https://acme.example/a' }],
        },
      }),
    ]);
    expect(affectedCounts(affected)).toEqual({
      prompts: 2,
      pages: 2,
      platforms: 1,
      competitors: 0,
      topics: 0,
    });
    expect(affectedTotal(affected)).toBe(2);
  });
});

describe('leaderText', () => {
  const t = (key: string, values?: Record<string, string | number>) =>
    `${key}(${Object.values(values ?? {}).join(',')})`;

  it('names the competitor, both positions and the platform', () => {
    expect(
      leaderText({ competitor: 'Trade Coffee', platform: 'chatgpt-web', them: 1, you: 4 }, t),
    ).toBe('aheadValue(Trade Coffee,#1,ChatGPT,#4)');
  });

  it('says so when the brand is not named', () => {
    expect(
      leaderText({ competitor: 'Trade Coffee', platform: 'gemini-web', them: 2, you: null }, t),
    ).toBe('aheadNotNamed(Trade Coffee,#2,Gemini)');
  });
});

describe('what the review found', () => {
  it('does not count a bare prompt count on top of the rows it lists', () => {
    const affected = affectedOf([
      signal({
        category: 'mention',
        kind: 'uncited_mentions',
        payload: {
          promptIds: ['p1', 'p2'],
          mentions: [
            { promptId: 'p1', promptText: 'One', platforms: ['chatgpt-web'], answers: 3 },
            { promptId: 'p2', promptText: 'Two', platforms: ['gemini-web'], answers: 1 },
          ],
        },
        currentValue: 2,
      }),
    ]);
    expect(affected.prompts).toHaveLength(2);
    expect(affected.promptTotal).toBe(2);
  });

  it('counts a platform once whether it is an engine or the site visits came from', () => {
    const affected = affectedOf([
      signal({
        payload: { promptId: 'p1', promptText: 'One' },
        where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
      }),
      signal({
        id: 's2',
        category: 'traffic',
        kind: 'ai_traffic_drop',
        payload: {
          entity: 'pages',
          targets: [{ id: '/a', label: '/a', before: 10, now: 5 }],
          referrals: [
            {
              page: '/a',
              sessions: 5,
              before: 10,
              platforms: [{ platform: 'chatgpt.com', sessions: 5, before: 10 }],
            },
          ],
        },
      }),
    ]);
    expect(affectedCounts(affected).platforms).toBe(1);
  });

  it('keeps visits one signal recorded when another names the page without them', () => {
    const affected = affectedOf([
      signal({
        category: 'traffic',
        kind: 'ai_traffic_drop',
        payload: { entity: 'pages', targets: [{ id: '/a', label: '/a', before: 40, now: 32 }] },
      }),
      signal({
        id: 's2',
        category: 'traffic',
        kind: 'ai_traffic_slipping',
        payload: { entity: 'pages', targets: [{ id: '/a', label: '/a' }] },
      }),
    ]);
    expect(affected.pages[0]).toMatchObject({ sessions: 32, before: 40 });
  });

  it("names a single-prompt signal's topic, which tells copies of one prompt apart", () => {
    const affected = affectedOf([
      signal({
        payload: { promptId: 'p1', promptText: 'Same text' },
        where: { platforms: [], regions: [], topics: ['Coffee subscriptions'] },
      }),
      signal({
        id: 's2',
        payload: { promptId: 'p2', promptText: 'Same text' },
        where: { platforms: [], regions: [], topics: ['Office coffee'] },
      }),
    ]);
    expect(affected.prompts.map((p) => p.topics)).toEqual([
      ['Coffee subscriptions'],
      ['Office coffee'],
    ]);
  });
});

describe('affectedChips', () => {
  const lost = signal({
    payload: { promptId: 'p1', promptText: 'One' },
    where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
  });

  it('opens the Signals tab for signals and Affected for the rest', () => {
    const chips = affectedChips([lost], affectedOf([lost]), 'a1');
    expect(chips).toEqual([
      { entity: 'signals', count: 1, tab: 'signals' },
      { entity: 'prompts', count: 1, tab: 'affected' },
      { entity: 'platforms', count: 1, tab: 'affected' },
    ]);
  });

  it("counts all the action's signals once none supports it any more", () => {
    const resolved = { ...lost, status: 'resolved' } as Signal;
    const chips = affectedChips([resolved], affectedOf([resolved]), 'a1');
    expect(chips[0]).toEqual({ entity: 'signals', count: 1, tab: 'signals' });
  });
});
