import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/server';
import type { RunActor } from './access';

/**
 * A Chat run's write through the API server for its person (the routes of
 * the server's ACTING_USER_ROUTES, middleware/acting-user.js), when no
 * session of theirs is behind the run (a schedule's or a signal's run,
 * CHAT-12). Their own session's token when the request is theirs; else
 * CHAT_ACTING_SECRET with X-Acting-User: their id, which the server checks
 * as their session would be (their workspace with Chat on, the brand, the
 * route's role). The person is always the run's (the tool context the
 * engine builds from the run's row), never the model's input. With the
 * secret unset or shorter than the server takes, this way is closed, and
 * the rows that write through it ask first in such a run (runForOpen).
 * Server only.
 */

/** The header naming the person the request acts for (the server's ACTING_USER_HEADER). */
export const ACTING_USER_HEADER = 'X-Acting-User';

/** The shortest CHAT_ACTING_SECRET the server takes (its MIN_SECRET_LENGTH). */
export const MIN_ACTING_SECRET_LENGTH = 32;

/** CHAT_ACTING_SECRET, when it is long enough for the server to take; else null. */
function actingSecret(): string | null {
  const secret = process.env.CHAT_ACTING_SECRET ?? '';
  return secret.length >= MIN_ACTING_SECRET_LENGTH ? secret : null;
}

/** Whether a run with no session can write through the API server as its person. */
export function actingOpen(): boolean {
  return actingSecret() !== null;
}

/** A refusal of the acting way, as a value the engine says (CHAT-20 §11a, #427). */
export type ActingRefusal = {
  ok: false;
  /** chat_off: Chat is off for the workspace; acting_refused: the server took no one. */
  reason: 'chat_off' | 'acting_refused';
  message: string;
};

const actingT = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.acting' });

/** Thrown by apiAs when the server refused to act as the person: its words, as a value. */
export class ActingRefusedError extends Error {
  constructor(readonly refusal: ActingRefusal) {
    super(refusal.message);
    this.name = 'ActingRefusedError';
  }
}

const refusal = (reason: ActingRefusal['reason']): ActingRefusal => ({
  ok: false,
  reason,
  message: actingT(reason === 'chat_off' ? 'chatOff' : 'refused'),
});

/** The API's answer: its status and its JSON body (empty when it had none). */
export interface ApiAnswer {
  status: number;
  ok: boolean;
  body: Record<string, unknown>;
}

/**
 * The person's own session token, when the request is theirs; null without
 * one, outside a request (the minute tick's background), or for another
 * person's session (their Run now that picked this run): never theirs to use.
 */
async function ownSessionToken(userId: string): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user.id === userId ? session.access_token : null;
  } catch {
    return null;
  }
}

/**
 * Sends `body` to the API server's `path` as `actor`: their session when the
 * request is theirs, else the acting secret. Throws ActingRefusedError when
 * the acting way is closed here, or the server answers it 401 (no one to
 * act as: the secrets differ, the person can't sign in) or 403 chat_off; any
 * other answer is the caller's to read, as with the person's own session.
 */
export async function apiAs(
  actor: RunActor,
  path: `/api/${string}`,
  init: { method: 'POST' | 'PATCH'; body?: unknown },
): Promise<ApiAnswer> {
  const token = await ownSessionToken(actor.userId);
  const secret = token ? null : actingSecret();
  if (!token && !secret) throw new ActingRefusedError(refusal('acting_refused'));
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token ?? secret}`,
      ...(token ? {} : { [ACTING_USER_HEADER]: actor.userId }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const body = json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  if (!token) {
    if (res.status === 401) {
      console.error('[chat/actor] the API server took no one to act as (check CHAT_ACTING_SECRET)');
      throw new ActingRefusedError(refusal('acting_refused'));
    }
    if (res.status === 403 && body.code === 'chat_off') {
      throw new ActingRefusedError(refusal('chat_off'));
    }
  }
  return { status: res.status, ok: res.ok, body };
}

/** An ActingRefusedError's refusal; null for any other error, which the caller rethrows. */
export function actingRefusalOf(err: unknown): ActingRefusal | null {
  return err instanceof ActingRefusedError ? err.refusal : null;
}
