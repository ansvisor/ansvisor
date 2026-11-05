import { NextResponse } from 'next/server';
import { agentContextFor, agentIdOf, type AgentParams } from '@/lib/chat/agent-api';
import { readAgentImpact, type AgentImpact } from '@/lib/chat/agent-impact';
import { chatActor, runFailure } from '@/lib/chat/run-api';

/**
 * GET /api/chat/agents/{id}/impact
 *
 * The agent page's "What this agent did": the changes its runs took live in
 * the last 30 days on brands the person may see, each with what the impact
 * ledger measured, Reports' headline over them, and how many drafts its
 * runs made that aren't live (agent-impact.ts). Whoever sees the agent;
 * else 404.
 */
export async function GET(_req: Request, { params }: AgentParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = agentIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    const impact = await readAgentImpact(ctx, id);
    if (!impact) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json<{ ok: true; impact: AgentImpact }>({ ok: true, impact });
  } catch (error) {
    console.error('[chat/agents] could not read what an agent did:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read what the agent did');
  }
}
