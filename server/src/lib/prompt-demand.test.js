import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A prompt's real demand (PROMPT-014): Search Console every night, Google
 * Trends, People Also Ask and YouTube from DataForSEO's queued tasks once a
 * week (DEMAND_SIGNALS), and the level they come to.
 */

// ─── A database in memory ───────────────────────────────────────────────────

let tables;
let writes;
let rpcCalls;

function valueAt(row, path) {
  return path.split('.').reduce((v, key) => (v == null ? v : v[key]), row);
}

function query(table) {
  const filters = [];
  let range = null;
  let op = 'select';
  let payload = null;
  const rows = () => {
    let out = (tables[table] ?? []).filter((row) =>
      filters.every(([kind, col, value]) => {
        const v = valueAt(row, col);
        if (kind === 'eq') return v === value;
        if (kind === 'in') return value.includes(v);
        if (kind === 'notNull') return v !== null && v !== undefined;
        return true;
      }),
    );
    if (range) out = out.slice(range[0], range[1] + 1);
    return out;
  };
  const chain = {
    select: () => chain,
    eq: (col, value) => (filters.push(['eq', col, value]), chain),
    in: (col, value) => (filters.push(['in', col, value]), chain),
    not: (col, operator, value) => {
      if (operator === 'is' && value === null) filters.push(['notNull', col]);
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    range: (from, to) => ((range = [from, to]), chain),
    upsert: (data) => ((op = 'upsert'), (payload = data), chain),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve, reject) => {
      if (op === 'upsert') {
        writes.push({ table, rows: payload });
        const kept = tables[table] ?? (tables[table] = []);
        for (const row of payload) {
          const at = kept.findIndex((r) => r.prompt_id === row.prompt_id);
          if (at === -1) kept.push({ ...row });
          else kept[at] = { ...kept[at], ...row };
        }
        return Promise.resolve({ error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    },
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => query(table),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { data: tables.gsc?.[args.p_brand_id] ?? [], error: null };
    },
  },
}));

// The plan check (#1608): the organizations and brands whose plan ended.
let endedOrgs;
let endedBrands;
vi.mock('./active-subscriptions.js', () => ({
  activeOrgFilter: async () => (orgId) => !endedOrgs.has(orgId),
  activeBrandFilter: async () => (brandId) => !endedBrands.has(brandId),
}));

const postTasks = vi.fn();
const readyTaskIds = vi.fn();
const getTask = vi.fn();
vi.mock('./dataforseo.js', () => ({
  isDataForSeoConfigured: () => true,
  postTasks,
  readyTaskIds,
  getTask,
}));

// The Action Center's priority reads the levels: a brand whose levels changed is scored again.
const rescoreBrandActions = vi.fn();
vi.mock('./action-center/priority-data.js', () => ({ rescoreBrandActions }));

const {
  LEVEL_RULE,
  NIGHTLY_LIMIT,
  REFRESH_DAYS,
  SOURCES,
  TASK_EXPIRE_DAYS,
  collectDemandTasks,
  demandLevel,
  demandResponse,
  gscDemand,
  isDue,
  paaSignal,
  pickDue,
  sweepPromptDemand,
  topKeyword,
  trendsKeyword,
  trendsSignal,
  youtubeSignal,
} = await import('./prompt-demand.js');

const NOW = Date.parse('2026-10-28T06:00:00Z');
const AT = new Date(NOW).toISOString();
const DAY = 86_400_000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

// ─── Realistic DataForSEO results ───────────────────────────────────────────

/** Google Trends Explore, one keyword: 52 weeks, the last ones higher. */
function trendsResult(values) {
  return {
    keywords: ['ai search monitoring'],
    type: 'web',
    location_code: 2840,
    language_code: 'en',
    check_url: 'https://trends.google.com/trends/explore?q=ai%20search%20monitoring',
    datetime: '2026-10-27 22:10:01 +00:00',
    items_count: 1,
    items: [
      {
        position: 1,
        type: 'google_trends_graph',
        title: 'Interest over time',
        keywords: ['ai search monitoring'],
        data: values.map((value, i) => ({
          date_from: new Date(Date.UTC(2025, 9, 26) + i * 7 * DAY).toISOString().slice(0, 10),
          date_to: new Date(Date.UTC(2025, 9, 26) + (i * 7 + 6) * DAY).toISOString().slice(0, 10),
          timestamp: (Date.UTC(2025, 9, 26) + i * 7 * DAY) / 1000,
          missing_data: false,
          values: [value],
        })),
        averages: [40],
      },
    ],
  };
}

