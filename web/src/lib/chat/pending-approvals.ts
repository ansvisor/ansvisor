import { createHmac } from 'node:crypto';
import { createTranslator } from 'next-intl';
import { supabaseAdmin } from '@/lib/supabase/admin';
import messages from '../../../messages/en.json';
import type { ChatActor } from './engine';
import type { PendingCalls } from './engine-store';
import { chatTool } from './registry/tools';

/**
 * The person's waiting approvals on one brand, grouped by the Content draft
 * they are about (one "Approve all" per draft). Several agents can each leave
 * a run waiting on the same page; each run keeps its own card, and each is
 * still approved through prepareResume. Server only.
 *
 * Scope: every read is the person's own (user and organization of the run's
 * state) and the brand's, which must be in their organization. A draft id
 * comes from a model's tool input, so a draft is read only with that brand:
 * one outside it reads as not found and its runs are left out.
 *
 * Together or one by one: an approved run makes the change its card stored
 * (the engine's resumePending), never one made again from the page as it is
 * then. update_draft's change is the whole page, written from the page its
 * run read, so two such changes overwrite each other in any order and only
 * the last would be kept. A group is approved together only when at most one
 * of its changes rewrites the page (togetherOf); otherwise each is approved
 * from its own chat, where the person sees what it does to the page now.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatShell.inbox.drafts' });
const toolT = createTranslator({ locale: 'en', messages, namespace: 'chatTools' });

/**
 * The changes to a draft that leave its page as it is: Mark ready sets its
 * status, and the editor's suggestions wait there for the person's Accept.
 * Every other change to a draft rewrites its page (update_draft, Optimize
 * here), a new one too until it is named here.
 */
const PAGE_KEPT_TOOLS: ReadonlySet<string> = new Set(['set_draft_ready', 'suggest_draft_changes']);

/** One run waiting on a change to the draft. */
export interface PendingApproval {
  runId: string;
  /** Its chat, where its own card is. */
  chatId: string;
  /** What prepareResume needs: the card's step and digest. */
  n: number;
  digest: string;
  draftId: string;
  /** Who proposed it: an agent's name, or Chat for the person's own chat. */
  agent: string;
  /** The agent's id, or the run's chat for one with no agent: counts the agents. */
  source: string;
  summary: string;
  /** Its change writes the whole page (or its title) from the page its run read. */
  rewritesPage: boolean;
}

export interface DraftApprovals {
  draftId: string;
  title: string;
  items: PendingApproval[];
}

/** What the browser reads: no draft, run or step ids. */
export interface ApprovalGroup {
  /** An HMAC of the draft id (per person and brand). */
  key: string;
  /** Changes with the cards in the group: Approve all is refused for a stale one. */
  version: string;
  title: string;
  agents: number;
  /** Approve all is offered (togetherOf); else each change is approved from its own chat. */
  together: boolean;
  /** Each change, with its chat: the person's own, where its card is. */
  items: { agent: string; summary: string; chatId: string }[];
}

function secret(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET;
  if (!value) throw new Error('No server secret to sign approval groups with.');
  return value;
}

const sign = (...parts: string[]) =>
  createHmac('sha256', secret()).update(parts.join('|')).digest('hex');

/** The opaque key of a draft's group, for this person and brand. */
export const groupKeyOf = (actor: ChatActor, brandId: string, draftId: string) =>
  sign('group', actor.userId, actor.organizationId, brandId, draftId);

export const versionOf = (items: PendingApproval[]) =>
  sign('version', ...items.map((item) => `${item.runId}:${item.n}:${item.digest}`).sort());

/** At most one of the changes rewrites the page: made together, none overwrites another. */
export const togetherOf = (items: PendingApproval[]) =>
  items.filter((item) => item.rewritesPage).length <= 1;

/** The draft a waiting card changes, for a change a card asks for (never a go-live click). */
function draftOfCard(
  pending: PendingCalls,
): { draftId: string; toolKey: string; rewritesPage: boolean } | null {
  if (pending.kind !== 'ask') return null;
  const call = pending.calls[pending.index];
  const tool = call ? chatTool(call.toolName) : undefined;
  const brandOf = tool?.brandOf;
  if (!tool || tool.class !== 'write' || tool.flags.goLiveOnOwn || tool.flags.costCard) return null;
  if (!brandOf || !('lookup' in brandOf) || brandOf.lookup !== 'content_drafts') return null;
  const id = (call.input as Record<string, unknown> | null)?.[brandOf.idField];
  return typeof id === 'string' && id
    ? { draftId: id, toolKey: tool.labelKey, rewritesPage: !PAGE_KEPT_TOOLS.has(tool.name) }
    : null;
}

const summaryOf = (labelKey: string) =>
  Object.hasOwn(messages.chatTools, labelKey)
    ? toolT(`${labelKey}.step` as never)
    : t('changeFallback');

