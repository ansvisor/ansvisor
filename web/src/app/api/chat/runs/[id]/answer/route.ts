import { NextResponse } from 'next/server';
import { prepareResume } from '@/lib/chat/engine';
import {
  afterSeqOf,
  chatActor,
  engineFailureResponse,
  runFailure,
  runIdOf,
  streamRun,
} from '@/lib/chat/run-api';

export const maxDuration = 300;

/**
 * POST /api/chat/runs/{id}/answer?after={seq}
 *
 * The person's answer to the question card the run waits on (CHAT-07 §A):
 * `{ n, selected, other?, skipped?, via? }`, the card's step and the
 * options picked by place, the text typed in Other… (or the message sent
 * from the composer), or Skip. It is kept on the question once, and the run
 * goes on; its events after `after` stream back as on POST /api/chat/runs.
 * 409 `answered` for a second answer, 409 `not_waiting` when the run no
 * longer waits on that question, 400 for an answer the card doesn't offer,
 * 402 while read-only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const runId = runIdOf((await params).id);
    if (!runId) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const body = await req.json().catch(() => null);
    const prepared = await prepareResume(actor, runId, 'answer', body);
    if (!prepared.ok) return engineFailureResponse(prepared);
    return streamRun(req, actor, runId, { resume: prepared.resume, afterSeq: afterSeqOf(req) });
  } catch (error) {
    console.error('[chat/runs] could not take an answer:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to answer');
  }
}
