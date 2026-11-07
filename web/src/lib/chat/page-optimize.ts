import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import {
  decideDraftSuggestions,
  getContentDraft,
  startPageRewrite,
  updateContentDraft,
  type AgentWriteError,
} from '@/lib/actions/content-drafts';
import { agentWriteRequest, describeRule } from '@/lib/content/agent-write';
import { readDraftRules, type DraftRulesRead } from '@/lib/content/draft-rules-read';
import { ruleStatusDetail } from '@/lib/content/rule-words';
import { NOT_FOR_AGENT, type ActiveRule } from '@/lib/content/rules';
import { sanitizeDraftHtml } from '@/lib/content/sanitize-draft-html';
import { withContentDom } from '@/lib/content/server-dom';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ChatToolContext } from './registry/define-tool';
import { RUN_REQUEST_MS } from './run-limits';

/**
 * Optimize ▾ › "Optimize here, no editor" (CHAT-25 §7, W4-12b part 2; the
 * owner's 2026-11-05 decision): the Content Editor's own "Rewrite the page to
 * these rules" (startPageRewrite, the API's content-writer.js rewrite), run
 * as the signed-in member with the rules in effect and the passages still
 * locked, as the editor sends them (agentWriteRequest), metered from the
 * workspace's AI usage as the editor's rewrite is. Chat waits for the
 * background run, then the page it wrote goes in as the draft's next
 * version (updateContentDraft: History keeps the page before, so the card's
 * Undo brings it back) and its suggestion is marked accepted. No editor: no
 * Accept / Reject in between, as the spec has it.
 *
 * The wait runs inside the request working the run (RUN_REQUEST_MS), so the
 * page goes in only with OPTIMIZE_RESERVE_MS of it still ahead: its Undo and
 * its version card are written right after the save, in the same step, and
 * never cut off after it. A rewrite that comes later isn't saved here: it
 * waits in the Content Editor to compare, and nothing changed.
 *
 * It never sends the agent again for a rule an earlier Optimize here in this
 * chat couldn't close (`tried`, kept in the runs' progress): those are named
 * as the person's to decide, and with none left to send it doesn't run.
 * Hand off's Quality fixes (CE-051) aren't part of it yet.
 */

export const OPTIMIZE_TOOL = 'optimize_draft';

/**
 * What Optimize here leaves of its request once the page is saved: its Undo,
 * the version card with its Rules and Quality reads, and the answer.
 */
export const OPTIMIZE_RESERVE_MS = 90_000;
/** How long Chat waits for the rewrite at most: the request, less the reserve (3.5 minutes). */
export const OPTIMIZE_WAIT_MS = RUN_REQUEST_MS - OPTIMIZE_RESERVE_MS;
/** How often the run is read meanwhile. */
const POLL_MS = 3_000;

const tRules = createTranslator({
  locale: 'en',
  messages,
  namespace: 'contentEditor.editor.rules',
});
const tStatus = createTranslator({
  locale: 'en',
  messages,
  namespace: 'contentEditor.editor.rules.status',
});
const tWords = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.optimize' });
const t = tRules as unknown as (key: string) => string;

export type OptimizeResult =
  | {
      ok: true;
      title: string;
      /** History's version of the page before the rewrite, which the card's Undo restores. */
      beforeVersionId: string;
      /** The page as it was saved, for the version card and Files. */
      body_html: string;
      fixed: string[];
      /** The rules the rewrite didn't close: the person's to decide. */
      left: string[];
      /** Their keys, kept so this chat never sends the agent for them again. */
      tried: string[];
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'nothing'
        | 'conflict'
        | 'quota_exceeded'
        | 'invalid'
        | 'still_writing'
        | 'failed';
      message: string;
      left?: string[];
      tried?: string[];
    };