function check<T>(
  what: string,
  result: { data: unknown[] | null; error: { message: string } | null },
): T[] {
  if (result.error) throw new Error(`Could not read ${what}: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

/**
 * The person's runs on this brand that wait on a change to a Content draft,
 * grouped by draft; a group with one run is a group too (the UI shows those
 * with two or more). Empty when the brand isn't in their organization.
 */
export async function readPendingApprovals(
  actor: ChatActor,
  brandId: string,
): Promise<DraftApprovals[]> {
  const brand = check<{ id: string }>(
    'the brand',
    await supabaseAdmin
      .from('brands')
      .select('id')
      .eq('id', brandId)
      .eq('organization_id', actor.organizationId),
  );
  if (brand.length === 0) return [];

  const states = check<{ run_id: string; pending: unknown; progress: { brandId?: string | null } }>(
    'the waiting runs',
    await supabaseAdmin
      .from('chat_run_state')
      .select('run_id, pending, progress')
      .eq('user_id', actor.userId)
      .eq('organization_id', actor.organizationId)
      .not('waiting_since', 'is', null),
  );
  const cards = states.flatMap((state) => {
    if (!state.pending || state.progress?.brandId !== brandId) return [];
    const pending = state.pending as PendingCalls;
    const card = draftOfCard(pending);
    return card ? [{ runId: state.run_id, pending, ...card }] : [];
  });
  if (cards.length === 0) return [];

  const runIds = cards.map((card) => card.runId);
  const draftIds = [...new Set(cards.map((card) => card.draftId))];
  const [runs, drafts] = await Promise.all([
    supabaseAdmin
      .from('chat_runs')
      .select('id, conversation_id, status')
      .in('id', runIds)
      .eq('status', 'waiting'),
    supabaseAdmin
      .from('content_drafts')
      .select('id, title')
      .in('id', draftIds)
      .eq('brand_id', brandId),
  ]);
  const chatOf = new Map(
    check<{ id: string; conversation_id: string }>('the runs', runs).map((r) => [
      r.id,
      r.conversation_id,
    ]),
  );
  const titleOf = new Map(
    check<{ id: string; title: string | null }>('the drafts', drafts).map((d) => [
      d.id,
      d.title ?? '',
    ]),
  );

  const conversations = check<{ id: string; agent_run_id: string | null }>(
    'the chats',
    await supabaseAdmin
      .from('chat_conversations')
      .select('id, agent_run_id')
      .in('id', [...new Set(chatOf.values())])
      .eq('organization_id', actor.organizationId)
      .eq('user_id', actor.userId),
  );
  const agentRunOf = new Map(conversations.map((c) => [c.id, c.agent_run_id]));
  const agentRunIds = [
    ...new Set(conversations.flatMap((c) => (c.agent_run_id ? [c.agent_run_id] : []))),
  ];
  const agentRuns = agentRunIds.length
    ? check<{ id: string; agent_id: string | null }>(
        'the agent runs',
        await supabaseAdmin
          .from('chat_agent_runs')
          .select('id, agent_id')
          .in('id', agentRunIds)
          .eq('organization_id', actor.organizationId),
      )
    : [];
  const agentIdOf = new Map(agentRuns.map((r) => [r.id, r.agent_id]));
  const agentIds = [...new Set(agentRuns.flatMap((r) => (r.agent_id ? [r.agent_id] : [])))];
  const agents = agentIds.length
    ? check<{ id: string; name: string }>(
        'the agents',
        await supabaseAdmin
          .from('chat_agents')
          .select('id, name')
          .in('id', agentIds)
          .eq('organization_id', actor.organizationId),
      )
    : [];
  const nameOf = new Map(agents.map((a) => [a.id, a.name]));

  const groups = new Map<string, DraftApprovals>();
  for (const card of cards) {
    const conversationId = chatOf.get(card.runId);
    const title = titleOf.get(card.draftId);
    // Not waiting any more, not in this person's chats, or a draft outside the brand.
    if (conversationId === undefined || title === undefined || !agentRunOf.has(conversationId)) {
      continue;
    }
    const agentId = agentIdOf.get(agentRunOf.get(conversationId) ?? '') ?? null;
    const item: PendingApproval = {
      runId: card.runId,
      chatId: conversationId,
      n: card.pending.n,
      digest: card.pending.digest,
      draftId: card.draftId,
      agent: (agentId && nameOf.get(agentId)) || t('chatAgent'),
      source: agentId ?? conversationId,
      summary: summaryOf(card.toolKey),
      rewritesPage: card.rewritesPage,
    };
    const group = groups.get(card.draftId) ?? { draftId: card.draftId, title, items: [] };
    group.items.push(item);
    groups.set(card.draftId, group);
  }
  return [...groups.values()];
}

/** A group as the browser reads it. */
export function viewOf(actor: ChatActor, brandId: string, group: DraftApprovals): ApprovalGroup {
  return {
    key: groupKeyOf(actor, brandId, group.draftId),
    version: versionOf(group.items),
    title: group.title,
    agents: new Set(group.items.map((item) => item.source)).size,
    together: togetherOf(group.items),
    items: group.items.map(({ agent, summary, chatId }) => ({ agent, summary, chatId })),
  };
}
