/**
 * A server refusal as a message key (LOC-008). The API answers in English
 * with a stable code (`code`, or `error` for the older plan_limit and
 * quota_exhausted); the UI says it in the person's language, so the toast
 * is looked up by code here rather than showing the server's own sentence.
 * Only the most-seen refusals are mapped (plan limits, a read-only
 * workspace, not found, validation, rate limits); any other answer has no
 * key and its caller keeps what it showed before.
 */

/** Codes whose words live in the `serverErrors` messages. */
export const SERVER_ERROR_CODES = [
  'invalid',
  'too_large',
  'too_long',
  'rate_limited',
  'forbidden',
  'duplicate',
  'missing_ai_key',
  'server_error',
] as const;
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

const isServerErrorCode = (value: string): value is ServerErrorCode =>
  (SERVER_ERROR_CODES as readonly string[]).includes(value);

/**
 * The message key (from the messages root) for a response body, or null when
 * the body names no refusal we map. `status` tells a used-up allowance
 * (429) from a plan without the feature when the body says only plan_limit.
 */
export function serverErrorKey(body: unknown, status = 0): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const { code, error } = body as { code?: unknown; error?: unknown };
  const c = typeof code === 'string' ? code : '';
  const e = typeof error === 'string' ? error : '';

  // The same words as the toasts of useFailureToast (apiFailure).
  if (c === 'subscription_inactive' || c === 'demo_brand') return 'apiFailure.subscription';
  if (c === 'not_in_workspace' || c === 'no_brand_access') return 'apiFailure.workspace';
  if (c === 'not_found') return 'apiFailure.not_found';
  if (e === 'quota_exhausted' || (e === 'plan_limit' && status === 429)) return 'apiFailure.limit';
  if (e === 'plan_limit' || c === 'plan_limit') return 'apiFailure.plan';

  if (c === 'rate_limited' || e === 'rate_limited') return 'serverErrors.rate_limited';
  if (isServerErrorCode(c)) return `serverErrors.${c}`;
  return null;
}
