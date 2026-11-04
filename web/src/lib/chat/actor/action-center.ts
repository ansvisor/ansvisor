import { randomUUID } from 'node:crypto';
import {
  FAILED,
  FORBIDDEN,
  NOT_FOUND,
  coverRequest,
  coverResult,
  placeIn,
  sendRequest,
  sendResult,
} from '@/lib/action-center/chat-send';
import type {
  ChatActionDuplicate,
  ChatActionEntities,
  ChatActionProposal,
  CreateChatActionResult,
} from '@/lib/actions/chat-action-center';
import type { ChatWritePlace } from '@/lib/chat/registry/define-tool';
import {
  markReadyForReview,
  readyForReviewFailed,
  type ReadyForReviewResult,
} from '@/lib/action-center/ready-for-review';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { assertWritableFor, canAccessBrandFor, isManagerFor, type RunActor } from './access';
import { actingRefusalOf, apiAs, type ActingRefusal } from './api';

/**
 * Send to Action Center (create_action) and its duplicate check for a run
 * with no session behind it: the same requests as checkChatActionCover and
 * createChatAction (lib/action-center/chat-send.ts), sent as the run's
 * person (api.ts), once they are checked as their session would be: the
 * plan and the demo brand, their role. The API checks the brand and the
 * role again as theirs. Errors come back as values (#427). Server only, and
 * never a server action: the person is the caller's word.
 */

/** The run's person's own chat: a teammate's shared chat is theirs to work in, not this person's. */
async function ownChatFor(actor: RunActor, conversationId: string) {
  const { data: chat, error } = await supabaseAdmin
    .from('chat_conversations')
    .select('id, user_id, organization_id, brand_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!chat || chat.user_id !== actor.userId || chat.organization_id !== actor.organizationId) {
    return null;
  }
  return { id: chat.id as string, brandId: (chat.brand_id as string | null) ?? null };
}

/** checkChatActionCover for the run's person: `{ ok: true }` when none covers it, or it couldn't be checked. */
export async function checkChatActionCoverFor(
  actor: RunActor,
  brandId: string,
  entities: ChatActionEntities,
  category?: ChatActionProposal['category'],
): Promise<{ ok: true } | ChatActionDuplicate> {
  try {
    await assertWritableFor(actor, brandId);
    const { path, body } = coverRequest(brandId, entities, category);
    return coverResult(await apiAs(actor, `/api/action-center${path}`, { method: 'POST', body }));
  } catch (err) {
    // Creating checks again, and acts on a refusal of the way (api.ts says it once).
    if (!actingRefusalOf(err)) {
      console.error('[chat/actor] could not check for a covering action:', err);
    }
    return { ok: true };
  }
}

/** createChatAction for the run's person, at the run's place for History. */
export async function createChatActionFor(
  actor: RunActor,
  brandId: string,
  proposal: ChatActionProposal,
  place?: ChatWritePlace,
  createAnyway = false,
): Promise<CreateChatActionResult | ActingRefusal> {
  try {
    await assertWritableFor(actor, brandId);
    if (!(await isManagerFor(actor, actor.organizationId))) return FORBIDDEN;
    const where = await placeIn((id) => ownChatFor(actor, id), place, 'create_action');
    const key = `chat:${where?.approvalKey ?? randomUUID()}`;
    const { path, body } = sendRequest(brandId, proposal, where, key, createAnyway);
    return sendResult(await apiAs(actor, `/api/action-center${path}`, { method: 'POST', body }));
  } catch (err) {
    const refused = actingRefusalOf(err);
    if (refused) return refused;
    console.error('[chat/actor] could not send to Action Center:', err);
    return FAILED("The action couldn't be sent.");
  }
}

/**
 * setTaskReadyForReview for the run's person, in an agent's run with no
 * session behind it (sessionFree): the same checks as the person's own
 * click (a workspace that can be written, their live role an Admin's or a
 * Manager's, the brand theirs to use, the change on a step of their own
 * chat), then the same change, its History naming them. Full auto only lets
 * it run without a card where the agent may (the precedence decides).
 */
export async function setTaskReadyForReviewFor(
  actor: RunActor,
  brandId: string,
  taskId: string,
  place?: ChatWritePlace,
): Promise<ReadyForReviewResult> {
  try {
    await assertWritableFor(actor, brandId);
    if (!(await isManagerFor(actor, actor.organizationId))) return FORBIDDEN;
    if (!(await canAccessBrandFor(actor, brandId))) return NOT_FOUND('task');
    const where = await placeIn((id) => ownChatFor(actor, id), place, 'set_task_ready_for_review');
    return await markReadyForReview(supabaseAdmin, {
      brandId,
      taskId,
      where,
      actorId: actor.userId,
    });
  } catch (err) {
    return readyForReviewFailed(err);
  }
}
