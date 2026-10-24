import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/api-failure';
import { createClient } from '@/lib/supabase/client';
import type { CmsFields, CmsPage } from '@/lib/content/cms-send';

/**
 * Send to CMS from the browser (#1331), through the API's same-origin proxy:
 * not a server action, whose body is limited to 1 MB (25 pages are more) and
 * which Next runs one at a time, behind the editor's own.
 */

/** Why a send didn't go, as the server names it. */
export type CmsSendError =
  | 'no_webhook'
  | 'webhook_not_subscribed'
  | 'daily_limit'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'failed'
  // More than the API's proxy takes in one request (413).
  | 'too_large'
  // Not a send's own: the session, another workspace's brand, the rate limiter.
  | 'session'
  | 'workspace'
  | 'busy';

export interface CmsDelivery {
  id: string;
  draftId: string;
  status: 'queued' | 'sent' | 'failed' | 'published';
  /** What the webhook answered, when it did. */
  http_status?: number | null;
  /** Why it failed, as the server wrote it ("The webhook could not be reached"). */
  error?: string | null;
}

export type CmsSendResult =
  /** `skipped`: pages past the workspace's sends for the day, not sent. */
  | { ok: true; deliveries: CmsDelivery[]; skipped: number }
  | { ok: false; code: CmsSendError; field: string | null };

/** A send's own reasons, by the server's code. */
const KNOWN: readonly CmsSendError[] = [
  'no_webhook',
  'webhook_not_subscribed',
  'daily_limit',
  'forbidden',
  'not_found',
  'invalid',
];

/** The reasons any call can fail for, as the other calls read them (BUG-001). */
const GENERAL: readonly CmsSendError[] = ['session', 'workspace', 'busy'];

/** Sends pages of one brand to its webhook: one is sent before this answers, more go on. */
export async function sendPagesToCms(brandId: string, pages: CmsPage[]): Promise<CmsSendResult> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session', field: null };
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/content-drafts/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId, pages }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      field?: string | null;
      deliveries?: CmsDelivery[];
      skipped?: number;
    };
    if (!res.ok) {
      if (res.status === 413) return { ok: false, code: 'too_large', field: null };
      const general = apiFailure(res.status, body);
      const code =
        KNOWN.find((c) => c === body.code) ?? GENERAL.find((c) => c === general) ?? 'failed';
      return { ok: false, code, field: body.field ?? null };
    }
    return { ok: true, deliveries: body.deliveries ?? [], skipped: body.skipped ?? 0 };
  } catch (err) {
    console.error('Failed to send to the CMS:', err);
    return { ok: false, code: 'failed', field: null };
  }
}

/** A draft's last send, as the Library shows it beside its status. */
export interface CmsStatus {
  status: CmsDelivery['status'];
  /** When it was published, sent or queued. */
  at: string;
  /** What the webhook answered, when it did; else why it wasn't reached. */
  httpStatus: number | null;
  error: string | null;
  publishedUrl: string | null;
}

/** Ids a read takes: content_draft_last_deliveries (00262) reads up to 500. */
const STATUS_IDS_PER_READ = 500;
/**
 * A send still queued after this was left by a server that stopped mid-batch
 * (00262 closes it at the workspace's next send): it reads as interrupted,
 * so neither the Library nor the editor waits on it or says it is still
 * going. Read by the browser's clock: one 30 minutes fast would read a send
 * under way as interrupted, until its next read.
 */
const INTERRUPTED_AFTER_MS = 30 * 60_000;

/** A send as the Library and the editor read it: one left queued, as interrupted. */
function lastSend(row: {
  status: string;
  created_at: string;
  sent_at: string | null;
  published_at: string | null;
  error: string | null;
}): { status: CmsDelivery['status']; at: string; error: string | null } {
  const interrupted =
    row.status === 'queued' && Date.parse(row.created_at) < Date.now() - INTERRUPTED_AFTER_MS;
  return {
    status: interrupted ? 'failed' : (row.status as CmsDelivery['status']),
    at: row.published_at ?? row.sent_at ?? row.created_at,
    error: interrupted ? 'Not sent: interrupted' : row.error,
  };
}

