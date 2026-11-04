import { NextResponse } from 'next/server';
import type { AiProvider } from '@/lib/agent/providers';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/plan-row';
import { ownChatKeyProviders, ownKeyAccess, type OwnKeyAccess } from '@/lib/chat/key';
import { readModelMenu, type ChatModelMenu } from '@/lib/chat/model-menu';
import { AUTO_MODEL, isCatalogId, modelChoiceOpen } from '@/lib/chat/models';
import { planFactsFromOrgRow } from '@/lib/chat/plan-facts';
import { chatActor, runFailure } from '@/lib/chat/run-api';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** What the person may do in the model menu, beside the menu itself (W4-02). */
export interface ChatModelAccess {
  /** They may pick a model and effort: Starter and up (Wave 4 decision 2 B). */
  choiceOpen: boolean;
  /** Their plan's name, for the menu's "Your plan" row; null self-hosted. */
  planName: string | null;
  trial: boolean;
  /** Own API keys: Enterprise's, a kept key's days, or locked (CHAT-16 items 19, 28). */
  ownKeys: OwnKeyAccess;
}

/**
 * GET /api/chat/models?selected={model}
 *
 * Chat's model menu (CHAT-16 §A–B, W4-01, W4-02): Auto, the offered models
 * with their multiplier labels and tones, "Your key" on the models an own key runs,
 * the chat's model (`selected`, flagged once the catalog dropped it), the
 * catalog's size and its last sync; and what the person may do: pick a model
 * (not in the free trial), their plan, and their own keys' state. Never a
 * price. Not there (404) while the new Chat is off for the workspace.
 *
 * Answers `{ ok: true, menu, access }`, or `{ ok: false, failure, code, error }`.
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const asked = new URL(req.url).searchParams.get('selected');
    // A model no longer offered is asked for too: the menu says the chat runs Auto now.
    const selected = asked === AUTO_MODEL || isCatalogId(asked) ? asked : null;
    const [org, ownKeyProviders, ownKeys] = await Promise.all([
      supabaseAdmin
        .from('organizations')
        .select(ORG_PLAN_COLUMNS)
        .eq('id', actor.organizationId)
        .maybeSingle(),
      ownChatKeyProviders(actor.organizationId).catch((): AiProvider[] => []),
      ownKeyAccess(actor.organizationId).catch((): OwnKeyAccess => ({ state: 'locked' })),
    ]);
    if (org.error) throw new Error(org.error.message);
    const plan = planFactsFromOrgRow(org.data);
    const menu: ChatModelMenu = await readModelMenu({ selected, ownKeyProviders });
    const access: ChatModelAccess = {
      choiceOpen: modelChoiceOpen(plan),
      planName: plan.selfHosted ? null : plan.planName,
      trial: plan.isTrial,
      ownKeys,
    };
    return NextResponse.json({ ok: true, menu, access });
  } catch (error) {
    console.error('[chat/models] could not read the model menu:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the models');
  }
}
