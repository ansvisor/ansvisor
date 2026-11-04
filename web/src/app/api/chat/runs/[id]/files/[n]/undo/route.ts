import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscription-guard';
import { undoPageVersion } from '@/lib/chat/page-versions';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/run-api';

type Params = { params: Promise<{ id: string; n: string }> };

/**
 * POST /api/chat/runs/{id}/files/{n}/undo
 *
 * A version card's "Undo to version {n−1}" (CHAT-25 §6, W4-12a): the n-th
 * file the run made, a page in the person's own chat, goes back to the page
 * before it, as the editor's History restores it. 401, 402 a read-only
 * workspace (before anything else), 404 a run, file or version that isn't
 * the person's or has no page before it; else { ok: true }.
 */
export async function POST(_req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const { id, n } = await params;
    const runId = runIdOf(id);
    const position = Number.parseInt(n, 10);
    if (!runId || !Number.isInteger(position) || position < 1 || position > 100) {
      return runFailure(404, 'not_found', 'not_found', 'Not found');
    }
    const undone = await undoPageVersion(actor, runId, position);
    if (!undone.ok) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[chat/runs] could not undo a page version:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to put the version back');
  }
}
