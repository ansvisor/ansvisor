import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * run_agent's row (CHAT-27 phase 2; W4-26): offered only in an agent's run
 * whose Can call names an agent that is on, a card that says what it asks
 * and the most of the AI limit the called run may use, the person's
 * session for the change, and a step that says how it went.
 */

const calls = vi.hoisted(() => ({
  callableAgentsOf: vi.fn(async (): Promise<{ id: string; name: string }[]> => []),
  agentNameOf: vi.fn(async () => 'FAQ writer'),
  callShareOf: vi.fn(async () => 0.07 as number | null),
}));
vi.mock('@/lib/chat/agent-calls', () => calls);
const action = vi.hoisted(() => ({ runAgentFromChat: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/actions/chat-agent-calls', () => action);

const { AGENT_CALL_TOOLS } = await import('./agent-call-tools');
const row = AGENT_CALL_TOOLS[0];
const AGENT = 'abababab-0000-4000-8000-000000000002';

beforeEach(() => vi.clearAllMocks());

describe('run_agent', () => {
  it('is a card in every mode, Growth and up, for Admins and Managers, with no MCP tool', () => {
    expect(row).toMatchObject({
      name: 'run_agent',
      class: 'write',
      defaultPolicy: 'ask',
      maxPolicy: 'ask',
      flags: { alwaysCard: true },
      minRole: 'manager',
      planGate: { minPlan: 'growth' },
      mcpTool: null,
      taintsRun: true,
    });
  });

  it('is offered only in an agent’s run that has an agent to call', async () => {
    expect(await row.offerIn!({ agentRunId: null })).toBe(false);
    expect(calls.callableAgentsOf).not.toHaveBeenCalled();
    expect(await row.offerIn!({ agentRunId: 'run-1' })).toBe(false);
    calls.callableAgentsOf.mockResolvedValueOnce([{ id: AGENT, name: 'FAQ writer' }]);
    expect(await row.offerIn!({ agentRunId: 'run-1' })).toBe(true);
  });

  it('names the agent, what it asks and the most it may use on its card', async () => {
    const input = { agent: AGENT, ask: 'Draft the FAQ for /pricing' };
    const run = { organizationId: 'o1' };
    expect(await row.target!(input, run)).toBe('FAQ writer');
    // Read within the run's workspace.
    expect(calls.agentNameOf).toHaveBeenCalledWith(AGENT, 'o1');
    expect(calls.callShareOf).not.toHaveBeenCalled();
    expect(await row.cardDetails!(input, run)).toEqual({
      why: 'Draft the FAQ for /pricing',
      targets: [{ kind: 'aiUse', values: ['Up to 7% of the monthly AI limit'] }],
    });
    calls.callShareOf.mockResolvedValueOnce(null);
    expect(await row.cardDetails!(input, run)).toEqual({ why: 'Draft the FAQ for /pricing' });
    expect(calls.callShareOf).toHaveBeenCalledWith(AGENT, 'o1');
  });

  it('runs through the person’s session, from the caller’s chat run', async () => {
    await row.run(
      {
        userId: 'u1',
        organizationId: 'o1',
        chat: { runId: 'r-caller' },
      } as unknown as Parameters<typeof row.run>[0],
      { agent: AGENT, ask: 'x' },
    );
    expect(action.runAgentFromChat).toHaveBeenCalledWith(
      { agent: AGENT, ask: 'x' },
      { userId: 'u1', organizationId: 'o1', callerChatRunId: 'r-caller' },
    );
  });

  it('says how the called agent’s run went, and its share', () => {
    const input = { agent: AGENT, ask: 'x' };
    expect(
      row.doneStep!(input, { ok: true, agent: 'FAQ writer', status: 'done', used_share: 0.034 }),
    ).toEqual({ label: 'Ran FAQ writer', detail: 'Done · 3.4% of the monthly AI limit' });
    expect(
      row.doneStep!(input, { ok: true, agent: 'FAQ writer', status: 'timed_out', used_share: 0 }),
    ).toEqual({
      label: 'Ran FAQ writer',
      detail: 'Stopped after 4 minutes · 0% of the monthly AI limit',
    });
    expect(row.doneStep!(input, { ok: false, reason: 'not_found' })).toBeNull();
  });
});