/** Google organic (advanced) with a People Also Ask block among the results. */
const SERP_RESULT = {
  keyword: 'ai search monitoring',
  type: 'organic',
  se_domain: 'google.com',
  location_code: 2840,
  language_code: 'en',
  check_url: 'https://www.google.com/search?q=ai+search+monitoring',
  datetime: '2026-10-27 22:12:40 +00:00',
  item_types: ['organic', 'people_also_ask', 'related_searches'],
  se_results_count: 245000000,
  items_count: 12,
  items: [
    {
      type: 'organic',
      rank_group: 1,
      rank_absolute: 1,
      domain: 'example.com',
      title: 'AI Search Monitoring',
      url: 'https://example.com/',
    },
    {
      type: 'people_also_ask',
      rank_group: 1,
      rank_absolute: 3,
      position: 'left',
      xpath: '/html[1]/body[1]/div[3]',
      items: [
        {
          type: 'people_also_ask_element',
          title: 'How do I track my brand in ChatGPT?',
          seed_question: null,
          xpath: '/html[1]/body[1]/div[3]/div[1]',
          expanded_element: [
            {
              type: 'people_also_ask_expanded_element',
              featured_title: null,
              url: 'https://www.example.org/track-brand-chatgpt',
              domain: 'www.example.org',
              title: 'Track your brand in ChatGPT',
              description: 'To track your brand…',
              images: null,
              timestamp: null,
              table: null,
            },
          ],
        },
        {
          type: 'people_also_ask_element',
          title: 'What is AI search monitoring?',
          seed_question: null,
          xpath: '/html[1]/body[1]/div[3]/div[2]',
          expanded_element: [
            {
              type: 'people_also_ask_ai_overview_expanded_element',
              items: [{ type: 'ai_overview_element', text: '…' }],
            },
          ],
        },
        {
          type: 'people_also_ask_element',
          title: 'how do i track my brand in chatgpt?',
          seed_question: null,
          xpath: '/html[1]/body[1]/div[3]/div[3]',
          expanded_element: null,
        },
        {
          type: 'people_also_ask_element',
          title: 'Is there a tool to monitor AI answers?',
          seed_question: null,
          xpath: '/html[1]/body[1]/div[3]/div[4]',
          expanded_element: [],
        },
      ],
    },
    { type: 'related_searches', rank_group: 1, rank_absolute: 11, items: ['ai monitoring tools'] },
  ],
};

/** YouTube organic (advanced): videos and a channel. */
const YOUTUBE_RESULT = {
  keyword: 'ai search monitoring',
  type: 'organic',
  se_domain: 'youtube.com',
  location_code: 2840,
  language_code: 'en',
  check_url: 'https://www.youtube.com/results?search_query=ai+search+monitoring',
  datetime: '2026-10-27 22:15:02 +00:00',
  se_results_count: 214,
  items_count: 3,
  items: [
    {
      type: 'youtube_video',
      rank_group: 1,
      rank_absolute: 1,
      block_rank: 1,
      block_name: null,
      title: 'How to track your brand in ChatGPT',
      url: 'https://www.youtube.com/watch?v=abc123',
      thumbnail_url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      channel_id: 'UC1',
      channel_name: 'Search Lab',
      channel_url: 'https://www.youtube.com/@searchlab',
      channel_logo: null,
      description: 'A walkthrough',
      highlighted: ['track'],
      badges: ['New'],
      is_live: false,
      is_movie: null,
      views_count: 310000,
      publication_date: '2 months ago',
      timestamp: '2026-08-20 10:00:00 +00:00',
      video_id: 'abc123',
      duration_time: '12:04',
      duration_time_seconds: 724,
      is_shorts: false,
    },
    {
      type: 'youtube_channel',
      rank_group: 1,
      rank_absolute: 2,
      block_rank: 1,
      block_name: null,
      channel_id: 'UC2',
      name: 'AI Monitor',
      video_count: 0,
      is_verified: true,
    },
    {
      type: 'youtube_video',
      rank_group: 2,
      rank_absolute: 3,
      block_rank: 2,
      block_name: null,
      title: 'AI visibility tools compared',
      url: 'https://www.youtube.com/watch?v=def456',
      channel_name: 'Growth Notes',
      views_count: 1490000,
      publication_date: '5 months ago',
      timestamp: '2026-05-11 08:00:00 +00:00',
      video_id: 'def456',
      is_shorts: false,
    },
  ],
};

