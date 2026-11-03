import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { agentRows, agents, hideDemoAgents } = await import('./agents.js');

/**
 * The demo brand's Agent Center (demo Agent Center): agents made from the
 * ready-to-use ones, marked with the demo brand (00475), with their run
 * history and each run's chat; one run waits on its owner's OK.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const ORG_ID = '22222222-3333-4444-8555-666666666666';
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-03T12:00:00Z');
const rows = agentRows({ brandId: BRAND_ID, now: NOW, organizationId: ORG_ID, ownerId: OWNER });
const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

describe('agentRows', () => {
  it('makes four agents of the workspace, marked with the demo brand and scoped to it only', () => {
    expect(rows.agents).toHaveLength(4);
    for (const agent of rows.agents) {
      expect(agent).toMatchObject({
        organization_id: ORG_ID,
        demo_brand_id: BRAND_ID,
        owner_id: OWNER,
        visibility: 'workspace',
        version: 1,
        fail_count: 0,
      });
      // A made-up brand's name: never one a person's own agent has (names are unique, 00419).
      expect(agent.name).toMatch(/^Brewline /);
    }
    expect(new Set(rows.agents.map((a) => a.name.toLowerCase())).size).toBe(4);
    expect(rows.agents.map((a) => a.status)).toEqual(['active', 'active', 'active', 'paused']);
    expect(rows.agents[3].paused_reason).toBe('manual');
    for (const version of rows.versions) {
      expect(version.scope).toEqual({ brand_ids: [BRAND_ID] });
      expect(version.skill_ids.length).toBeGreaterThan(0);
    }
  });

  it('runs each schedule at its own slots, before now', () => {
    for (const trigger of rows.triggers.filter((t) => t.kind === 'schedule')) {
      const rule = trigger.config_json.rrule;
      const days = rule
        .match(/BYDAY=([A-Z,]+)/)[1]
        .split(',')
        .map((d) => DAYS[d]);
      const hour = Number(rule.match(/BYHOUR=(\d+)/)[1]);
      const fired = rows.runs.filter((r) => r.trigger_id === trigger.id);
      expect(fired.length).toBeGreaterThan(0);
      for (const run of fired) {
        const at = new Date(run.queued_at);
        expect(days).toContain(at.getUTCDay());
        expect(at.getUTCHours()).toBe(hour);
        expect(at.getTime()).toBeLessThan(NOW.getTime());
      }
      expect(trigger.last_fired_at).toBe(
        new Date(Math.max(...fired.map((r) => Date.parse(r.queued_at)))).toISOString(),
      );
    }
  });

  it('keeps every run on the demo brand, each with its owner’s chat', () => {
    expect(rows.runs.length).toBeGreaterThan(6);
    for (const run of rows.runs) {
      expect(run).toMatchObject({
        brand_id: BRAND_ID,
        acting_user_id: OWNER,
        organization_id: ORG_ID,
      });
      // Nothing for the impact ledger or the daily suggestions to pick up.
      expect(run.action_id).toBeUndefined();
      expect(run.outcome).not.toBe('pending');
      const chat = rows.chats.conversations.find((c) => c.agent_run_id === run.id);
      expect(chat).toMatchObject({ origin: 'agent', user_id: OWNER, brand_id: BRAND_ID });
    }
    for (const a of rows.chats.messages.filter((m) => m.role === 'assistant')) {
      expect(a.content_md).not.toMatch(/undefined|NaN/);
    }
  });

  it('leaves the last day’s results as Inbox news, the older runs read', () => {
    for (const run of rows.runs.filter((r) => r.status === 'done')) {
      const chat = rows.chats.conversations.find((c) => c.agent_run_id === run.id);
      const recent = NOW.getTime() - Date.parse(run.queued_at) <= 24 * 60 * 60 * 1000;
      expect(chat.last_read_at === undefined, run.queued_at).toBe(recent);
    }
  });

  it('has one run waiting on its owner’s OK, as the page rebuilds one under way', () => {
    const waiting = rows.runs.filter((r) => r.status === 'needs_you');
    expect(waiting).toHaveLength(1);
    expect(waiting[0].finished_at).toBeNull();
    const chat = rows.chats.conversations.find((c) => c.agent_run_id === waiting[0].id);
    const [chatRun] = rows.chats.runs.filter((r) => r.conversation_id === chat.id);
    expect(chatRun).toMatchObject({ status: 'waiting', finished_at: null });
    const events = rows.chats.events.filter((e) => e.run_id === chatRun.id);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.at(-1)).toMatchObject({ type: 'confirm.required' });
    expect(events.at(-1).data).toMatchObject({ n: 2, action: 'Save a draft in Content' });
    const steps = rows.chats.steps.filter((s) => s.run_id === chatRun.id);
    expect(steps.at(-1)).toMatchObject({ kind: 'write', status: 'waiting', finished_at: null });
    // Its run state says whose it is (the events route reads it), with no
    // waiting_since: the engine's sweep never stops it.
    expect(rows.chats.states).toEqual([
      expect.objectContaining({
        run_id: chatRun.id,
        user_id: OWNER,
        organization_id: ORG_ID,
        waiting_since: null,
        last_seq: events.length,
      }),
    ]);
    // News in the Inbox until opened: no last_read_at.
    expect(chat.last_read_at).toBeUndefined();
    // Every other run ended, its end kept as a reload reads it.
    for (const run of rows.chats.runs.filter((r) => r !== chatRun)) {
      expect(run.status).toBe('done');
      expect(rows.chats.events.find((e) => e.run_id === run.id).type).toBe('run.finished');
    }
  });
});

/** A client over `tables`, enough for build's reads, writes and deletes. */
function fakeDb(tables) {
  const log = [];
  const from = (table) => {
    const q = { filters: [], op: 'select', payload: null };
    const run = () => {
      if (q.op === 'upsert') {
        log.push(`write ${table}`);
        (tables[table] ??= []).push(...q.payload);
        return { data: null, error: null };
      }
      const hit = (tables[table] ?? []).filter((r) => q.filters.every(([c, v]) => r[c] === v));
      if (q.op === 'delete') {
        log.push(`delete ${table}`);
        tables[table] = (tables[table] ?? []).filter((r) => !hit.includes(r));
        return { data: null, error: null };
      }
      return { data: hit, error: null };
    };
    const chain = {
      select: () => chain,
      upsert: (payload) => ((q.op = 'upsert'), (q.payload = payload), chain),
      delete: () => ((q.op = 'delete'), chain),
      eq: (c, v) => (q.filters.push([c, v]), chain),
      order: () => chain,
      limit: () => chain,
      single: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  };
  return { from, log };
}

describe('agents.build', () => {
  it('replaces the demo brand’s old agents, then writes each row after the one it points at', async () => {
    const tables = {
      brands: [{ id: BRAND_ID, organization_id: ORG_ID }],
      profiles: [
        { id: OWNER, organization_id: ORG_ID },
        { id: 'aaaaaaaa-0000-4000-8000-000000000002', organization_id: ORG_ID },
      ],
      chat_agents: [
        { id: 'old-demo', demo_brand_id: BRAND_ID },
        { id: 'someones-own', demo_brand_id: null },
      ],
    };
    const db = fakeDb(tables);
    expect(await agents.build({ brandId: BRAND_ID, now: NOW, db })).toEqual({
      agents: 4,
      runs: rows.runs.length,
    });
    expect(db.log.slice(0, 2)).toEqual(['delete chat_agent_runs', 'delete chat_agents']);
    expect(db.log.slice(2, 3)).toEqual(['write chat_agents']);
    expect(db.log.indexOf('write chat_agent_runs')).toBeGreaterThan(
      db.log.indexOf('write chat_agent_triggers'),
    );
    expect(db.log.indexOf('write chat_conversations')).toBeGreaterThan(
      db.log.indexOf('write chat_agent_runs'),
    );
    expect(db.log.indexOf('write chat_run_state')).toBeGreaterThan(
      db.log.indexOf('write chat_runs'),
    );
    const ids = tables.chat_agents.map((a) => a.id);
    expect(ids).toContain('someones-own');
    expect(ids).not.toContain('old-demo');
    // The workspace's first person owns them.
    expect(
      new Set(tables.chat_agents.filter((a) => a.demo_brand_id).map((a) => a.owner_id)),
    ).toEqual(new Set([OWNER]));
  });

  it('writes nothing for an organization without people', async () => {
    const db = fakeDb({ brands: [{ id: BRAND_ID, organization_id: ORG_ID }], profiles: [] });
    expect(await agents.build({ brandId: BRAND_ID, now: NOW, db })).toEqual({ agents: 0, runs: 0 });
    expect(db.log).toEqual(['delete chat_agent_runs', 'delete chat_agents']);
  });

  it('builds after the chats, whose clear takes its runs’ chats away', () => {
    expect(agents.after).toBe('chat');
    expect(agents.tables).toEqual(['chat_agent_runs']);
  });
});

describe('hideDemoAgents', () => {
  it('deletes the demo brand’s agents and their runs only', async () => {
    const tables = {
      chat_agents: [
        { id: 'a1', demo_brand_id: BRAND_ID },
        { id: 'a2', demo_brand_id: null },
      ],
      // A deleted agent's runs stay (agent_id set null): the waiting one would never settle.
      chat_agent_runs: [
        { id: 'r1', brand_id: BRAND_ID, status: 'needs_you' },
        { id: 'r2', brand_id: 'another-brand', status: 'needs_you' },
      ],
    };
    await hideDemoAgents(fakeDb(tables), BRAND_ID);
    expect(tables.chat_agents.map((a) => a.id)).toEqual(['a2']);
    expect(tables.chat_agent_runs.map((r) => r.id)).toEqual(['r2']);
  });
});
