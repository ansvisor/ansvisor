'use server';

import { randomUUID } from 'node:crypto';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { API_BASE_URL } from '@/config/api';
import { isManager } from '@/lib/session-role';
import { assertWritable } from '@/lib/subscription-guard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/types/supabase';
import type { ChatWritePlace } from '@/lib/chat/registry/define-tool';

/**
 * Chat's changes to the Action Center (CHAT-09 §D–E, CHAT-20 §9 rows 43–46,
 * §12), the only ones it makes there: a new action from a finding
 * (create_action, through the server's Send to Action Center, which checks
 * for a duplicate first and freezes the action), a finding added to an
 * action that already covers it (attach_to_action), a file or draft
 * attached to a task (attach_file_to_task) and a task Chat finished set to
 * Ready for review in its chat (set_task_ready_for_review). Each writes the
 * History event Action Center shows, with source `chat`, the chat, the run
 * and how it was approved (§10a). None completes, dismisses, edits or
 * deletes an action or a task: closing a task stays the person's click.
 *
 * Admins and Managers only, checked here as the server checks its own
 * route. Errors come back as values ({ ok: false, reason, message }, #427):
 * the engine says them in the person's words (§11a).
 */

/** Where the engine ran the change, as Chat's own rows record it; none outside a run. */
type Place = ChatWritePlace | undefined;

/** A refusal, in the codes the engine knows (CHAT-20 §11a). */
export type ChatActionFailure = {
  ok: false;
  reason: 'invalid' | 'not_found' | 'forbidden_role' | 'conflict' | 'failed';
  message: string;
};

/** An active action that already covers a finding (CHAT-20 §11a `duplicate`). */
export type ChatActionDuplicate = {
  ok: false;
  reason: 'duplicate';
  message: string;
  action_id: string;
  action_no: number;
  /** Create anyway may still go: the action shares only some of the finding's entities. */
  can_create_anyway: boolean;
};

export interface ChatActionEntities {
  prompts: string[];
  pages: string[];
  competitors: string[];
  platforms: string[];
}

export interface ChatActionTask {
  title: string;
  type: 'content' | 'on_page' | 'technical' | 'outreach' | 'pr' | 'product';
  url?: string;
  where?: string;
  why?: string;
  how?: string[];
  done_when: string;
  change?: { before?: string; after: string };
  check?: 'auto' | 'rerun' | 'manual';
}

/** A finding proposed as an action: title, category, targets and AC-004 tasks (CHAT-09 item 18). */
export interface ChatActionProposal {
  title: string;
  category: 'growth' | 'protect' | 'recover' | 'fix' | 'compete';
  impact?: 'high' | 'medium' | 'low';
  why: string;
  goal?: string;
  entities: ChatActionEntities;
  tasks: ChatActionTask[];
}

export type CreateChatActionResult =
  | {
      ok: true;
      action_id: string;
      action_no: number;
      created: boolean;
      /** Open in Actions (CHAT-09 item 19). */
      href: `/dashboard/action-center/actions/${string}`;
      /**
       * The brand's new actions for today are reached with this one, as with
       * any person's send: it stands, and Action Center's own wait until
       * tomorrow. `daily_limit_note` is the one sentence Chat says about it.
       */
      daily_limit_reached?: true;
      daily_limit_note?: string;
    }
  | ChatActionDuplicate
  | ChatActionFailure;

const cardT = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.actionCard' });

/** The server's count of the day's new actions, when it says they are reached. */
function dailyLimitOf(body: Record<string, unknown>) {
  const limit = (body.dailyLimit ?? null) as { limit?: unknown; reached?: unknown } | null;
  if (!limit || limit.reached !== true) return {};
  return {
    daily_limit_reached: true as const,
    daily_limit_note: cardT('dailyLimit', { limit: Number(limit.limit) || 5 }),
  };
}

const FORBIDDEN: ChatActionFailure = {
  ok: false,
  reason: 'forbidden_role',
  message: 'Only an admin or a manager can change Action Center from Chat.',
};
const NOT_FOUND = (what: string): ChatActionFailure => ({
  ok: false,
  reason: 'not_found',
  message: `I couldn't find that ${what}.`,
});
const FAILED = (what: string): ChatActionFailure => ({
  ok: false,
  reason: 'failed',
  message: `${what} Try again.`,
});