// ─── Fixtures ───────────────────────────────────────────────────────────────

const prompt = (id, brandId, text, isActive = true) => ({
  id,
  text,
  is_active: isActive,
  prompt_sets: { brand_id: brandId },
});

const volume = (promptId, googleVolumes, extra = {}) => ({
  prompt_id: promptId,
  google_volumes: googleVolumes,
  location_code: 2840,
  language_code: 'en',
  fetched_at: daysAgo(20),
  ...extra,
});

beforeEach(() => {
  tables = {
    brands: [
      { id: 'b1', organization_id: 'o1', gsc_property: 'sc-domain:ansvisor.com', is_active: true },
    ],
    prompts: [
      prompt('p1', 'b1', 'What is the best AI search monitoring tool?'),
      prompt('p2', 'b1', 'How do I track my brand in ChatGPT answers?'),
      prompt('p3', 'b1', 'Paused prompt about pricing', false),
    ],
    prompt_demand: [],
    prompt_volumes: [],
    gsc: {
      b1: [
        { query: 'ai search monitoring tool', clicks: 60, impressions: 2400 },
        { query: 'best ai search monitoring', clicks: 36, impressions: 1720 },
        { query: 'track brand chatgpt', clicks: 4, impressions: 90 },
        { query: 'ansvisor login', clicks: 300, impressions: 900 },
      ],
    },
  };
  writes = [];
  rpcCalls = [];
  endedOrgs = new Set();
  endedBrands = new Set();
  postTasks.mockReset();
  readyTaskIds.mockReset();
  getTask.mockReset();
  rescoreBrandActions.mockReset().mockResolvedValue(3);
  vi.stubEnv('DEMAND_SIGNALS', 'false');
});

afterEach(() => vi.unstubAllEnvs());

const demandRow = (promptId) => tables.prompt_demand.find((r) => r.prompt_id === promptId);

// ─── Search Console ─────────────────────────────────────────────────────────

describe('gscDemand', () => {
  const prompts = [
    { id: 'p1', text: 'What is the best AI search monitoring tool?' },
    { id: 'p2', text: 'How do I track my brand in ChatGPT answers?' },
  ];

  it("sums each prompt's matching queries over the window, the most seen as its example", () => {
    const demand = gscDemand(tables.gsc.b1, prompts, AT);
    expect(demand.get('p1')).toEqual({
      impressions: 4120,
      clicks: 96,
      queries: 2,
      top: { query: 'ai search monitoring tool', impressions: 2400, clicks: 60 },
      at: AT,
    });
    expect(demand.get('p2')).toEqual({
      impressions: 90,
      clicks: 4,
      queries: 1,
      top: { query: 'track brand chatgpt', impressions: 90, clicks: 4 },
      at: AT,
    });
  });

  it('gives a query to the closest prompt only, and a prompt nothing matches zeros', () => {
    const demand = gscDemand(
      [{ query: 'monitoring tool', clicks: 1, impressions: 10 }],
      [
        { id: 'a', text: 'best monitoring tool' },
        { id: 'b', text: 'monitoring dashboards for teams' },
      ],
      AT,
    );
    expect(demand.get('a').queries).toBe(1);
    expect(demand.get('b')).toEqual({ impressions: 0, clicks: 0, queries: 0, top: null, at: AT });
  });

  it('reads nothing (null) when the brand has no query in the window', () => {
    expect(gscDemand([], prompts, AT)).toBeNull();
  });
});

