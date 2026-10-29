/**
 * The new Chat (the Drive Chat specs, CHAT-00…25) behind CHAT_AGENTIC.
 *
 * Read on the server each time it is asked, never baked into the build: the
 * same build runs with Chat on or off, and a restart picks up a change. Off
 * unless "true", so a self-hosted install — or the cloud with it unset —
 * keeps today's /dashboard/agent and sees nothing new. With it on,
 * CHAT_AGENTIC_ORGS (organization ids, comma-separated) narrows it to those
 * workspaces; unset or empty, it is on for every one. The API server's
 * lib/chat-flag.js reads the same two variables the same way.
 *
 * Server code only: the browser has neither variable, so there it is off.
 */
export function chatAgenticEnabled(organizationId?: string | null): boolean {
  if (process.env.CHAT_AGENTIC !== 'true') return false;
  const orgs = chatAgenticOrgs();
  if (orgs.length === 0) return true;
  return !!organizationId && orgs.includes(organizationId.trim().toLowerCase());
}

/** CHAT_AGENTIC_ORGS as a list: trimmed, lower-cased, blanks dropped. */
function chatAgenticOrgs(): string[] {
  return (process.env.CHAT_AGENTIC_ORGS ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}