/**
 * Each draft's last send, for the Library's rows: one row a draft, however
 * often it was sent. A read that fails (its function not there yet, 00262)
 * leaves its drafts with none.
 */
export async function readCmsStatuses(draftIds: string[]): Promise<Map<string, CmsStatus>> {
  const supabase = createClient();
  const chunks: string[][] = [];
  for (let i = 0; i < draftIds.length; i += STATUS_IDS_PER_READ) {
    chunks.push(draftIds.slice(i, i + STATUS_IDS_PER_READ));
  }
  const reads = await Promise.all(
    chunks.map((ids) => supabase.rpc('content_draft_last_deliveries', { p_draft_ids: ids })),
  );
  const statuses = new Map<string, CmsStatus>();
  for (const { data, error } of reads) {
    if (error) {
      console.error('Failed to read the pages’ sends:', error);
      continue;
    }
    for (const row of data ?? []) {
      if (!row.draft_id) continue;
      statuses.set(row.draft_id, {
        ...lastSend(row),
        httpStatus: row.http_status,
        publishedUrl: row.published_url,
      });
    }
  }
  return statuses;
}

/** What a draft keeps of its sends: its slug and meta, where it went live, and its last send. */
export interface DraftCms {
  fields: Partial<CmsFields>;
  publishedUrl: string | null;
  last: { status: CmsDelivery['status']; at: string; error: string | null } | null;
}

/**
 * The draft's kept fields and last send, read when the Send dialog opens.
 * Null when they can't be read: the dialog then holds Send, with Try again
 * (a page sent before under another slug could otherwise land twice).
 */
export async function readDraftCms(draftId: string): Promise<DraftCms | null> {
  const supabase = createClient();
  const [draft, last] = await Promise.all([
    supabase
      .from('content_drafts')
      .select('slug, meta_title, meta_description, published_url')
      .eq('id', draftId)
      .maybeSingle(),
    supabase
      .from('content_draft_deliveries')
      .select('status, created_at, sent_at, published_at, error')
      .eq('draft_id', draftId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (draft.error || !draft.data) {
    if (draft.error) console.error('Failed to read the page’s CMS fields:', draft.error);
    return null;
  }
  const delivery = last.error ? null : last.data;
  return {
    fields: {
      slug: draft.data.slug ?? undefined,
      metaTitle: draft.data.meta_title ?? undefined,
      metaDescription: draft.data.meta_description ?? undefined,
    },
    publishedUrl: draft.data.published_url,
    last: delivery ? lastSend(delivery) : null,
  };
}

/**
 * The slug and meta each draft kept from its last send, for a bulk send
 * (the dialog's single read is readDraftCms); none for a draft that kept
 * none. Throws when they can't be read: sent with the page's own slug, a
 * page sent before could land in the CMS twice.
 */
export async function readKeptFields(draftIds: string[]): Promise<Map<string, Partial<CmsFields>>> {
  const kept = new Map<string, Partial<CmsFields>>();
  if (!draftIds.length) return kept;
  const { data, error } = await createClient()
    .from('content_drafts')
    .select('id, slug, meta_title, meta_description')
    .in('id', draftIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    kept.set(row.id, {
      slug: row.slug ?? undefined,
      metaTitle: row.meta_title ?? undefined,
      metaDescription: row.meta_description ?? undefined,
    });
  }
  return kept;
}

/** Sends as they are now, by id: a bulk send's, while they go. Null when they can't be read. */
export async function readDeliveries(ids: string[]): Promise<CmsDelivery[] | null> {
  if (!ids.length) return [];
  const { data, error } = await createClient()
    .from('content_draft_deliveries')
    .select('id, draft_id, status, http_status, error')
    .in('id', ids);
  if (error) {
    console.error('Failed to read the sends:', error);
    return null;
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    draftId: row.draft_id ?? '',
    status: row.status as CmsDelivery['status'],
    http_status: row.http_status,
    error: row.error,
  }));
}
