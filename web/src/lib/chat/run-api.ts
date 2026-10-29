import { NextResponse, after } from 'next/server';
import type { ApiFailure } from '@/lib/api-failure';
import { SUBSCRIPTION_INACTIVE } from '@/lib/subscription-guard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { driveRun, type ChatActor, type EngineFailure, type ResumeAction } from './engine';
import { STORED_EVENTS } from './engine-store';
import { chatAgenticEnabled } from './flag';
import { sseResponse, tailRunEvents } from './run-hub';

/**
 * What the run routes (/api/chat/runs…) share: who asks, the flag, the
 * answers as values the browser reads (#1777: never a thrown error or an
 * HTML page), and a run's stream. Server only.
 */

/** A refusal as the browser reads it (apiFailure's words), with the engine's code. */
export interface RunApiFailure {
  ok: false;
  failure: ApiFailure;
  code: string;
  error: string;
}

export const runFailure = (status: number, failure: ApiFailure, code: string, error: string) =>
  NextResponse.json<RunApiFailure>({ ok: false, failure, code, error }, { status });

/** The engine's refusal as its answer; read-only is the server's own 402 body (the upgrade dialog). */
export function engineFailureResponse(f: EngineFailure): NextResponse {
  if (f.code === 'subscription_inactive') {
    return NextResponse.json(
      { ok: false, failure: 'subscription', ...SUBSCRIPTION_INACTIVE },
      { status: 402 },
    );
  }
  const failure: ApiFailure = f.status === 404 ? 'not_found' : f.status === 429 ? 'busy' : 'failed';
  return runFailure(f.status, failure, f.code, f.message);
}

/**
 * The signed-in person as a run's actor, or the answer to give: 401 without
 * a session, 404 while the new Chat is off for their workspace (CHAT_AGENTIC).
 */
export async function chatActor(): Promise<ChatActor | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return runFailure(401, 'session', 'session', 'Unauthorized');
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const organizationId = (profile as { organization_id: string | null } | null)?.organization_id;
  if (!organizationId || !chatAgenticEnabled(organizationId)) {
    return runFailure(404, 'not_found', 'not_found', 'Not found');
  }
  return { userId: user.id, email: user.email ?? null, organizationId };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A run id from the path, or null. */
export const runIdOf = (value: string) => (UUID.test(value) ? value : null);

/** Whether the run is this person's, in their workspace (chat_run_state). */
export async function ownsRun(actor: ChatActor, runId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('chat_run_state')
    .select('user_id, organization_id')
    .eq('run_id', runId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { user_id: string; organization_id: string } | null;
  return !!row && row.user_id === actor.userId && row.organization_id === actor.organizationId;
}

/** `?after=` from a request: the last event the browser has; 0 for none. */
export function afterSeqOf(req: Request): number {
  const value = Number(new URL(req.url).searchParams.get('after') ?? 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * Drives a run in the request's background (after(): it goes on when the
 * browser leaves) and answers with its events after `afterSeq`, live, until
 * it waits on the person or ends. The tail listens before the driver starts,
 * so it hears every event.
 */
export function streamRun(
  req: Request,
  actor: ChatActor,
  runId: string,
  options: { headers?: Record<string, string>; resume?: ResumeAction; afterSeq?: number } = {},
): Response {
  const events = tailRunEvents(runId, options.afterSeq ?? 0, STORED_EVENTS, req.signal);
  const driver = driveRun(actor, runId, options.resume);
  after(() => driver);
  return sseResponse(events, options.headers);
}

/** A run's kept and coming events, after `afterSeq`, without driving it: a reconnect. */
export function tailRun(req: Request, runId: string, afterSeq: number): Response {
  return sseResponse(tailRunEvents(runId, afterSeq, STORED_EVENTS, req.signal));
}
