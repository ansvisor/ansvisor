import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { AiUsage } from './ai-usage';

/**
 * Billing's By agent list and the header meter's Top agent line (CHAT-27
 * items 27–28): which agents used how much of this period's AI allowance.
 * The API sends each agent's share by id (GET /api/billing/ai-usage,
 * `byAgent`, the Agents pages' own read); the names are read here with the
 * person's own session, so an agent they may not see (a teammate's private
 * one, or one on brands that aren't theirs: chat_agents' policy) stays
 * unnamed and counts in "Other agents". Shares only, never dollars.
 */

/** How many agents the list names before "Other agents" (item 27). */
export const BY_AGENT_TOP = 5;

/** What the list shows besides the agents, in its order: Chat outside them, then the features. */
export const BY_AGENT_FEATURES = ['content', 'action_center', 'improve'] as const;

export type ByAgentRow =
  | { kind: 'agent'; agentId: string; name: string; percent: number }
  | { kind: 'deleted'; percent: number }
  | { kind: 'otherAgents'; percent: number }
  | { kind: 'chat'; percent: number }
  | { kind: 'feature'; feature: (typeof BY_AGENT_FEATURES)[number]; percent: number };

const tenths = (n: number) => Math.round(n * 10) / 10;

/**
 * The usage with the names of the agents the person may see. A read that
 * fails names none: the list then shows them all as "Other agents".
 */
export async function nameAgents(
  supabase: SupabaseClient<Database>,
  usage: AiUsage,
): Promise<AiUsage> {
  const byAgent = usage.byAgent;
  const ids = byAgent?.agents.flatMap((a) => (a.agentId ? [a.agentId] : [])) ?? [];
  if (!byAgent || ids.length === 0) return usage;
  const { data, error } = await supabase.from('chat_agents').select('id, name').in('id', ids);
  if (error) {
    console.error('Failed to read agent names:', error.message);
    return usage;
  }
  const names = new Map((data ?? []).map((row) => [row.id, row.name]));
  return {
    ...usage,
    byAgent: {
      ...byAgent,
      agents: byAgent.agents.map((a) => {
        const name = a.agentId ? names.get(a.agentId) : undefined;
        return name ? { ...a, name } : a;
      }),
    },
  };
}

/**
 * The By agent list's rows (item 27): the agents the person may see and the
 * deleted ones, highest first, the top 5 of them; then "Other agents" for
 * the rest and those they may not see; then what used the rest: Chat
 * outside any agent, the Content Editor, the Action Center and Improve, each
 * only when it used some. Empty when no agent used any (the list's empty
 * line); null when there is no list (Chat not metered, the trial).
 */
export function aiUseByAgent(usage: AiUsage): ByAgentRow[] | null {
  const byAgent = usage.byAgent;
  if (!byAgent || usage.trial) return null;
  if (byAgent.agents.length === 0) return [];
  const ranked: ByAgentRow[] = [];
  let unseen: number | null = null;
  for (const { agentId, name, percent } of byAgent.agents) {
    if (agentId === null) ranked.push({ kind: 'deleted', percent });
    else if (name) ranked.push({ kind: 'agent', agentId, name, percent });
    else unseen = (unseen ?? 0) + percent;
  }
  ranked.sort((a, b) => b.percent - a.percent);
  const rows = ranked.slice(0, BY_AGENT_TOP);
  const rest = ranked.slice(BY_AGENT_TOP);
  if (rest.length > 0 || unseen !== null) {
    const percent = rest.reduce((sum, row) => sum + row.percent, unseen ?? 0);
    rows.push({ kind: 'otherAgents', percent: tenths(percent) });
  }
  if (byAgent.chat > 0) rows.push({ kind: 'chat', percent: byAgent.chat });
  for (const feature of BY_AGENT_FEATURES) {
    const used = usage.features.find((f) => f.feature === feature);
    if (used) rows.push({ kind: 'feature', feature, percent: used.percent });
  }
  return rows;
}

/** The meter's "Top agent this period" (item 28): the named agent that used the most, or null. */
export function topAgent(usage: AiUsage): { name: string; percent: number } | null {
  const top = aiUseByAgent(usage)?.find((row) => row.kind === 'agent');
  return top?.kind === 'agent' ? { name: top.name, percent: top.percent } : null;
}
