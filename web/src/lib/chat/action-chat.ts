import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logActionRunEvent, readActionForRun } from './agent-action';
import { runWithChatDenial } from './agent-rules';
import { denied, type AgentContext, type AgentResult } from './agents';
import { composerSetupOf } from './composer-setup';
import { startChatRun, type ChatActor, type EngineFailure } from './engine';
import { DEFAULT_CHAT_SETTINGS } from './precedence';

/**
 * Run with Chat on an Action Center action (CHAT-21 §F item 27: the
 * picker's no-agent choice): the person's own Chat run on the action, in
 * their default mode, as if they had asked from the action's row with it
 * attached (Ask about this): its message names the action, its scope holds
 * it (an `Action · {title}` chip and the action as an @ reference), so the
 * run reads it through Chat's Action Center reads. The action's History
 * gets one line, "Chat started on this action", with the person (owner
 * decision 2026-10-31). Admins and Managers, as Run agent. Server only.
 */

const chatT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.runWithChat' });

/** Where a chat started from an action says it was opened (chat_conversations.origin_page). */
export const ACTION_CENTER_PAGE = '/dashboard/action-center/actions';

export type ActionChatResult =
  | AgentResult<{ runId: string; conversationId: string; queued: boolean }>
  | { ok: false; engine: EngineFailure };

/** The person's saved default mode, as their composer starts with it (W1-10). */
async function defaultModeOf(ctx: AgentContext) {
  const { data, error } = await supabaseAdmin
    .from('chat_user_prefs')
    .select('default_mode')
    .eq('user_id', ctx.actor.userId)
    .maybeSingle();
  if (error) console.error('[chat/actions] could not read the default mode:', error.message);
  return composerSetupOf((data as { default_mode?: string | null } | null)?.default_mode, {
    role: ctx.viewer.role,
    plan: ctx.plan,
    settings: {
      ...DEFAULT_CHAT_SETTINGS,
      fullAutoForMembers: ctx.settings.fullAutoForMembers,
    },
  }).defaultMode;
}

/**
 * Starts the person's Chat run on the action (above): kept and started, or
 * queued while every slot is busy, as a message they sent; the caller drives
 * it. The action has to be open and in their brands.
 */
export async function startActionChat(
  ctx: AgentContext,
  actionId: string,
  input: { timezone?: string } = {},
  now = new Date(),
): Promise<ActionChatResult> {
  const denial = runWithChatDenial(ctx.viewer);
  if (denial) return denied(ctx, denial);
  const action = await readActionForRun(ctx, actionId, now);
  if (!action.ok) return action;
  const { snapshot, brand } = action.value;
  const actor: ChatActor = ctx.actor;
  const started = await startChatRun(actor, {
    message: chatT('message', { no: snapshot.no, title: snapshot.title }),
    brandId: brand.id,
    mode: await defaultModeOf(ctx),
    timezone: input.timezone,
    origin: 'panel',
    originPage: ACTION_CENTER_PAGE,
    context: {
      route: ACTION_CENTER_PAGE,
      chips: [
        { key: 'brand', label: brand.name, value: brand.id },
        {
          key: 'action',
          label: chatT('chip', { title: snapshot.title }).slice(0, 200),
          value: snapshot.id,
        },
      ],
    },
    references: [{ type: 'task', id: snapshot.id, label: snapshot.title.slice(0, 200) }],
  });
  if (!started.ok) return { ok: false, engine: started };
  await logActionRunEvent(
    snapshot.id,
    'chat_started',
    { conversation_id: started.conversationId },
    ctx.actor.userId,
  );
  return {
    ok: true,
    value: {
      runId: started.runId,
      conversationId: started.conversationId,
      queued: started.queued,
    },
  };
}
