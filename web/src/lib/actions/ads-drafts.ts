'use server';

import { randomUUID } from 'node:crypto';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { API_BASE_URL } from '@/config/api';
import type { AdsChannel } from '@/lib/ads/api';
import type { ChatWritePlace } from '@/lib/chat/registry/define-tool';
import { isManager } from '@/lib/session-role';
import { assertWritable } from '@/lib/subscription-guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Chat's ad drafts (Ads Phase 0 PR 15, save_ad_drafts): copy written or
 * rewritten in Chat, saved through the Pay card's route (POST
 * /api/ads/opportunities/:promptId/drafts with `drafts`), whose claims gate
 * decides by rule what is saved: a draft that fails isn't, and the answer
 * says why. Admins and Managers, as the route. The approval's key makes a
 * retried approval answer what it saved. Nothing reaches an ad platform.
 */

export interface AdDraftCopy {
  channel: AdsChannel;
  headlines: string[];
  descriptions: string[];
  contextHint: string | null;
  keywords: string[];
  claims: { text: string; factId: string }[];
}

const t = createTranslator({ locale: 'en', messages, namespace: 'ads.chatDrafts' });

export async function saveAdDrafts(
  brandId: string,
  promptId: string,
  drafts: AdDraftCopy[],
  place?: ChatWritePlace,
) {
  try {
    await assertWritable({ brandId });
    const supabase = await createClient();
    if (!(await isManager(supabase))) {
      return { ok: false as const, reason: 'forbidden_role' as const, message: t('managers') };
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error('No session');
    const path = `/api/ads/opportunities/${encodeURIComponent(promptId)}/drafts`;
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        brandId,
        idempotencyKey: `chat:${place?.approvalKey ?? randomUUID()}`,
        drafts,
      }),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const rejected: unknown[] = Array.isArray(body.rejected) ? body.rejected : [];
    if (res.ok) {
      const saved = (body.drafts ?? []) as { channel: AdsChannel; id: string }[];
      return {
        ok: true as const,
        saved: saved.map(({ channel, id }) => ({ channel, id })),
        notSaved: rejected,
        gate: body.gate,
      };
    }
    if (body.code === 'forbidden') {
      return { ok: false as const, reason: 'forbidden_role' as const, message: t('managers') };
    }
    // None passed the gate: nothing saved, and why, channel by channel.
    if (body.code === 'gate_failed') {
      return {
        ok: false as const,
        reason: 'invalid' as const,
        message: t('gateFailed'),
        // What the gate found, channel by channel, for the model to say in words.
        why: JSON.stringify(rejected),
      };
    }
    const said = body.code === 'facts_needed' && body.why === 'none' ? 'factsNeeded' : null;
    const message = said ? t(said) : body.code === 'plan_limit' ? t('planLimit') : t('failed');
    return { ok: false as const, reason: 'refused' as const, message, why: String(body.code) };
  } catch (err) {
    console.error('[ads] could not save ad drafts from Chat:', err);
    return { ok: false as const, reason: 'failed' as const, message: t('failed') };
  }
}
