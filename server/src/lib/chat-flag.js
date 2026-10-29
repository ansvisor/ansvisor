/**
 * The new Chat (the Drive Chat specs, CHAT-00…25) behind CHAT_AGENTIC.
 *
 * Read each time it is asked, so a restart picks up a change. Off unless
 * "true", so a self-hosted install — or the cloud with it unset — keeps
 * today's agent and sees nothing new. With it on, CHAT_AGENTIC_ORGS
 * (organization ids, comma-separated) narrows it to those workspaces; unset
 * or empty, it is on for every one. The web's lib/chat/flag.ts reads the same
 * two variables the same way.
 *
 * @param {string | null | undefined} [organizationId]
 * @returns {boolean}
 */
export function chatAgenticEnabled(organizationId) {
  if (process.env.CHAT_AGENTIC !== 'true') return false;
  const orgs = chatAgenticOrgs();
  if (orgs.length === 0) return true;
  return !!organizationId && orgs.includes(String(organizationId).trim().toLowerCase());
}

/** CHAT_AGENTIC_ORGS as a list: trimmed, lower-cased, blanks dropped. */
function chatAgenticOrgs() {
  return (process.env.CHAT_AGENTIC_ORGS ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}
