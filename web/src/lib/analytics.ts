/**
 * Thin wrapper around PostHog that no-ops when PostHog is not configured.
 *
 * Cloud (`app.ansvisor.com`) sets NEXT_PUBLIC_POSTHOG_KEY in Vercel env, so
 * the provider boots PostHog at startup. Self-hosted instances leave the
 * env var unset by default, which means PostHog never initialises and these
 * helpers compile down to cheap no-ops — no network, no bundle on the wire.
 *
 * Always use these helpers (`track`, `identify`, `reset`) instead of importing
 * `posthog-js` directly so adding a new event in a route doesn't accidentally
 * leak telemetry from a self-hosted build.
 */

import type { PostHogInterface } from 'posthog-js';

declare global {
  interface Window {
    __ansvisor_posthog__?: PostHogInterface;
  }
}

function getClient(): PostHogInterface | null {
  if (typeof window === 'undefined') return null;
  return window.__ansvisor_posthog__ ?? null;
}

export function track(
  event: string,
  properties?: Record<string, unknown>,
): void {
  getClient()?.capture(event, properties);
}

export function identify(
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  getClient()?.identify(distinctId, properties);
}

export function reset(): void {
  getClient()?.reset();
}

/**
 * Set properties on the current person without sending an event.
 * Useful for hydrating subscription_status, plan_id, org_id once after login.
 */
export function setPersonProperties(
  properties: Record<string, unknown>,
): void {
  getClient()?.setPersonProperties(properties);
}
