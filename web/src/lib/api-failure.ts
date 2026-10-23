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
  'busy',
  'failed',
] as const;
export type ApiFailure = (typeof API_FAILURES)[number];

/**
 * Read from the server's own codes, not the status alone: a 403 is another
 * workspace's brand only when the server says so, and a 429 is a used-up
 * allowance only with quota_exhausted or plan_limit. Anything not
 * recognised is a plain failure rather than a wrong reason with a wrong
 * thing to do.
 */
export function apiFailure(status: number, body: Record<string, unknown> = {}): ApiFailure {
  if (status === 401) return 'session';
  if (body.error === 'quota_exhausted') return 'limit';
  // A monthly budget used up: plan-guard's PlanLimitError answers 429 with plan_limit.
  if (status === 429 && body.error === 'plan_limit') return 'limit';
  // The rate limiter, whose body carries a message and no error: wait a minute, not upgrade.
  if (status === 429 && body.error === undefined) return 'busy';
  // A missing subscription (402), or a plan without the feature: requireFeature's
  // 403 with plan_limit. Not plan-guard's 400 for an account with no organization.
  if (status === 402 || (status === 403 && body.error === 'plan_limit')) return 'plan';
  // The server's code since BUG-001; its bare "Unauthorized" 403 before then.
  if (body.code === 'not_in_workspace' || (status === 403 && body.error === 'Unauthorized')) {
    return 'workspace';
  }
  if (status === 404) return 'not_found';
  return 'failed';
}
