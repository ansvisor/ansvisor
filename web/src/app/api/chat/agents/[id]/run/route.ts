import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscription-guard';
import {
  agentContextFor,
  agentIdOf,
  agentRefusalResponse,
  invalidAgentResponse,
  type AgentParams,
} from '@/lib/chat/agent-api';
import { runAgentNow, type RunNowItem } from '@/lib/chat/agent-runs';
import { runNowInput } from '@/lib/chat/agent-rules';
import { chatActor, runFailure } from '@/lib/chat/run-api';

/**
 * POST /api/chat/agents/{id}/run `{ brandId? }`
 *
 * Run now (CHAT-21 §E Manual): a run per brand of the agent's scope, or
 * for the one brand named, queued and acting as the person; started when
 * the workspace has room (§M). A second click within a minute is the
 * first; past 3 waiting, it joins the last. Admins and Managers (a
 * Manager's own private agent, or any workspace agent); never an archived
 * agent. 202 with each brand's run state, never a run's id.
 *
 * Refusals as values (#1777): 400 a bad body or a brand outside its scope,
 * 402 read-only, 403 the out-of-permission answer (CHAT-20 §4c), 404, 409
 * archived or no brand left, 429 the AI limit used up.
 */
export async function POST(req: Request, { params }: AgentParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const id = agentIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const input = runNowInput.safeParse(await req.json().catch(() => ({})));
    if (!input.success) return invalidAgentResponse();
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    const result = await runAgentNow(ctx, id, input.data);
    if (!result.ok) return agentRefusalResponse(result.refusal);
    return NextResponse.json<{ ok: true; runs: RunNowItem[] }>(
      { ok: true, runs: result.value.runs },
      { status: 202 },
    );
  } catch (error) {
    console.error('[chat/agents] could not run an agent:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to run the agent');
  }
}
