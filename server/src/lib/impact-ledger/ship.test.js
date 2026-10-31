import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './__fixtures__/fake-db.js';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { logger } = await import('../logger.js');
const { MAX_TARGET_PROMPTS } = await import('./method.js');
const { recordCmsPublish, resolveTargets } = await import('./ship.js');

/**
 * A page the CMS confirmed live, into the impact ledger (CHAT-22 §2 item
 * 1): its ship event, once per send, and its Pending measurement.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const LIVE = 'https://acme.example/blog/cold-brew';
const PUBLISHED = '2026-10-20T12:00:00.000Z';

const prompt = (id, brand = 'b1') => ({
  id,
  text: `prompt ${id}`,
  topic_id: 'topic-1',
  prompt_sets: { brand_id: brand },
});

function world(overrides = {}) {
  return {
    content_draft_deliveries: [
      {
        id: 'x1',
        organization_id: ORG,
        brand_id: 'b1',
        draft_id: 'dr1',
        sent_by: 'u1',
        title: 'Cold brew guide',
        created_at: '2026-10-20T11:00:00.000Z',
      },
    ],
    content_drafts: [
      {
        id: 'dr1',
        brand_id: 'b1',
        title: 'Cold brew: the guide',
        action_id: null,
        prompt_ids: ['p1', 'p2'],
      },
    ],
    prompts: [prompt('p1'), prompt('p2'), prompt('p3')],
    actions: [],
    ship_events: [],
    impact_measurements: [],
    ...overrides,
  };
}

const record = (db) =>
  recordCmsPublish({ deliveryId: 'x1', url: LIVE, publishedAt: PUBLISHED, db });

beforeEach(() => {
  process.env.CHAT_AGENTIC = 'true';
  delete process.env.CHAT_AGENTIC_ORGS;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.CHAT_AGENTIC;
  delete process.env.CHAT_AGENTIC_ORGS;
});

describe('recordCmsPublish', () => {
  it('writes the publish as a shipped change, with its Pending measurement on the draft’s prompts', async () => {
    const db = fakeDb(world());
    const id = await record(db);
    expect(db.tables.ship_events).toEqual([
      expect.objectContaining({
        id,
        organization_id: ORG,
        brand_id: 'b1',
        kind: 'cms_publish',
        title: 'Cold brew: the guide',
        content_draft_id: 'dr1',
        url: LIVE,
        action_id: null,
        source: 'content_editor',
        change_type: 'content',
        shipped_at: PUBLISHED,
        shipped_by: 'u1',
        execution_mode: 'assisted',
      }),
    ]);
    expect(db.tables.impact_measurements).toEqual([
      expect.objectContaining({
        ship_event_id: id,
        next_check_at: '2026-10-28T00:00:00.000Z',
        targets: [
          { type: 'prompt', id: 'p1', label: 'prompt p1' },
          { type: 'prompt', id: 'p2', label: 'prompt p2' },
          { type: 'url', id: LIVE, label: LIVE },
        ],
      }),
    ]);
  });

  it('measures the action’s frozen targets over the draft’s, and an unsent page as automated', async () => {
    const tables = world();
    tables.content_drafts[0].action_id = 'a1';
    tables.content_draft_deliveries[0].sent_by = null;
    tables.actions = [{ id: 'a1', brand_id: 'b1', payload: { promptIds: ['p3'] } }];
    const db = fakeDb(tables);
    await record(db);
    expect(db.tables.ship_events[0]).toMatchObject({
      action_id: 'a1',
      execution_mode: 'automated',
      shipped_by: null,
    });
    expect(db.tables.impact_measurements[0].targets.map((t) => t.id)).toEqual(['p3', LIVE]);
  });

  it('writes one ship event per send, however often its publish is confirmed', async () => {
    const db = fakeDb(world());
    const first = await record(db);
    expect(await record(db)).toBe(first);
    expect(db.tables.ship_events).toHaveLength(1);
    expect(db.tables.impact_measurements).toHaveLength(1);
  });

  it('reads and writes nothing with CHAT_AGENTIC off', async () => {
    delete process.env.CHAT_AGENTIC;
    const db = fakeDb(world());
    expect(await record(db)).toBeNull();
    expect(db.calls).toEqual([]);
  });

  it('writes nothing for a workspace CHAT_AGENTIC_ORGS doesn’t list', async () => {
    process.env.CHAT_AGENTIC_ORGS = '22222222-2222-2222-2222-222222222222';
    const db = fakeDb(world());
    expect(await record(db)).toBeNull();
    expect(db.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it('never throws: a failed write is logged by code and the page stays published', async () => {
    const db = fakeDb(world());
    db.fail = (table, op) => table === 'ship_events' && op === 'insert';
    expect(await record(db)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: { name: 'ImpactDbError', code: '57014' } },
      '[impact-ledger] cms publish not recorded',
    );
  });

  it('keeps the ship event when its measurement fails: the nightly job seeds it', async () => {
    const db = fakeDb(world());
    db.fail = (table, op) => table === 'impact_measurements' && op === 'upsert';
    expect(await record(db)).toEqual(expect.any(String));
    expect(db.tables.ship_events).toHaveLength(1);
    expect(db.tables.impact_measurements).toHaveLength(0);
  });
});

describe('resolveTargets', () => {
  it('takes only the brand’s own prompts, at most 50, and a topic’s prompts without named ones', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `q${String(i).padStart(2, '0')}`);
    const db = fakeDb({
      actions: [
        { id: 'a1', brand_id: 'b1', payload: { promptIds: [...many, 'theirs'] } },
        { id: 'a2', brand_id: 'b1', payload: { topicId: 'topic-9' } },
      ],
      prompts: [
        ...many.map((id) => prompt(id)),
        prompt('theirs', 'b2'),
        { ...prompt('in-topic'), topic_id: 'topic-9' },
      ],
    });
    const targets = await resolveTargets(db, [
      { id: 's1', brand_id: 'b1', action_id: 'a1' },
      { id: 's2', brand_id: 'b1', action_id: 'a2' },
    ]);
    expect(targets.get('s1')).toHaveLength(MAX_TARGET_PROMPTS);
    expect(targets.get('s1').map((t) => t.id)).not.toContain('theirs');
    expect(targets.get('s2')).toEqual([
      { type: 'prompt', id: 'in-topic', label: 'prompt in-topic' },
    ]);
  });
});
