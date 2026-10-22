/**
 * Why a call to the API failed, read from its status and body (BUG-001), so a
 * toast or an MCP client can say it in plain words with one thing to do. A
 * bare "Unauthorized" read as a session problem when the brand was another
 * workspace's: 401 is a bad or expired session only.
 */
export const API_FAILURES = [
  'session',
  'workspace',
  'not_found',
  'plan',
  'limit',
  'failed',
] as const;
export type ApiFailure = (typeof API_FAILURES)[number];

export function apiFailure(status: number, body: { error?: unknown } = {}): ApiFailure {
  if (status === 401) return 'session';
  if (status === 429 || body.error === 'quota_exhausted') return 'limit';
  // The plan check answers 403 too (requireFeature), with its own code.
  if (status === 402 || body.error === 'plan_limit') return 'plan';
  if (status === 403) return 'workspace';
  if (status === 404) return 'not_found';
  return 'failed';
}