// ─── The level ──────────────────────────────────────────────────────────────

describe('demandLevel', () => {
  const strong = {
    gsc: { impressions: 4120 },
    trends: { trend: 'rising' },
    paa: { questions: [1, 2, 3, 4].map((n) => ({ question: `q${n}` })) },
    youtube: { views: 1_800_000 },
  };

  it('is high with every signal strong, and counts the signals read', () => {
    expect(demandLevel(strong)).toEqual({ level: 'high', signals: 4 });
  });

  it('has no level with nothing read', () => {
    expect(demandLevel({ gsc: null, trends: null, paa: null, youtube: null })).toEqual({
      level: null,
      signals: 0,
    });
  });

  it('is at most medium on one signal, however strong', () => {
    expect(demandLevel({ gsc: { impressions: 50_000 } })).toEqual({ level: 'medium', signals: 1 });
  });

  it('counts a read that found nothing as read, and as low', () => {
    expect(
      demandLevel({
        gsc: { impressions: 20 },
        trends: { trend: null },
        paa: { questions: [] },
        youtube: { views: 300 },
      }),
    ).toEqual({ level: 'low', signals: 4 });
  });

  it('follows the rule at its edges', () => {
    // 3 of 6 points (0.5): medium.
    expect(
      demandLevel({
        gsc: { impressions: LEVEL_RULE.gscImpressions.strong },
        trends: { trend: 'steady' },
        paa: { questions: [] },
      }).level,
    ).toBe('medium');
    // 6 of 8 points (0.75): high.
    expect(
      demandLevel({
        gsc: { impressions: LEVEL_RULE.gscImpressions.strong },
        trends: { trend: 'steady' },
        paa: { questions: [{}, {}, {}, {}] },
        youtube: { views: LEVEL_RULE.youtubeViews.some },
      }).level,
    ).toBe('high');
    // 1 of 4 points (0.25): low.
    expect(
      demandLevel({
        gsc: { impressions: LEVEL_RULE.gscImpressions.some },
        trends: { trend: 'falling' },
      }).level,
    ).toBe('low');
  });
});

// ─── The keyword ────────────────────────────────────────────────────────────

describe('topKeyword', () => {
  it("takes the analysis's keyword with the most searches, with its location and language", () => {
    expect(
      topKeyword(volume('p1', { 'ai monitoring': 320, 'ai search monitoring': 1900, geo: 0 })),
    ).toEqual({ keyword: 'ai search monitoring', locationCode: 2840, languageCode: 'en' });
  });

  it('has none without an analysis or a keyword Google has searches for', () => {
    expect(topKeyword(null)).toBeNull();
    expect(topKeyword(volume('p1', { 'ai monitoring': 0 }))).toBeNull();
  });

  it("reads Trends' refused characters as spaces", () => {
    expect(trendsKeyword('ai-search "monitoring": tools')).toBe('ai search monitoring tools');
    expect(trendsKeyword('x'.repeat(101))).toBeNull();
  });
});

// ─── Reading the results ────────────────────────────────────────────────────

describe('trendsSignal', () => {
  it('reads a rising year and its change on a year ago', () => {
    const values = Array.from({ length: 52 }, (_, i) => (i < 4 ? 25 : i >= 48 ? 41 : 30));
    const signal = trendsSignal(trendsResult(values), AT);
    expect(signal).toMatchObject({ trend: 'rising', change: 64, from: '2025-10-26', at: AT });
    expect(signal.points).toHaveLength(52);
  });

  it('reads falling and steady years', () => {
    const falling = Array.from({ length: 52 }, (_, i) => (i < 4 ? 80 : 40));
    expect(trendsSignal(trendsResult(falling), AT)).toMatchObject({
      trend: 'falling',
      change: -50,
    });
    const steady = Array.from({ length: 52 }, () => 50);
    expect(trendsSignal(trendsResult(steady), AT)).toMatchObject({ trend: 'steady', change: 0 });
  });

  it('says too little data when Google has no interest, and skips missing weeks', () => {
    const result = trendsResult([0, 0, 0]);
    result.items[0].data[1].missing_data = true;
    expect(trendsSignal(result, AT)).toMatchObject({ points: [0, 0], trend: null, change: null });
    expect(trendsSignal(null, AT)).toMatchObject({ points: [], trend: null });
  });
});

