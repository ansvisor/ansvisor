import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/api-failure';
import { createClient } from '@/lib/supabase/client';

/**
 * Uploading an access log for the brand's AI bot report (#2170, 00492): the
 * file goes from the browser through the API's same-origin proxy, not a
 * server action (whose body is limited to 1 MB), and the API reads it once,
 * as a log sender's file, against the month's raw-record cap.
 */

/**
 * The largest file an upload takes: what the API's proxy takes in one
 * request, as for a catalog upload. A gzipped file holds far more lines.
 */
export const BOT_LOG_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** Lines one file may hold, as the API reads them (server bot-log-formats.js MAX_LOG_LINES). */
export const BOT_LOG_UPLOAD_MAX_LINES = 20_000;

/** The files the picker offers: access logs, JSON lines, and either gzipped. */
export const BOT_LOG_UPLOAD_ACCEPT =
  '.log,.txt,.json,.jsonl,.ndjson,.gz,text/plain,application/json,application/x-ndjson,application/gzip';

export type BotLogUploadError =
  | 'too_large'
  | 'unreadable'
  | 'empty'
  /** A plan without the bot report. */
  | 'plan'
  /** Not an admin or a manager. */
  | 'forbidden'
  | 'workspace'
  | 'busy'
  | 'session'
  /** A read-only workspace, or the demo brand: the upgrade dialog, not a message. */
  | 'subscription'
  | 'failed';

export type BotLogUploadResult =
  | {
      ok: true;
      /** The file's lines. */
      records: number;
      /** Verified AI bot requests among them. */
      bots: number;
      /** Lines left out: older than 7 days, another site's, or without a user agent. */
      leftOut: number;
      /** The same file was read before: nothing read again. */
      duplicate: boolean;
      /** This month's log records are used up: the file was counted, not read. */
      rawCapped: boolean;
    }
  | { ok: false; code: BotLogUploadError };

const count = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** What the API read, from its answer: { received, verified, records, skipped, … }. */
function readResult(body: Record<string, unknown>): BotLogUploadResult {
  const records = count(body.records);
  const skipped = (body.skipped ?? {}) as Record<string, unknown>;
  const duplicate = body.duplicate === true;
  const rawCapped = body.rawCapped === true;
  const leftOut =
    duplicate || rawCapped
      ? 0
      : Math.max(0, records - count(body.received)) +
        count(skipped.invalid) +
        count(skipped.other_host);
  return { ok: true, records, bots: count(body.verified), leftOut, duplicate, rawCapped };
}

/** Uploads one file for the brand: what was read, or why it wasn't. */
export async function uploadBotLog(brandId: string, file: File): Promise<BotLogUploadResult> {
  if (file.size === 0) return { ok: false, code: 'empty' };
  if (file.size > BOT_LOG_UPLOAD_MAX_BYTES) return { ok: false, code: 'too_large' };
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/bots/upload/${encodeURIComponent(brandId)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: file,
      },
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return readResult(body);
    if (res.status === 413 || body.error === 'too_large') return { ok: false, code: 'too_large' };
    if (body.error === 'unreadable_file') return { ok: false, code: 'unreadable' };
    if (body.error === 'empty_file') return { ok: false, code: 'empty' };
    const general = apiFailure(res.status, body);
    if (general === 'plan' || general === 'limit') return { ok: false, code: 'plan' };
    if (
      general === 'session' ||
      general === 'subscription' ||
      general === 'workspace' ||
      general === 'busy'
    ) {
      return { ok: false, code: general };
    }
    // The API's refusal of a member who isn't an admin or a manager.
    if (res.status === 403) return { ok: false, code: 'forbidden' };
    return { ok: false, code: 'failed' };
  } catch (err) {
    console.error('Uploading the AI bot log failed:', err);
    return { ok: false, code: 'failed' };
  }
}
