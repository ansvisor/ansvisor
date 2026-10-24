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
  | { ok: true; deliveries: CmsDelivery[] }
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
    };
    if (!res.ok) {
      const general = apiFailure(res.status, body);
      const code =
        KNOWN.find((c) => c === body.code) ?? GENERAL.find((c) => c === general) ?? 'failed';
      return { ok: false, code, field: body.field ?? null };
    }
    return { ok: true, deliveries: body.deliveries ?? [] };
  } catch (err) {
    console.error('Failed to send to the CMS:', err);
    return { ok: false, code: 'failed', field: null };
  }
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
      .select('status, created_at, sent_at, error')
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
    last: delivery
      ? {
          status: delivery.status as CmsDelivery['status'],
          at: delivery.sent_at ?? delivery.created_at,
          error: delivery.error,
        }
      : null,
  };
}
