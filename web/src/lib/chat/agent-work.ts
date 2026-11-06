/**
 * Agent work (AC-011, ROADMAP-plan §06): how far a workspace's agents go
 * without a person, set by an Admin from the gear on Action Center › Today
 * or in Settings › Chat (chat_settings.agent_work, 00481).
 *
 *   * I approve first (the default): every change an agent's run makes waits
 *     for a person's approval card, whatever the agent's own mode. The
 *     approval precedence applies it (precedence.ts, step 5), as it applies
 *     Ask me first: there is no other gate.
 *   * Agent starts on its own: each agent's own mode applies (Ask me first ·
 *     Auto · Full auto, Full auto Growth and up).
 *
 * Going live is never affected: it stays under the go-live switches and a
 * person's click. Every change is kept with who made it and when
 * (setting_changes, 00481).
 */

export const AGENT_WORK = ['approve_first', 'auto_start'] as const;
export type AgentWork = (typeof AGENT_WORK)[number];

/** Every workspace starts here, and a value that can't be read counts as it: the careful side. */
export const DEFAULT_AGENT_WORK: AgentWork = 'approve_first';

/** The key its changes are kept under (setting_changes.setting_key). */
export const AGENT_WORK_KEY = 'agent_work';

export function isAgentWork(value: unknown): value is AgentWork {
  return AGENT_WORK.some((choice) => choice === value);
}

/** A stored value, or the default for anything else. */
export function parseAgentWork(value: unknown): AgentWork {
  return isAgentWork(value) ? value : DEFAULT_AGENT_WORK;
}

/** The last change, as the panel says it: "Changed by Cihan Geyik · Oct 22, 2026". */
export interface AgentWorkChange {
  /** Their name, else their e-mail; null when the person is gone. */
  byName: string | null;
  at: string;
  from: AgentWork | null;
  to: AgentWork;
}

/** The setting as the gear and Settings › Chat show it. */
export interface AgentWorkView {
  value: AgentWork;
  /** An Admin: everyone else reads it. Saving still needs an active plan (read_only). */
  canChange: boolean;
  lastChange: AgentWorkChange | null;
}
