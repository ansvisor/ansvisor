/**
 * Ads (the Drive Ads spec, ADS-01) behind ADS_ENABLED, while it is built.
 *
 * Off unless "true". Ads is in development, and nobody sees it in production
 * until the owner launches it (owner, 2026-11-10): production leaves the
 * variable unset; local development and preview deployments set it to try
 * the area. There is no list of workspaces or people to turn it on for: it
 * is on for everyone on the install or for no one. Off, ANALYTICS › Ads is
 * on no menu and in no list of the menu's sections, Chat can't open it, and
 * /dashboard/ads is not found.
 *
 * Read from the process's environment each time it is asked, as
 * CHAT_AGENTIC is (lib/chat/flag.ts): not a NEXT_PUBLIC_ variable, so
 * nothing is written into the browser's code, where it is always off. The
 * dashboard's layout reads it on the server and hands the answer down
 * (AdsProvider). The process sees a change only when it starts again: a
 * restart self-hosted, a new deployment on Vercel. The API server reads the
 * same variable the same way (server/src/lib/ads-flag.js): off, every
 * /api/ads path is not found. Set both to the same value.
 */
export function adsEnabled(): boolean {
  return process.env.ADS_ENABLED === 'true';
}