/** The rewrite's refusals, as Chat says them to the person. */
const START_REFUSALS: Partial<Record<AgentWriteError, Extract<OptimizeResult, { ok: false }>>> = {
  open_suggestions: {
    ok: false,
    reason: 'conflict',
    message: tWords('openSuggestions'),
  },
  writing: { ok: false, reason: 'conflict', message: tWords('busy') },
  org_writing: { ok: false, reason: 'conflict', message: tWords('busy') },
  running: { ok: false, reason: 'conflict', message: tWords('busy') },
  not_draft: { ok: false, reason: 'invalid', message: tWords('notDraft') },
  empty: { ok: false, reason: 'invalid', message: tWords('empty') },
  too_long: { ok: false, reason: 'invalid', message: tWords('tooLong') },
  ai_budget: { ok: false, reason: 'quota_exceeded', message: tWords('aiBudget') },
  no_subscription: { ok: false, reason: 'quota_exceeded', message: tWords('aiBudget') },
};

/** The rules the agent can fix that the page leaves open, as the editor's Fix picks them. */
export function openForAgent(read: Pick<DraftRulesRead, 'checked'>) {
  return read.checked.filter(
    ({ rule, status }) =>
      rule.on && status.state === 'bad' && rule.check !== 'feed' && !NOT_FOR_AGENT.has(rule.key),
  );
}

const nameOf = (rule: ActiveRule) => tRules(`names.${rule.key}` as 'names.length');

/**
 * The rules an earlier Optimize here in this chat tried on the draft and
 * couldn't close, from its runs' progress (optimizeTried, by draft). A read
 * that fails counts none: the agent may try them once more.
 */
export async function triedInChat(conversationId: string | null, draftId: string) {
  if (!conversationId) return [];
  const { data: runs, error } = await supabaseAdmin
    .from('chat_runs')
    .select('id')
    .eq('conversation_id', conversationId);
  if (error || !runs?.length) return [];
  const { data: states, error: stateError } = await supabaseAdmin
    .from('chat_run_state')
    .select('progress')
    .in(
      'run_id',
      runs.map((run) => run.id),
    );
  if (stateError) return [];
  const tried = new Set<string>();
  for (const row of (states ?? []) as { progress: unknown }[]) {
    const kept = (row.progress as { optimizeTried?: Record<string, unknown> } | null)
      ?.optimizeTried?.[draftId];
    for (const key of Array.isArray(kept) ? kept : []) {
      if (typeof key === 'string') tried.add(key);
    }
  }
  return [...tried];
}

