/**
 * The simplified layout (Sadeleştirme plan) behind SIMPLE_NAV, while it is
 * built.
 *
 * Off unless "true". The new menu, Action Center's Today · Actions · Signals
 * · Agents · History tabs and the landing on Today are built in steps, and
 * nobody sees them in production until the launch, which removes this
 * switch and the old layout. Production leaves the variable unset; local
 * development and preview deployments set it to try the new layout. There
 * is no list of workspaces or people to turn it on for: it is on for
 * everyone on the install or for no one. Off, every page, menu and landing
 * rule is as it was.
 *
 * Read from the process's environment each time it is asked, as
 * ADS_ENABLED is (lib/ads/flag.ts): not a NEXT_PUBLIC_ variable, so nothing
 * is written into the browser's code, where it is always off. The
 * dashboard's layout reads it on the server and hands the answer down
 * (SimpleNavProvider). The process sees a change only when it starts again:
 * a restart self-hosted, a new deployment on Vercel. Web only: the API
 * server has no copy, as nothing it answers changes with it.
 */
export function simpleNavEnabled(): boolean {
  return process.env.SIMPLE_NAV === 'true';
}