describe('paaSignal', () => {
  it('reads each question once, with the page Google answers it with', () => {
    expect(paaSignal(SERP_RESULT, AT)).toEqual({
      questions: [
        {
          question: 'How do I track my brand in ChatGPT?',
          url: 'https://www.example.org/track-brand-chatgpt',
          domain: 'www.example.org',
        },
        { question: 'What is AI search monitoring?', url: null, domain: null },
        { question: 'Is there a tool to monitor AI answers?', url: null, domain: null },
      ],
      at: AT,
    });
  });

  it('reads no question from a page without the block, or no result', () => {
    expect(paaSignal({ items: [SERP_RESULT.items[0]] }, AT)).toEqual({ questions: [], at: AT });
    expect(paaSignal(null, AT)).toEqual({ questions: [], at: AT });
  });
});

describe('youtubeSignal', () => {
  it("sums the videos' views, keeps the most viewed and YouTube's result count", () => {
    expect(youtubeSignal(YOUTUBE_RESULT, AT)).toEqual({
      videos: 2,
      views: 1_800_000,
      results: 214,
      top: {
        title: 'AI visibility tools compared',
        url: 'https://www.youtube.com/watch?v=def456',
        channel: 'Growth Notes',
        views: 1_490_000,
        published: '2026-05-11 08:00:00 +00:00',
      },
      at: AT,
    });
  });
});

describe('the tasks asked', () => {
  const asked = {
    keyword: 'ai search monitoring',
    locationCode: null,
    languageCode: null,
    tag: 'p1',
  };

  it('asks Trends for 12 months worldwide without a location, and SERP for the US', () => {
    expect(SOURCES.trends.task(asked)).toEqual({
      keywords: ['ai search monitoring'],
      language_code: 'en',
      type: 'web',
      time_range: 'past_12_months',
      item_types: ['google_trends_graph'],
      tag: 'p1',
    });
    expect(SOURCES.paa.task(asked)).toMatchObject({ location_code: 2840, language_code: 'en' });
    expect(SOURCES.youtube.task({ ...asked, locationCode: 2792, languageCode: 'tr' })).toEqual({
      keyword: 'ai search monitoring',
      location_code: 2792,
      language_code: 'tr',
      block_depth: 20,
      tag: 'p1',
    });
  });
});

// ─── The weekly cache and the nightly cap ───────────────────────────────────

describe('isDue and pickDue', () => {
  const keyword = { keyword: 'ai search monitoring' };

  it('sets a prompt again a week after it was set, at once for a new keyword, never while waiting', () => {
    expect(isDue(undefined, keyword, NOW)).toBe(true);
    const row = { keyword: 'ai search monitoring', tasks: null, posted_at: daysAgo(3) };
    expect(isDue(row, keyword, NOW)).toBe(false);
    expect(isDue({ ...row, posted_at: daysAgo(REFRESH_DAYS) }, keyword, NOW)).toBe(true);
    expect(isDue({ ...row, keyword: 'ai monitoring' }, keyword, NOW)).toBe(true);
    expect(isDue({ ...row, posted_at: daysAgo(9), tasks: { trends: 't1' } }, keyword, NOW)).toBe(
      false,
    );
  });

  it(`takes at most ${NIGHTLY_LIMIT} a night, the never read first, then the longest waiting`, () => {
    const candidates = Array.from({ length: 600 }, (_, i) => ({
      promptId: `p${i}`,
      postedAt: i % 2 ? daysAgo(8 + (i % 30)) : null,
    }));
    const picked = pickDue(candidates);
    expect(picked).toHaveLength(NIGHTLY_LIMIT);
    expect(picked.slice(0, 300).every((c) => c.postedAt === null)).toBe(true);
    const dated = picked.slice(300).map((c) => Date.parse(c.postedAt));
    expect(dated).toEqual([...dated].sort((a, b) => a - b));
  });
});

// ─── The sweep ──────────────────────────────────────────────────────────────

