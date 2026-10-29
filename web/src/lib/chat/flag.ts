/**
 * The new Chat (the Drive Chat specs, CHAT-00…25) behind CHAT_AGENTIC.
 *
 * Off unless "true", so a self-hosted install — or the cloud with it unset —
 * keeps today's /dashboard/agent and sees nothing new. With it on,
 * CHAT_AGENTIC_ORGS (organization ids, comma-separated) narrows it to those
 * workspaces; unset or empty, it is on for every one. The API server's
 * lib/chat-flag.js reads the same two variables the same way.
 *
 * Read from the process's environment each time it is asked: not a
 * NEXT_PUBLIC_ variable, so nothing is written into the browser's code.
 * The process sees a change only when it starts again: self-hosted, a
 * restart; on Vercel, a new deployment (a changed environment variable
 * applies to the next deployment, not the running one).
 *
 * Dynamic server code only — route handlers, server actions, and pages and
 * layouts rendered per request. A page rendered at build time would keep the
 * build's value in its HTML; in the browser both variables are missing, so
 * there it is off.
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
