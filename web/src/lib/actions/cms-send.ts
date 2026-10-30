'use server';

import { API_BASE_URL } from '@/config/api';
import { bulkCmsItems, type BulkProblem, type CmsFields } from '@/lib/content/cms-send';
import type { CmsDelivery, CmsTarget } from '@/lib/content/cms-send-client';
import { readCmsSources } from '@/lib/content/cms-sources';
import { withContentDom } from '@/lib/content/server-dom';
import { assertWritable } from '@/lib/subscription-guard';
import { createClient } from '@/lib/supabase/server';

export type SendDraftToCmsResult =
  | {
      ok: true;
      target: CmsTarget;
      /** As the API answers the page's send: sent, still on its way, or already live. */
      status: CmsDelivery['status'];
      /** Its CMS item (or draft post) was updated, not made. */
      updated: boolean;
      /** WordPress: a new draft post beside the live one; Framer: live with the site's next publish. */
      live: boolean;
    }
  | {
      ok: false;
      reason: 'not_found' | 'not_connected' | 'invalid' | 'quota_exceeded' | 'conflict' | 'failed';
      message: string;
    };

/** Why a page can't go as it is, in words (the editor's Send dialog says where to fix it). */
const PROBLEM_WORDS: Record<BulkProblem, string> = {
  noTitle: 'The page needs a title before it can be sent.',
  longTitle: 'The page’s title is too long for the CMS.',
  empty: 'The page is empty.',
  tooLong: 'The page is too long for the CMS.',
  placeholders: 'The page still has placeholders to fill. Fill them in the Content Editor first.',
  slug: 'The page needs a slug. Set it in Send to CMS in the Content Editor.',
  metaTitle: 'The page’s meta title is too long. Change it in Send to CMS in the Content Editor.',
  metaDescription:
    'The page’s meta description is too long. Change it in Send to CMS in the Content Editor.',
};

/** The API's codes for a CMS the brand hasn't connected, or hasn't set up for sends. */
const NOT_CONNECTED = new Set([
  'no_webhook',
  'webhook_not_subscribed',
  'webflow_not_configured',
  'no_webflow',
  'webflow_not_ready',
  'wordpress_not_configured',
  'no_wordpress',
  'framer_not_configured',
  'no_framer',
  'framer_not_ready',
  'wix_not_configured',
  'no_wix',
]);

/**
 * Send one Library draft to the brand's CMS as a draft: Chat's push_cms_draft
 * (CHAT-20 §9 row 58). The page is made ready as the Library's bulk send
 * makes each (readCmsSources, bulkCmsItems: its author and byline, the slug
 * and meta it kept from its last send, else the page's) and goes through the
 * API's own send, as the signed-in member: its role check (Admins and
 * Managers), its connections and its daily limit. Nothing goes live: the CMS
 * keeps it as a draft (DECISIONS 1). Errors come back as values (#427).
 */
export async function sendDraftToCms(
  draftId: string,
  target: CmsTarget,
): Promise<SendDraftToCmsResult> {
  await assertWritable();
  const supabase = await createClient();
  const { data: draft, error } = await supabase
    .from('content_drafts')
    .select('id, brand_id, slug, meta_title, meta_description, archived_at, brands(name, language)')
    .eq('id', draftId)
    .maybeSingle();
  if (error) return { ok: false, reason: 'failed', message: error.message };
  if (!draft || draft.archived_at) {
    return { ok: false, reason: 'not_found', message: 'That draft isn’t in the Library.' };
  }
  const brand = (Array.isArray(draft.brands) ? draft.brands[0] : draft.brands) as {
    name?: string;
    language?: string | null;
  } | null;

  await withContentDom();
  const sources = await readCmsSources({
    brandId: draft.brand_id,
    draftIds: [draftId],
    brandName: brand?.name ?? '',
    brandLanguage: brand?.language,
  });
  const source = sources.get(draftId);
  if (!source)
    return { ok: false, reason: 'not_found', message: 'That draft isn’t in the Library.' };
  const kept = new Map<string, Partial<CmsFields>>([
    [
      draftId,
      {
        slug: draft.slug ?? undefined,
        metaTitle: draft.meta_title ?? undefined,
        metaDescription: draft.meta_description ?? undefined,
      },
    ],
  ]);
  const [item] = bulkCmsItems([source], kept);
  if (!item?.page) {
    return {
      ok: false,
      reason: 'invalid',
      message: item?.problem ? PROBLEM_WORDS[item.problem] : 'The page can’t be sent as it is.',
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return { ok: false, reason: 'failed', message: 'Your session ended. Sign in again.' };
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/content-drafts/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId: draft.brand_id, pages: [item.page], target }),
    });
  } catch (err) {
    console.error('Failed to send the page to the CMS:', err);
    return { ok: false, reason: 'failed', message: 'The CMS couldn’t be reached. Try again.' };
  }
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
    deliveries?: CmsDelivery[];
  };
  if (!res.ok) {
    const code = body.code ?? '';
    const message = body.error || 'The page couldn’t be sent.';
    if (NOT_CONNECTED.has(code)) return { ok: false, reason: 'not_connected', message };
    if (code === 'daily_limit') return { ok: false, reason: 'quota_exceeded', message };
    if (code === 'in_progress') return { ok: false, reason: 'conflict', message };
    return { ok: false, reason: 'failed', message };
  }
  const [delivery] = body.deliveries ?? [];
  if (delivery?.status === 'failed') {
    return {
      ok: false,
      reason: 'failed',
      message: delivery.error || 'The CMS refused the page.',
    };
  }
  return {
    ok: true,
    target,
    status: delivery?.status ?? 'queued',
    updated: delivery?.updated ?? false,
    live: delivery?.live ?? false,
  };
}
