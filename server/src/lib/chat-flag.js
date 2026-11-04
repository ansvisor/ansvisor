/**
 * The new Chat (the Drive Chat specs, CHAT-00…25) behind CHAT_AGENTIC.
 *
 * Read from the environment each time it is asked; the process sees a change
 * when it starts again (a restart or a new deployment). Off unless
 * "true", so a self-hosted install — or the cloud with it unset — keeps
 * today's agent and sees nothing new. With it on, CHAT_AGENTIC_ORGS
 * (organization ids, comma-separated) narrows it to those workspaces; unset
 * or empty, it is on for every one. The web's lib/chat/flag.ts reads the same
 * two variables the same way.
 *
 * @param {string | null | undefined} [organizationId]
 * @param {NodeJS.ProcessEnv} [env] the variables to read (tests); the process's by default
 * @returns {boolean}
 */
export function chatAgenticEnabled(organizationId, env = process.env) {
  if (!chatAgenticDeployed(env)) return false;
  return listed(chatAgenticOrgs(env), organizationId);
}

/**
 * Whether this deployment runs the new Chat at all, whichever workspaces it
 * is on for: what the server's own Chat jobs (the model price sync) start on.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function chatAgenticDeployed(env = process.env) {
  return env.CHAT_AGENTIC === 'true';
}

/**
 * CHAT_AGENTIC_ORGS as a list: trimmed, lower-cased, blanks dropped.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function chatAgenticOrgs(env = process.env) {
  return orgIds(env.CHAT_AGENTIC_ORGS);
}

/**
 * Agents that publish and send on their own (AUTONOMOUS-GO-LIVE §9) behind
 * CHAT_AUTO_GO_LIVE, on top of CHAT_AGENTIC: off unless "true", and
 * CHAT_AUTO_GO_LIVE_ORGS narrows it as CHAT_AGENTIC_ORGS does (unset or
 * empty: every workspace Chat is on for). Staff's rollout list and kill
 * switch on the cloud; a self-hosted operator's own opt-in. Off, the
 * internal go-live routes (routes/internal-chat-go-live.js) refuse every
 * step, whatever a workspace's own saved switch says. The web's
 * lib/chat/flag.ts reads the same two variables the same way: set both
 * sides to the same values.
 *
 * @param {string | null | undefined} [organizationId]
 * @param {NodeJS.ProcessEnv} [env] the variables to read (tests); the process's by default
 * @returns {boolean}
 */
export function autoGoLiveEnabled(organizationId, env = process.env) {
  if (!chatAgenticEnabled(organizationId, env)) return false;
  if (env.CHAT_AUTO_GO_LIVE !== 'true') return false;
  return listed(orgIds(env.CHAT_AUTO_GO_LIVE_ORGS), organizationId);
}

/** A comma-separated list of organization ids: trimmed, lower-cased, blanks dropped. */
function orgIds(value) {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether the organization is on a list; an empty list is every organization. */
function listed(orgs, organizationId) {
  if (orgs.length === 0) return true;
  return !!organizationId && orgs.includes(String(organizationId).trim().toLowerCase());
}
