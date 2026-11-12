/**
 * Ads (the Drive Ads spec, ADS-01) behind ADS_ENABLED, while it is built: the
 * API server's side of the web's lib/ads/flag.ts, read the same way.
 *
 * Off unless exactly "true". Nobody sees Ads in production until the owner
 * launches it (owner, 2026-11-10): production leaves the variable unset;
 * local development and preview deployments set it to try the area. There is
 * no list of workspaces or people to turn it on for, unlike CHAT_AGENTIC_ORGS
 * (chat-flag.js): it is on for everyone on the install or for no one. Off,
 * every /api/ads path is not found (routes/ads.js). Set the web's ADS_ENABLED
 * to the same value.
 *
 * Read from the environment each time it is asked; the process sees a change
 * when it starts again (a restart or a new deployment).
 *
 * @param {NodeJS.ProcessEnv} [env] the variables to read (tests); the process's by default
 * @returns {boolean}
 */
export function adsEnabled(env = process.env) {
  return env.ADS_ENABLED === 'true';
}
