import { NextResponse } from 'next/server';
import { runFailure, runIdOf } from '@/lib/chat/run-api';
import { isChatStaff } from '@/lib/chat/staff';
import {
  readChatMessageDebug,
  readChatStepOutput,
  type ChatMessageDebug,
} from '@/lib/chat/staff-debug';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/internal/chat/messages/{id}/debug
 *
 * Chat's staff Debug view of an answer (CHAT-03 items 25–26; W1-15): each
 * step's tool, input, output (the first 20 KB), latency and cache hit, and
 * the run's model calls with tokens and cost in USD. `{id}` is the answer's
 * message id, or its run's id (the handle the page has). `?full={n}` gives
 * step n's whole output as a JSON download ("Download full").
 *
 * Ansvisor staff only, checked here on the server (STAFF_EMAILS,
 * lib/chat/staff.ts): anyone else signed in gets 403, a customer's Admin
 * too. Each view is logged with who looked. Not there (404) while the new
 * Chat is off (CHAT_AGENTIC). Refusals as values (#1777), never thrown.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (process.env.CHAT_AGENTIC !== 'true') {
      return runFailure(404, 'not_found', 'not_found', 'Not found');
    }
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return runFailure(401, 'session', 'session', 'Unauthorized');
    if (!isChatStaff(user)) return runFailure(403, 'failed', 'forbidden', 'Forbidden');
    const id = runIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');

    const full = new URL(req.url).searchParams.get('full');
    console.info('[chat/debug] staff view', {
      staffUserId: user.id,
      id,
      ...(full ? { full } : {}),
    });

    if (full !== null) {
      const n = Number(full);
      const output = Number.isInteger(n) && n > 0 ? await readChatStepOutput(id, n) : null;
      if (output === null) return runFailure(404, 'not_found', 'not_found', 'Not found');
      return new Response(output, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="step-${n}-output.json"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const debug = await readChatMessageDebug(id);
    if (!debug) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json<{ ok: true; debug: ChatMessageDebug }>(
      { ok: true, debug },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[chat/debug] could not read the debug record:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the debug record');
  }
}