/** The action's page with its drawer open: the redirect at actions/[id]. */
const actionHref = (id: string) => `/dashboard/action-center/actions/${id}` as const;

/** How the change was approved, for History's execution.mode (§10a): as the server read it. */
const executionOf = (where: Where | null) => (where ? { mode: where.executionMode } : null);

/** Where a change was made, as the server read it: never as a caller said it. */
interface Where {
  conversationId: string;
  brandId: string | null;
  runId: string;
  /** The run step it runs on: one per approval, its idempotency key. */
  approvalKey: string;
  executionMode: 'assisted' | 'automated';
}

/**
 * The chat, run and step a change runs on, read on the server (a server
 * action can be called with anything): the person's own chat, a run of it,
 * and the step of that run running this very tool now. How it was approved
 * comes from the step: one the engine ran without a card is marked so
 * (engine.ts writeCall), any other waited on the person's card. Null when
 * any of it doesn't hold: nothing of it is recorded then.
 */
async function placeOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  place: Place,
  tool: string,
): Promise<Where | null> {
  if (!place?.conversationId || !place.runId || !place.approvalKey) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: chat, error } = await supabase
    .from('chat_conversations')
    .select('id, user_id, brand_id')
    .eq('id', place.conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // A teammate's shared chat is theirs to work in, not this person's.
  if (!chat || chat.user_id !== user.id) return null;
  const { data: step, error: stepError } = await supabaseAdmin
    .from('chat_run_steps')
    .select('id, run_id, status, tool, debug_json, chat_runs!inner(conversation_id)')
    .eq('id', place.approvalKey)
    .eq('run_id', place.runId)
    .maybeSingle();
  if (stepError) throw new Error(stepError.message);
  const row = step as {
    id: string;
    run_id: string;
    status: string;
    tool: string | null;
    debug_json: { auto?: unknown } | null;
    chat_runs: { conversation_id: string } | null;
  } | null;
  if (
    !row ||
    row.status !== 'running' ||
    row.tool !== tool ||
    row.chat_runs?.conversation_id !== chat.id
  ) {
    return null;
  }
  return {
    conversationId: chat.id as string,
    brandId: (chat.brand_id as string | null) ?? null,
    runId: row.run_id,
    approvalKey: row.id,
    executionMode: row.debug_json?.auto === true ? 'automated' : 'assisted',
  };
}

