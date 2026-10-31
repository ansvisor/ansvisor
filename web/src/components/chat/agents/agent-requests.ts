import { API_FAILURES, apiFailure, type ApiFailure } from '@/lib/api-failure';
import type { ChatDenialCard } from '@/lib/chat/events';
import type { AgentDetail, AgentListResult, AgentRunView } from '@/lib/chat/agents';
import type { AgentListView } from '@/lib/chat/agent-rules';
import type { RunNowItem } from '@/lib/chat/agent-runs';

/**
 * The agents API (/api/chat/agents…, W2-13) as the pages call it: reads
 * answer the body or null, never throw; a change answers `{ ok: true, … }`
 * or `{ ok: false, failure, message, denial? }` — the server's refusal as a
 * value (#1777), with the out-of-permission answer's four parts when a
 * role, the plan or Settings › Chat stopped it (CHAT-20 §4c).
 */

export type AgentRefused = {
  ok: false;
  failure: ApiFailure;
  /** The server's words for a plain refusal ("This agent is archived…"); null for none. */
  message: string | null;
  denial: ChatDenialCard | null;
  /** The refusal's code (`name_taken`, `plan_locked`…); null when none came back. */
  code: string | null;
  /** What a denial refused (chatAgents.asked: `fullAuto`, `workspace`…); null for none. */
  asked: string | null;
};

/** A change of state, as its route is named. */
export type AgentChange = 'activate' | 'pause' | 'resume' | 'archive' | 'restore' | 'take-over';

const isFailure = (value: unknown): value is ApiFailure =>
  typeof value === 'string' && (API_FAILURES as readonly string[]).includes(value);

async function readJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as ({ ok?: boolean } & T) | null;
  return res?.ok && body?.ok ? body : null;
}

/** A tab of the list, or null when it couldn't be read. */
export function readAgents(view: AgentListView, q: string) {
  const params = new URLSearchParams({ view });
  if (q) params.set('q', q);
  return readJson<AgentListResult>(`/api/chat/agents?${params}`);
}

/** An agent's detail: the agent, `missing` for one the person can't see, or null when it couldn't be read. */
export async function readAgent(id: string): Promise<AgentDetail | 'missing' | null> {
  const res = await fetch(`/api/chat/agents/${id}`, { cache: 'no-store' }).catch(() => null);
  if (res?.status === 404) return 'missing';
  const body = (await res?.json().catch(() => null)) as {
    ok?: boolean;
    agent?: AgentDetail;
  } | null;
  return res?.ok && body?.ok && body.agent ? body.agent : null;
}

/** An agent's last runs (50 at most), or null when they couldn't be read. */
export async function readAgentRuns(id: string): Promise<AgentRunView[] | null> {
  const body = await readJson<{ runs: AgentRunView[] }>(`/api/chat/agents/${id}/runs`);
  return body?.runs ?? null;
}

async function send<T>(url: string, init: RequestInit): Promise<({ ok: true } & T) | AgentRefused> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as Record<string, unknown> | null;
  if (res?.ok && body?.ok === true) return body as { ok: true } & T;
  return {
    ok: false,
    failure: isFailure(body?.failure) ? body.failure : apiFailure(res?.status ?? 0, body ?? {}),
    // A 500's words are the log's, not the person's.
    message: res && res.status < 500 && typeof body?.error === 'string' ? body.error : null,
    denial: (body?.denial as ChatDenialCard | undefined) ?? null,
    code: typeof body?.code === 'string' ? body.code : null,
    asked: typeof body?.asked === 'string' ? body.asked : null,
  };
}

/** Activate, Pause, Resume, Archive, Restore or Take over: the agent's detail after it. */
export const changeAgent = (id: string, change: AgentChange) =>
  send<{ agent: AgentDetail }>(`/api/chat/agents/${id}/${change}`, {});

/** Duplicate: the copy's detail, a draft. */
export const duplicateAgent = (id: string) =>
  send<{ agent: AgentDetail }>(`/api/chat/agents/${id}/duplicate`, {});

/** Run now: each brand's run, queued. */
export const runAgentNow = (id: string) =>
  send<{ runs: RunNowItem[] }>(`/api/chat/agents/${id}/run`, { body: '{}' });

/** Save as draft (CHAT-21 §D item 17): the new agent's detail. */
export const createAgent = (input: Record<string, unknown>) =>
  send<{ agent: AgentDetail }>('/api/chat/agents', { body: JSON.stringify(input) });

/** A change from Edit (§C item 14): a new version when what it does changed. */
export const updateAgent = (id: string, patch: Record<string, unknown>) =>
  send<{ agent: AgentDetail }>(`/api/chat/agents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

/** Delete, once archived (§B item 7): its runs, chats and files stay. */
export const deleteAgent = (id: string) => send(`/api/chat/agents/${id}`, { method: 'DELETE' });