describe('sweepPromptDemand', () => {
  it('with DEMAND_SIGNALS off, writes Search Console and the level, and sets no paid task', async () => {
    tables.prompt_volumes = [volume('p1', { 'ai search monitoring': 1900 })];
    const outcome = await sweepPromptDemand({ now: NOW });

    expect(outcome).toMatchObject({ brands: 1, written: 2, posted: 0, paid: false });
    expect(postTasks).not.toHaveBeenCalled();
    expect(readyTaskIds).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([
      {
        name: 'prompt_demand_gsc_queries',
        args: { p_brand_id: 'b1', p_from: '2026-10-01', p_to: '2026-10-28', p_limit: 5000 },
      },
    ]);
    expect(demandRow('p1')).toMatchObject({
      brand_id: 'b1',
      gsc: { impressions: 4120, clicks: 96, queries: 2 },
      level: 'medium',
      signals: 1,
    });
    // The paused prompt isn't read.
    expect(demandRow('p3')).toBeUndefined();
  });

  it('makes no row for a brand without Search Console and nothing else read', async () => {
    tables.brands[0].gsc_property = null;
    const outcome = await sweepPromptDemand({ now: NOW });
    expect(outcome.written).toBe(0);
    expect(rpcCalls).toEqual([]);
    expect(tables.prompt_demand).toEqual([]);
  });

  it("clears a brand's Search Console once its property is gone", async () => {
    tables.brands[0].gsc_property = null;
    tables.prompt_demand = [
      {
        prompt_id: 'p1',
        brand_id: 'b1',
        gsc: { impressions: 900, clicks: 9, queries: 1, top: null, at: daysAgo(1) },
        trends: { trend: 'rising', points: [1], change: 30, at: daysAgo(2) },
        level: 'high',
        signals: 2,
        tasks: null,
        posted_at: daysAgo(2),
        keyword: 'ai search monitoring',
      },
    ];
    await sweepPromptDemand({ now: NOW });
    expect(demandRow('p1')).toMatchObject({ gsc: null, level: 'medium', signals: 1 });
  });

  it('with DEMAND_SIGNALS on, sets the three tasks for each prompt with a measured keyword', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    tables.prompt_volumes = [volume('p1', { 'ai search monitoring': 1900, 'ai monitoring': 300 })];
    // p2 was analysed, and Google has no searches for its keywords.
    tables.prompt_volumes.push(volume('p2', { 'track brand chatgpt answers': 0 }));
    postTasks.mockImplementation(
      async (path, tasks) => new Map(tasks.map((t) => [t.tag, `${path}#${t.tag}`])),
    );

    const outcome = await sweepPromptDemand({ now: NOW });

    expect(outcome).toMatchObject({ paid: true, posted: 1 });
    expect(postTasks).toHaveBeenCalledTimes(3);
    expect(postTasks.mock.calls.map(([path]) => path)).toEqual([
      '/v3/keywords_data/google_trends/explore',
      '/v3/serp/google/organic',
      '/v3/serp/youtube/organic',
    ]);
    expect(postTasks.mock.calls[1][1]).toEqual([
      {
        keyword: 'ai search monitoring',
        location_code: 2840,
        language_code: 'en',
        device: 'desktop',
        depth: 10,
        tag: 'p1',
      },
    ]);
    expect(demandRow('p1')).toMatchObject({
      keyword: 'ai search monitoring',
      location_code: 2840,
      language_code: 'en',
      posted_at: AT,
      tasks: {
        posted_at: AT,
        trends: '/v3/keywords_data/google_trends/explore#p1',
        paa: '/v3/serp/google/organic#p1',
        youtube: '/v3/serp/youtube/organic#p1',
      },
    });
    expect(demandRow('p2')?.tasks ?? null).toBeNull();
  });

  it('does not set a prompt read this week again, nor one whose tasks are waiting', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    readyTaskIds.mockResolvedValue(new Set());
    tables.prompt_volumes = [
      volume('p1', { 'ai search monitoring': 1900 }),
      volume('p2', { 'track brand chatgpt': 500 }),
    ];
    tables.prompt_demand = [
      {
        prompt_id: 'p1',
        brand_id: 'b1',
        keyword: 'ai search monitoring',
        posted_at: daysAgo(3),
        tasks: null,
        signals: 0,
        level: null,
        gsc: null,
      },
      {
        prompt_id: 'p2',
        brand_id: 'b1',
        keyword: 'track brand chatgpt',
        posted_at: daysAgo(1),
        tasks: { posted_at: daysAgo(1), trends: 't-p2', paa: null, youtube: null },
        signals: 0,
        level: null,
        gsc: null,
      },
    ];
    await sweepPromptDemand({ now: NOW });
    expect(postTasks).not.toHaveBeenCalled();
  });

  it('sets at most the limit a night, the longest waiting first', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    readyTaskIds.mockResolvedValue(new Set());
    tables.prompts = Array.from({ length: 5 }, (_, i) => prompt(`p${i}`, 'b1', `prompt ${i}`));
    tables.prompt_volumes = tables.prompts.map((p) => volume(p.id, { [`keyword ${p.id}`]: 100 }));
    tables.prompt_demand = tables.prompts.map((p, i) => ({
      prompt_id: p.id,
      brand_id: 'b1',
      keyword: `keyword ${p.id}`,
      posted_at: daysAgo(8 + i),
      tasks: null,
      signals: 0,
      level: null,
      gsc: null,
    }));
    postTasks.mockImplementation(async (_path, tasks) => new Map(tasks.map((t) => [t.tag, 'id'])));

    const outcome = await sweepPromptDemand({ now: NOW, limit: 2 });

    expect(outcome.posted).toBe(2);
    expect(postTasks.mock.calls[0][1].map((t) => t.tag)).toEqual(['p4', 'p3']);
  });

  it('skips a workspace whose plan has ended: nothing matched, set or read for it', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    endedOrgs.add('o1');
    endedBrands.add('b1');
    tables.prompt_volumes = [volume('p1', { 'ai search monitoring': 1900 })];
    tables.prompt_demand = [
      {
        prompt_id: 'p2',
        brand_id: 'b1',
        tasks: { posted_at: daysAgo(1), trends: 't-p2', paa: null, youtube: null },
      },
    ];
    readyTaskIds.mockResolvedValue(new Set(['t-p2']));

    const outcome = await sweepPromptDemand({ now: NOW });

    expect(outcome).toMatchObject({ brands: 0, skipped: 1, posted: 0, read: 0 });
    expect(rpcCalls).toEqual([]);
    expect(postTasks).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

// ─── Reading the tasks ──────────────────────────────────────────────────────

describe('collectDemandTasks', () => {
  const waiting = (tasks, extra = {}) => ({
    prompt_id: 'p1',
    brand_id: 'b1',
    gsc: { impressions: 4120, clicks: 96, queries: 7, top: null, at: daysAgo(1) },
    trends: null,
    paa: null,
    youtube: null,
    tasks,
    level: 'medium',
    signals: 1,
    ...extra,
  });

  it('does nothing with DEMAND_SIGNALS off', async () => {
    tables.prompt_demand = [waiting({ posted_at: daysAgo(1), trends: 't1' })];
    expect(await collectDemandTasks({ now: NOW })).toEqual({
      read: 0,
      waiting: 0,
      brands: [],
      skipped: 'off',
    });
    expect(readyTaskIds).not.toHaveBeenCalled();
  });

  it('reads the tasks that are done, keeps the level, and clears what was read', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    tables.prompt_demand = [
      waiting({ posted_at: daysAgo(1), trends: 't1', paa: 's1', youtube: 'y1' }),
    ];
    readyTaskIds.mockImplementation(async (path) =>
      path.includes('youtube') ? new Set() : new Set(['t1', 's1']),
    );
    const rising = Array.from({ length: 52 }, (_, i) => (i < 4 ? 25 : i >= 48 ? 41 : 30));
    getTask.mockImplementation(async (path) => {
      if (path === '/v3/keywords_data/google_trends/explore/task_get/t1') {
        return { status: 'done', result: trendsResult(rising) };
      }
      if (path === '/v3/serp/google/organic/task_get/advanced/s1') {
        return { status: 'done', result: SERP_RESULT };
      }
      throw new Error(`unexpected ${path}`);
    });

    // The level went from medium to high: the brand's actions are scored again.
    expect(await collectDemandTasks({ now: NOW })).toEqual({ read: 1, waiting: 1, brands: ['b1'] });

    const row = demandRow('p1');
    expect(row.trends).toMatchObject({ trend: 'rising', change: 64, at: AT });
    expect(row.paa.questions).toHaveLength(3);
    expect(row.youtube).toBeNull();
    // YouTube isn't done: its task waits for the next read.
    expect(row.tasks).toEqual({ posted_at: daysAgo(1), trends: null, paa: null, youtube: 'y1' });
    // Search Console 2 + Trends 2 + PAA 1 of 6: high, three signals read.
    expect(row).toMatchObject({ level: 'high', signals: 3 });
  });

  it('gives up a task not done after three days, keeping what was read before', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    const before = { videos: 3, views: 900, results: 3, top: null, at: daysAgo(9) };
    tables.prompt_demand = [
      waiting(
        { posted_at: daysAgo(TASK_EXPIRE_DAYS), trends: null, paa: null, youtube: 'y1' },
        { youtube: before },
      ),
    ];
    readyTaskIds.mockResolvedValue(new Set());
    getTask.mockResolvedValue({ status: 'pending' });

    await collectDemandTasks({ now: NOW });

    expect(getTask).toHaveBeenCalledWith('/v3/serp/youtube/organic/task_get/advanced/y1');
    expect(demandRow('p1')).toMatchObject({ tasks: null, youtube: before });
  });

  it('reads a done search that found nothing as read, with nothing in it', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    tables.prompt_demand = [
      waiting({ posted_at: daysAgo(1), trends: null, paa: 's1', youtube: null }),
    ];
    readyTaskIds.mockResolvedValue(new Set(['s1']));
    getTask.mockResolvedValue({ status: 'done', result: null });

    await collectDemandTasks({ now: NOW });

    expect(demandRow('p1')).toMatchObject({
      paa: { questions: [], at: AT },
      tasks: null,
      signals: 2,
    });
  });
});