/** The rewrite run started at or after `since`, once it finished; null while it works. */
async function finishedRun(draftId: string, since: string) {
  const { data, error } = await supabaseAdmin
    .from('content_agent_runs')
    .select('finished_at, outcome')
    .eq('draft_id', draftId)
    .eq('kind', 'rewrite')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the rewrite: ${error.message}`);
  return data?.finished_at ? { outcome: data.outcome as string | null } : null;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Optimize here for a draft the person can change: refused as a value,
 * never thrown.
 */
export async function optimizeDraftHere(
  ctx: ChatToolContext,
  draftId: string,
  wait: { maxMs?: number; pollMs?: number } = {},
): Promise<OptimizeResult> {
  try {
    const organizationId = ctx.organizationId;
    const draft = await getContentDraft(draftId);
    const before = organizationId ? await readDraftRules({ organizationId, draftId }) : null;
    if (!draft || !before) {
      return { ok: false, reason: 'not_found', message: tWords('notFound') };
    }
    const tried = new Set(await triedInChat(ctx.chat?.conversationId ?? null, draftId));
    const open = openForAgent(before);
    const toFix = open.filter(({ rule }) => !tried.has(rule.key));
    if (toFix.length === 0) {
      const left = open.map(({ rule }) => nameOf(rule));
      return {
        ok: false,
        reason: 'nothing',
        message: left.length
          ? tWords('triedAlready', { rules: left.join(', ') })
          : tWords('allMet'),
        left,
      };
    }

    // The request as the editor's rewrite makes it, without the rules tried here before.
    await withContentDom();
    const inEffect = before.checked.filter(({ rule }) => rule.on && !tried.has(rule.key));
    const request = await agentWriteRequest(
      {
        id: draft.id,
        brandId: draft.brandId,
        title: draft.title,
        pageType: draft.pageType,
        method: draft.method,
        sourceUrl: draft.sourceUrl,
        bodyHtml: draft.bodyHtml,
        rules: draft.rules,
      },
      (rule, status) => describeRule(t, rule, status),
      { rules: inEffect.map(({ rule }) => rule), textRules: before.textRules },
    );
    // Each open rule says how the page reads now, as the editor's rewrite does.
    const statusOf = new Map(inEffect.map(({ rule, status }) => [rule.key, status]));
    request.rules = request.rules.map((rule) => {
      const status = statusOf.get(rule.key);
      if (!status || status.state !== 'bad') return rule;
      const now = `${tRules('agent.now')}: ${ruleStatusDetail(tStatus as (key: string) => string, status)}`;
      return { ...rule, detail: [rule.detail, now].filter(Boolean).join(' · ').slice(0, 500) };
    });

    const since = new Date(Date.now() - 5_000).toISOString();
    const started = await startPageRewrite(draft.id, draft.brandId, {
      ...request,
      counted: before.total,
    });
    if ('error' in started) {
      return (
        START_REFUSALS[started.error] ?? { ok: false, reason: 'failed', message: tWords('failed') }
      );
    }

    // The page is saved by then or not at all: the request's reserve is for what follows the save.
    const saveBy = Math.min(
      Date.now() + (wait.maxMs ?? OPTIMIZE_WAIT_MS),
      (ctx.run?.endsAt ?? Infinity) - OPTIMIZE_RESERVE_MS,
    );
    const pollMs = wait.pollMs ?? POLL_MS;
    let run: { outcome: string | null } | null = null;
    while (!run && Date.now() + pollMs <= saveBy) {
      await pause(pollMs);
      run = await finishedRun(draft.id, since);
    }
    if (!run) return { ok: false, reason: 'still_writing', message: tWords('stillWriting') };
    if (run.outcome !== 'done') return { ok: false, reason: 'failed', message: tWords('failed') };

    const { data: page, error } = await supabaseAdmin
      .from('content_draft_suggestions')
      .select('id, after_text')
      .eq('draft_id', draft.id)
      .eq('kind', 'page')
      .eq('status', 'open')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Could not read the rewrite: ${error.message}`);
    const sent = toFix.map(({ rule }) => rule.key);
    if (!page?.after_text) {
      return {
        ok: false,
        reason: 'nothing',
        message: tWords('nothingChanged'),
        left: toFix.map(({ rule }) => nameOf(rule)),
        tried: sent,
      };
    }

    // Read past the reserve: the rewrite waits in the editor, and the page stays as it was.
    if (Date.now() > saveBy) {
      return { ok: false, reason: 'still_writing', message: tWords('tooLate') };
    }
    const changed = await updateContentDraft(draft.id, { bodyHtml: page.after_text });
    if (!changed.ok)
      return {
        ok: false,
        reason: changed.reason === 'conflict' ? 'conflict' : 'failed',
        message: changed.message,
      };
    // Put in place here, so the editor doesn't offer it again to compare.
    await decideDraftSuggestions([page.id], 'accepted').catch((err: unknown) =>
      console.error('[chat/optimize] the rewrite wasn’t marked accepted:', err),
    );

    const after = await readDraftRules({ organizationId: organizationId!, draftId });
    const stillOpen = new Set((after ? openForAgent(after) : toFix).map(({ rule }) => rule.key));
    const leftRules = toFix.filter(({ rule }) => stillOpen.has(rule.key));
    return {
      ok: true,
      title: after?.title || draft.title,
      beforeVersionId: changed.beforeVersionId,
      body_html: sanitizeDraftHtml(page.after_text),
      fixed: toFix.filter(({ rule }) => !stillOpen.has(rule.key)).map(({ rule }) => nameOf(rule)),
      left: leftRules.map(({ rule }) => nameOf(rule)),
      tried: leftRules.map(({ rule }) => rule.key),
    };
  } catch (err) {
    console.error('[chat/optimize] Optimize here failed:', err);
    return { ok: false, reason: 'failed', message: tWords('failed') };
  }
}

/** The rule keys an Optimize here's output says it tried and couldn't close, by its draft. */
export function triedOf(
  input: unknown,
  output: unknown,
): { draftId: string; keys: string[] } | null {
  const draftId = (input as { draft_id?: unknown } | null)?.draft_id;
  const tried = (output as { tried?: unknown } | null)?.tried;
  if (typeof draftId !== 'string' || !Array.isArray(tried)) return null;
  return { draftId, keys: tried.filter((key): key is string => typeof key === 'string') };
}
