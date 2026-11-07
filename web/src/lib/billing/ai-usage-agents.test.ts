import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { AiUsage } from './ai-usage';
import { aiUseByAgent, nameAgents, topAgent } from './ai-usage-agents';

/**
 * Billing's By agent list and the meter's Top agent line (CHAT-27 items
 * 27–28): the API's shares by agent id, named with the person's own session.
 */

type Agent = NonNullable<AiUsage['byAgent']>['agents'][number];

const usage = (agents: Agent[], over: Partial<AiUsage> = {}): AiUsage => ({
  plan: 'growth',
  planName: 'Growth',
  periodStart: '2026-10-20T09:00:00.000Z',
  periodEnd: '2026-11-20T09:00:00.000Z',
  unlimited: false,
  percentUsed: 60,
  features: [
    { feature: 'improve', percent: 2 },
    { feature: 'content', percent: 10 },
    { feature: 'agent', percent: 40 },
    { feature: 'chat', percent: 8 },
  ],
  chatMetered: true,
  byAgent: { agents, chat: 6.5 },
  ...over,
});

const named = (agentId: string, percent: number): Agent => ({
  agentId,
  percent,
  name: `Agent ${agentId}`,
});

describe('aiUseByAgent', () => {
  it('lists the agents highest first, then Chat outside them and the features that used some', () => {
    const rows = aiUseByAgent(
      usage([named('a', 1.2), { agentId: null, percent: 3 }, named('b', 12), named('c', 0)]),
    );
    expect(rows).toEqual([
      { kind: 'agent', agentId: 'b', name: 'Agent b', percent: 12 },
      // The deleted agents' runs, together.
      { kind: 'deleted', percent: 3 },
      { kind: 'agent', agentId: 'a', name: 'Agent a', percent: 1.2 },
      // A sliver: listed, for the page to read as "<0.1%".
      { kind: 'agent', agentId: 'c', name: 'Agent c', percent: 0 },
      { kind: 'chat', percent: 6.5 },
      { kind: 'feature', feature: 'content', percent: 10 },
      // The Action Center used none: no row.
      { kind: 'feature', feature: 'improve', percent: 2 },
    ]);
  });

  it('names the top 5, and puts the rest and those the person may not see in Other agents', () => {
    const listed = aiUseByAgent(
      usage([
        named('a', 9),
        named('b', 8),
        // Not theirs to see: no name came back.
        { agentId: 'hidden', percent: 7.1 },
        named('c', 6),
        named('d', 5),
        named('e', 4),
        named('f', 3.2),
        named('g', 0.1),
      ]),
    )!;
    expect(
      listed.filter((r) => r.kind === 'agent').map((r) => r.kind === 'agent' && r.name),
    ).toEqual(['Agent a', 'Agent b', 'Agent c', 'Agent d', 'Agent e']);
    expect(listed[5]).toEqual({ kind: 'otherAgents', percent: 10.4 });
    expect(JSON.stringify(listed)).not.toContain('hidden');
  });

  it('is empty when no agent used any, and has no list in the trial or with Chat off', () => {
    expect(aiUseByAgent(usage([]))).toEqual([]);
    expect(aiUseByAgent(usage([named('a', 4)], { trial: true }))).toBeNull();
    expect(aiUseByAgent(usage([named('a', 4)], { byAgent: undefined }))).toBeNull();
  });
});

describe('topAgent', () => {
  it('is the named agent that used the most, past the deleted ones', () => {
    expect(
      topAgent(usage([{ agentId: null, percent: 20 }, named('b', 12), named('a', 3)])),
    ).toEqual({ name: 'Agent b', percent: 12 });
  });

  it('is null when no agent the person may see used any', () => {
    expect(topAgent(usage([]))).toBeNull();
    expect(
      topAgent(
        usage([
          { agentId: 'hidden', percent: 5 },
          { agentId: null, percent: 1 },
        ]),
      ),
    ).toBeNull();
    expect(topAgent(usage([named('a', 4)], { byAgent: undefined }))).toBeNull();
  });
});

describe('nameAgents', () => {
  const client = (answer: { data: unknown; error: unknown }) => {
    const inIds = vi.fn(async () => answer);
    const select = vi.fn(() => ({ in: inIds }));
    const from = vi.fn(() => ({ select }));
    return { supabase: { from } as unknown as SupabaseClient<Database>, from, select, inIds };
  };

  it('names the agents the person may see, with their own session', async () => {
    const { supabase, from, select, inIds } = client({
      data: [{ id: 'a', name: 'Weekly report' }],
      error: null,
    });
    const read = usage([
      { agentId: 'a', percent: 12 },
      { agentId: 'hidden', percent: 3 },
      { agentId: null, percent: 1 },
    ]);
    const named = await nameAgents(supabase, read);
    expect(from).toHaveBeenCalledWith('chat_agents');
    expect(select).toHaveBeenCalledWith('id, name');
    expect(inIds).toHaveBeenCalledWith('id', ['a', 'hidden']);
    expect(named.byAgent!.agents).toEqual([
      { agentId: 'a', percent: 12, name: 'Weekly report' },
      { agentId: 'hidden', percent: 3 },
      { agentId: null, percent: 1 },
    ]);
  });

  it('reads nothing without an agent to name, and names none when the read fails', async () => {
    const none = client({ data: [], error: null });
    const empty = usage([{ agentId: null, percent: 2 }]);
    expect(await nameAgents(none.supabase, empty)).toBe(empty);
    expect(await nameAgents(none.supabase, usage([], { byAgent: undefined }))).toEqual(
      usage([], { byAgent: undefined }),
    );
    expect(none.from).not.toHaveBeenCalled();

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = client({ data: null, error: { message: 'boom' } });
    const read = usage([{ agentId: 'a', percent: 12 }]);
    expect(await nameAgents(failing.supabase, read)).toBe(read);
  });
});

/**
 * A subtask's steps count for its parent run's agent (CHAT-27 §C): the hold
 * names its row with the chat's agent run, which the part shares with its
 * parent, and the shares read every row of an agent's runs, parts included.
 */
describe('a part’s spend in the database', () => {
  const schema = readFileSync(join(__dirname, '../../../../supabase/schema.sql'), 'utf8');
  const lastBody = (fn: string) => {
    const start = schema.lastIndexOf(`create or replace function public.${fn}(`);
    return schema.slice(start, schema.indexOf('$$;', schema.indexOf('$$', start) + 2));
  };

  it('is held on the chat’s agent run, the parent’s', () => {
    const reserve = lastBody('reserve_chat_ai_usage');
    expect(reserve).toMatch(/select r\.parent_run_id, c\.agent_run_id/);
    expect(reserve).toMatch(/join public\.chat_conversations c on c\.id = r\.conversation_id/);
    expect(reserve).toMatch(/agent_id, agent_run_id, parent_run_id/);
  });

  it('counts in its agent’s share', () => {
    const shares = lastBody('chat_agent_usage_shares');
    expect(shares).toMatch(/group by u\.agent_id/);
    expect(shares).not.toMatch(/parent_run_id/);
  });
});