describe("the Action Center's priority", () => {
  it("scores a brand's actions again when a level changed, once a night", async () => {
    const outcome = await sweepPromptDemand({ now: NOW });
    expect(outcome.rescored).toBe(3);
    expect(rescoreBrandActions).toHaveBeenCalledTimes(1);
    expect(rescoreBrandActions).toHaveBeenCalledWith('b1', { now: new Date(NOW) });
  });

  it('leaves them when no level changed', async () => {
    await sweepPromptDemand({ now: NOW });
    rescoreBrandActions.mockClear();
    // The same queries the next night: new numbers' dates, the same levels.
    const outcome = await sweepPromptDemand({ now: NOW + DAY });
    expect(outcome.written).toBe(2);
    expect(rescoreBrandActions).not.toHaveBeenCalled();
  });

  it('carries on when the scores cannot be saved', async () => {
    rescoreBrandActions.mockRejectedValue(new Error('timeout'));
    await expect(sweepPromptDemand({ now: NOW })).resolves.toMatchObject({ rescored: 0 });
  });
});

describe('demandResponse', () => {
  it("says what the card needs about the signals that aren't there", () => {
    expect(demandResponse(null, null, { paid: false })).toEqual({
      level: null,
      signals: 0,
      updatedAt: null,
      keyword: null,
      locationCode: null,
      languageCode: null,
      gsc: null,
      trends: null,
      paa: null,
      youtube: null,
      pending: { trends: false, paa: false, youtube: false },
      hasVolume: false,
      hasKeyword: false,
      paidSignals: false,
    });
    expect(
      demandResponse(
        { level: 'high', signals: 2, tasks: { youtube: 'y1' }, updated_at: AT },
        volume('p1', { 'ai search monitoring': 1900 }),
        { paid: true },
      ),
    ).toMatchObject({
      level: 'high',
      keyword: 'ai search monitoring',
      locationCode: 2840,
      pending: { trends: false, paa: false, youtube: true },
      hasVolume: true,
      hasKeyword: true,
      paidSignals: true,
    });
  });
});
