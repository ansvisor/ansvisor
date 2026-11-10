/**
 * What keeps secrets out of PostHog's events, heatmaps and session replays (SEC-10a).
 *
 * In a replay, an element with the `ph-no-capture` class is left out: the
 * viewer sees an empty box of the same size. Every place that shows a secret
 * carries it (replay-masking-coverage.test.ts), and password fields get it
 * from Input and PasswordInput. Inputs are masked whatever the PostHog
 * project says, and the URLs sent with events and replays lose an invite's
 * token, the invited address and sign-in codes.
 */

import type { CaptureResult, CapturedNetworkRequest, SessionRecordingOptions } from 'posthog-js';

/** Query parameters that carry a secret or a person's address. */
const SECRET_PARAMS = [
  'invite',
  'email',
  'token',
  'code',
  'token_hash',
  'access_token',
  'refresh_token',
];

/** Event properties that hold a URL or a path: $current_url, $referrer, $pathname… */
const URL_PROPERTY = /(url|referrer|pathname|href)$/i;

/** An invitation's token in a path (/invite/<token>), also inside ?next=. */
function hideInviteToken(value: string): string {
  return value.replace(/(\/invite\/)[^/?#&]+/g, '$1[token]');
}

function dropSecretParams(params: URLSearchParams): boolean {
  let changed = false;
  for (const name of SECRET_PARAMS) {
    if (params.has(name)) {
      params.delete(name);
      changed = true;
    }
  }
  for (const [name, value] of [...params]) {
    const hidden = hideInviteToken(value);
    if (hidden !== value) {
      params.set(name, hidden);
      changed = true;
    }
  }
  return changed;
}

/**
 * A URL or path without its secrets: the parameters above are dropped, from
 * the query and from a `#a=b` fragment, and an invite's token in the path
 * becomes `[token]`. Anything else comes back as it was.
 */
export function scrubUrl(value: string): string {
  if (!/[?#]|\/invite\//.test(value)) return value;
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(value);
  let url: URL;
  try {
    url = new URL(value, 'https://placeholder.invalid');
  } catch {
    return value;
  }
  let changed = false;

  const path = hideInviteToken(url.pathname);
  if (path !== url.pathname) {
    url.pathname = path;
    changed = true;
  }
  const query = new URLSearchParams(url.search);
  if (dropSecretParams(query)) {
    url.search = query.toString();
    changed = true;
  }
  if (url.hash.includes('=')) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (dropSecretParams(fragment)) {
      url.hash = fragment.toString();
      changed = true;
    }
  }

  if (!changed) return value;
  return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

function scrubProperties(properties: Record<string, unknown> | undefined): void {
  if (!properties) return;
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'string' && URL_PROPERTY.test(key)) properties[key] = scrubUrl(value);
  }
}

/**
 * The heatmap's points are kept by the page's address (`$heatmap_data`:
 * { url: points }), which PostHog takes as it is: each address loses its
 * secrets too, and two that become the same share their points.
 */
function scrubHeatmapData(properties: Record<string, unknown> | undefined): void {
  const data = properties?.$heatmap_data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const scrubbed: Record<string, unknown[]> = {};
  for (const [url, points] of Object.entries(data as Record<string, unknown>)) {
    const key = scrubUrl(url);
    const list = Array.isArray(points) ? points : [];
    scrubbed[key] = [...(scrubbed[key] ?? []), ...list];
  }
  properties.$heatmap_data = scrubbed;
}

/** PostHog's before_send: each event's URLs, and the person's, without secrets. */
export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  scrubProperties(event.properties);
  scrubHeatmapData(event.properties);
  scrubProperties(event.properties?.$set);
  scrubProperties(event.properties?.$set_once);
  scrubProperties(event.$set);
  scrubProperties(event.$set_once);
  return event;
}

/**
 * The replay's URLs (each page's address, and a request's if network
 * recording is on) without secrets. A request's bodies are never kept:
 * PostHog's own body scrubbing stops once this function is set, and a body
 * can hold a new API key.
 */
export function scrubNetworkRequest(request: CapturedNetworkRequest): CapturedNetworkRequest {
  return {
    ...request,
    name: typeof request.name === 'string' ? scrubUrl(request.name) : request.name,
    requestBody: undefined,
    responseBody: undefined,
  };
}

/**
 * Session replay options. `maskAllInputs` is set here so the PostHog project
 * can't turn it off (a setting made in code wins). No `maskTextSelector`: it
 * would replace the project's own text masking; text to mask takes the
 * `ph-mask` class, and a secret `ph-no-capture`.
 */
export const REPLAY_OPTIONS: SessionRecordingOptions = {
  blockClass: 'ph-no-capture',
  maskTextClass: 'ph-mask',
  maskAllInputs: true,
  maskCapturedNetworkRequestFn: scrubNetworkRequest,
};

/**
 * An invitation link sends a signed-out person to sign-up with its token and
 * the invited address (`?invite=…&email=…&next=/invite/…`). Once read, they
 * leave the address bar: the address it should have instead, or null when
 * there is nothing to take out.
 */
export function stripInviteParams(href: string): string | null {
  const url = new URL(href, 'https://placeholder.invalid');
  const params = url.searchParams;
  if (!params.has('invite') && !params.has('email')) return null;
  params.delete('invite');
  params.delete('email');
  const next = params.get('next');
  if (next && hideInviteToken(next) !== next) params.delete('next');
  return `${url.pathname}${url.search}${url.hash}`;
}