/** The signed-in person's session token, for the API. */
async function sessionToken(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/** The API's refusal, in Chat's codes. */
function apiRefusal(status: number, body: Record<string, unknown>): ChatActionFailure {
  const details = typeof body.details === 'string' ? body.details : null;
  if (status === 403 && body.code === 'forbidden') return FORBIDDEN;
  // Another workspace's brand, or one outside the person's brand access.
  if (status === 403 && (body.code === 'not_in_workspace' || body.code === 'no_brand_access')) {
    return {
      ok: false,
      reason: 'not_found',
      message: details ?? "This brand isn't one you can work on.",
    };
  }
  if (status === 404) return NOT_FOUND('brand');
  // The action this approval made was cancelled since.
  if (status === 409 && body.code === 'conflict') {
    return { ok: false, reason: 'conflict', message: details ?? 'This changed since.' };
  }
  if (status === 400) {
    return { ok: false, reason: 'invalid', message: details ?? 'This proposal is incomplete.' };
  }
  return FAILED("The Action Center didn't answer.");
}

/** A 409 duplicate's body, as the model reads it. */
function duplicateOf(body: Record<string, unknown>): ChatActionDuplicate {
  const action = (body.action ?? {}) as { id?: string; no?: number };
  const no = Number(action.no);
  return {
    ok: false,
    reason: 'duplicate',
    message: `AC-${no} already covers this.`,
    action_id: String(action.id ?? ''),
    action_no: no,
    can_create_anyway: body.canCreateAnyway === true,
  };
}

async function postApi(path: string, body: unknown) {
  const token = await sessionToken();
  if (!token) return null;
  const res = await fetch(`${API_BASE_URL}/api/action-center${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, ok: res.ok, body: json };
}

/**
 * Before a Send to Action Center card: whether an active action already
 * covers the finding (CHAT-09 item 18a). `{ ok: true }` when none does, or
 * when the check couldn't be made: creating checks again.
 */
export async function checkChatActionCover(
  brandId: string,
  entities: ChatActionEntities,
  category?: ChatActionProposal['category'],
): Promise<{ ok: true } | ChatActionDuplicate> {
  try {
    await assertWritable({ brandId });
    const res = await postApi('/chat-actions/check', { brandId, entities, category });
    const first = (res?.ok ? (res.body.covering as unknown[] | undefined) : null)?.[0] as
      | { actionId: string; actionNo: number; covers: 'all' | 'some' }
      | undefined;
    if (!first) return { ok: true };
    return duplicateOf({
      action: { id: first.actionId, no: first.actionNo },
      canCreateAnyway: first.covers === 'some',
    });
  } catch (err) {
    console.error('[chat/action-center] could not check for a covering action:', err);
    return { ok: true };
  }
}

/**
 * Send to Action Center (create_action): the finding as a new action, once
 * approved, unless an active one covers it (`duplicate`). `createAnyway`:
 * the person chose Create anyway, which the server lets through only when
 * the entities differ.
 */
export async function createChatAction(
  brandId: string,
  proposal: ChatActionProposal,
  place?: Place,
  createAnyway = false,
): Promise<CreateChatActionResult> {
  try {
    await assertWritable({ brandId });
    const supabase = await createClient();
    if (!(await isManager(supabase))) return FORBIDDEN;
    const where = await placeOf(supabase, place, 'create_action');
    const res = await postApi('/chat-actions', {
      brandId,
      proposal,
      conversationId: where?.conversationId ?? null,
      runId: where?.runId ?? null,
      executionMode: where?.executionMode ?? null,
      // One per approval (the run step): a retry finds what it made (§11c).
      idempotencyKey: `chat:${where?.approvalKey ?? randomUUID()}`,
      createAnyway,
    });
    if (!res) return FAILED('Your session ended.');
    if (res.status === 409 && res.body.code === 'duplicate') return duplicateOf(res.body);
    if (!res.ok) return apiRefusal(res.status, res.body);
    const actionId = String(res.body.actionId);
    return {
      ok: true,
      action_id: actionId,
      action_no: Number(res.body.actionNo),
      created: res.body.created === true,
      href: actionHref(actionId),
      ...dailyLimitOf(res.body),
    };
  } catch (err) {
    console.error('[chat/action-center] could not send to Action Center:', err);
    return FAILED("The action couldn't be sent.");
  }
}

/**
 * Whether the person may use the brand (brand access, 00388): a person given
 * Selected brands only theirs. The member reads below see the whole
 * workspace's actions and tasks, so this is checked on its own.
 */
async function canUseBrand(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_access_brand', { p_brand_id: brandId });
  if (error) throw new Error(error.message);
  return data === true;
}

/** An action the person's workspace has, open: its brand, number and status. */
async function openAction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actionId: string,
): Promise<{ id: string; brand_id: string; action_no: number; status: string } | null> {
  // The member's own read: another workspace's action, or a deleted one, isn't found (RLS).
  const { data, error } = await supabase
    .from('actions')
    .select('id, brand_id, action_no, status')
    .eq('id', actionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; brand_id: string; action_no: number; status: string }) ?? null;
}

const CLOSED: ChatActionFailure = {
  ok: false,
  reason: 'conflict',
  message: 'That action is closed: send the finding as a new action instead.',
};

/**
 * Add to AC-{n} (attach_to_action): the finding as evidence on an action
 * that already covers it, with a note, in its History. The action's
 * targets, tasks and everything else stay as they are (CHAT-20 §12 rule 1).
 */
export async function attachToAction(
  actionId: string,
  evidence: { finding: string; note?: string; sources?: string[] },
  place?: Place,
): Promise<
  | { ok: true; action_id: string; action_no: number; event_id: string; href: string }
  | ChatActionFailure
> {
  try {
    await assertWritable();
    const supabase = await createClient();
    if (!(await isManager(supabase))) return FORBIDDEN;
    const action = await openAction(supabase, actionId);
    if (!action || !(await canUseBrand(supabase, action.brand_id))) return NOT_FOUND('action');
    await assertWritable({ brandId: action.brand_id });
    if (action.status === 'completed' || action.status === 'dismissed') return CLOSED;
    const where = await placeOf(supabase, place, 'attach_to_action');
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: event, error } = await supabase
      .from('action_events')
      .insert({
        action_id: action.id,
        event: 'evidence_attached',
        actor_id: user?.id ?? null,
        data: {
          source: 'chat',
          finding: evidence.finding,
          ...(evidence.note ? { note: evidence.note } : {}),
          ...(evidence.sources?.length ? { sources: evidence.sources } : {}),
          conversationId: where?.conversationId ?? null,
          runId: where?.runId ?? null,
          execution: executionOf(where),
        } as Json,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return {
      ok: true,
      action_id: action.id,
      action_no: Number(action.action_no),
      event_id: (event as { id: string }).id,
      href: actionHref(action.id),
    };
  } catch (err) {
    console.error('[chat/action-center] could not add the finding:', err);
    return FAILED("The finding couldn't be added.");
  }
}

/** A task of the brand's open actions, with what History names it by. */
async function brandTask(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  taskId: string,
) {
  const { data, error } = await supabase
    .from('action_tasks')
    .select('id, action_id, task_key, title, status, actions!inner(brand_id, status)')
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as {
    id: string;
    action_id: string;
    task_key: string | null;
    title: string | null;
    status: string;
    actions: { brand_id: string; status: string } | null;
  } | null;
  if (!row || row.actions?.brand_id !== brandId) return null;
  return row;
}

/**
 * Attach only (attach_file_to_task, CHAT-09 item 16): a file in Files, or a
 * draft filed there, linked to a task (`attached_by` the person), its status
 * `attached`. The task isn't marked done: that is the person's click.
 * Attaching it again changes nothing.
 */
export async function attachFileToTask(
  brandId: string,
  taskId: string,
  fileId: string,
  place?: Place,
): Promise<
  | { ok: true; file_id: string; task_id: string; action_id: string; already: boolean }
  | ChatActionFailure
> {
  try {
    await assertWritable({ brandId });
    const supabase = await createClient();
    if (!(await isManager(supabase))) return FORBIDDEN;
    if (!(await canUseBrand(supabase, brandId))) return NOT_FOUND('task');
    const task = await brandTask(supabase, brandId, taskId);
    if (!task) return NOT_FOUND('task');
    if (task.actions?.status === 'completed' || task.actions?.status === 'dismissed') return CLOSED;
    // The member's own read: a file of another workspace, or a brand they don't see, isn't found.
    const { data: file, error: fileError } = await supabase
      .from('chat_files')
      .select('id, title, status, brand_id')
      .eq('id', fileId)
      .maybeSingle();
    if (fileError) throw new Error(fileError.message);
    if (!file || (file.brand_id && file.brand_id !== brandId)) return NOT_FOUND('file');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // The server writes the link (00411): once per file and task.
    const { data: linked, error: linkError } = await supabaseAdmin
      .from('chat_file_task_links')
      .upsert(
        { file_id: file.id, action_task_id: task.id, attached_by: user?.id ?? null },
        { onConflict: 'file_id,action_task_id', ignoreDuplicates: true },
      )
      .select('file_id');
    if (linkError) throw new Error(linkError.message);
    const already = (linked ?? []).length === 0;
    if (already) {
      return { ok: true, file_id: file.id, task_id: task.id, action_id: task.action_id, already };
    }
    // Draft → attached; a file already done stays done.
    const { error: statusError } = await supabaseAdmin
      .from('chat_files')
      .update({ status: 'attached' })
      .eq('id', file.id)
      .eq('status', 'draft');
    if (statusError) throw new Error(statusError.message);

    const where = await placeOf(supabase, place, 'attach_file_to_task');
    const { error: eventError } = await supabase.from('action_events').insert({
      action_id: task.action_id,
      event: 'file_attached',
      actor_id: user?.id ?? null,
      data: {
        source: 'chat',
        taskId: task.id,
        task: task.task_key,
        title: task.title,
        fileId: file.id,
        file: file.title,
        conversationId: where?.conversationId ?? null,
        runId: where?.runId ?? null,
        execution: executionOf(where),
      } as Json,
    });
    if (eventError) console.error('[chat/action-center] attachment not in History:', eventError);
    return { ok: true, file_id: file.id, task_id: task.id, action_id: task.action_id, already };
  } catch (err) {
    console.error('[chat/action-center] could not attach the file:', err);
    return FAILED("The file couldn't be attached.");
  }
}

/** A task Chat can still say it finished: one that isn't done, skipped or failed. */
const OPEN_TASK = new Set(['todo', 'in_progress', 'waiting_approval']);

/**
 * Ready for review (set_task_ready_for_review, CHAT-09 item 16a): Chat, or
 * an agent, finished its work for a task. It is Chat's status for the task
 * in this chat's strip (chat_task_state, 00418), and an event in the task's
 * History; the task's own Action Center status doesn't change. Completing
 * or dismissing it stays the person's click (item 15).
 */
export async function setTaskReadyForReview(
  brandId: string,
  taskId: string,
  place?: Place,
): Promise<
  | {
      ok: true;
      task_id: string;
      action_id: string;
      conversation_id: string;
      /** Chat's status for the task before, null when the strip didn't have it: what Undo puts back. */
      previous: string | null;
    }
  | ChatActionFailure
> {
  try {
    await assertWritable({ brandId });
    const supabase = await createClient();
    if (!(await isManager(supabase))) return FORBIDDEN;
    if (!(await canUseBrand(supabase, brandId))) return NOT_FOUND('task');
    const task = await brandTask(supabase, brandId, taskId);
    if (!task) return NOT_FOUND('task');
    if (!OPEN_TASK.has(task.status)) {
      return {
        ok: false,
        reason: 'conflict',
        message: 'That task is already done or skipped in Action Center.',
      };
    }
    const where = await placeOf(supabase, place, 'set_task_ready_for_review');
    if (!where) {
      return { ok: false, reason: 'invalid', message: 'Ready for review is set from a chat.' };
    }
    // Its chat's brand: a chat about one brand doesn't mark another's tasks.
    if (where.brandId && where.brandId !== brandId) {
      return {
        ok: false,
        reason: 'invalid',
        message: 'This chat is about another brand: set Ready for review from its own chat.',
      };
    }
    const { data: state, error: stateError } = await supabaseAdmin
      .from('chat_task_state')
      .select('chat_status')
      .eq('conversation_id', where.conversationId)
      .eq('action_task_id', task.id)
      .maybeSingle();
    if (stateError) throw new Error(stateError.message);
    const previous = (state?.chat_status as string | undefined) ?? null;
    if (previous === 'ready_for_review' || previous === 'done') {
      return {
        ok: true,
        task_id: task.id,
        action_id: task.action_id,
        conversation_id: where.conversationId,
        previous,
      };
    }
    if (previous) {
      const { error } = await supabaseAdmin
        .from('chat_task_state')
        .update({ chat_status: 'ready_for_review', run_id: where.runId })
        .eq('conversation_id', where.conversationId)
        .eq('action_task_id', task.id);
      if (error) throw new Error(error.message);
    } else {
      // A task the strip didn't list yet: it goes last.
      const { data: last, error: lastError } = await supabaseAdmin
        .from('chat_task_state')
        .select('position')
        .eq('conversation_id', where.conversationId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastError) throw new Error(lastError.message);
      const { error } = await supabaseAdmin.from('chat_task_state').insert({
        conversation_id: where.conversationId,
        action_task_id: task.id,
        position: Number(last?.position ?? 0) + 1,
        chat_status: 'ready_for_review',
        run_id: where.runId,
      });
      if (error) throw new Error(error.message);
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: eventError } = await supabase.from('action_events').insert({
      action_id: task.action_id,
      event: 'task_ready_for_review',
      actor_id: user?.id ?? null,
      data: {
        source: 'chat',
        taskId: task.id,
        task: task.task_key,
        title: task.title,
        conversationId: where.conversationId,
        runId: where.runId,
        execution: executionOf(where),
      } as Json,
    });
    if (eventError)
      console.error('[chat/action-center] Ready for review not in History:', eventError);
    return {
      ok: true,
      task_id: task.id,
      action_id: task.action_id,
      conversation_id: where.conversationId,
      previous,
    };
  } catch (err) {
    console.error('[chat/action-center] could not set Ready for review:', err);
    return FAILED("The task couldn't be set to Ready for review.");
  }
}
