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
  // The demo brand's sample data can't be changed (DEMO_BRAND, lib/subscription-guard.ts).
  'demo_brand',
  // An Admin-only change by someone else (requireAdmin in the team and organization actions).
  'admin_required',
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
  const { code, error, digest, limit } = body as {
    code?: unknown;
    error?: unknown;
    digest?: unknown;
    limit?: unknown;
  };
  // A server action that threw keeps only its digest in production, which
  // assertWritable's refusals set to their code (lib/subscription-guard.ts).
  const c = typeof code === 'string' ? code : typeof digest === 'string' ? digest : '';
  const e = typeof error === 'string' ? error : '';

  // The same words as the toasts of useFailureToast (apiFailure).
  if (c === 'subscription_inactive') return 'apiFailure.subscription';
  if (c === 'not_in_workspace' || c === 'no_brand_access') return 'apiFailure.workspace';
  if (c === 'not_found') return 'apiFailure.not_found';
  // The plan's prompt locations are full (locationLimitMessage): a count, not a missing feature.
  if (c === 'plan_limit' && limit === 'locations') return 'serverErrors.location_limit';
  // Every brand the plan includes is in use (createBrand).
  if (c === 'plan_limit' && limit === 'brands') return 'serverErrors.brand_limit';
  if (e === 'quota_exhausted' || (e === 'plan_limit' && status === 429)) return 'apiFailure.limit';
  if (e === 'plan_limit' || c === 'plan_limit') return 'apiFailure.plan';

  if (c === 'rate_limited' || e === 'rate_limited') return 'serverErrors.rate_limited';
  // A role the person doesn't have (prompt-swap's not_allowed, the competitor actions'
  // forbidden_role, the MCP role gate's role_required).
  if (c === 'not_allowed' || c === 'forbidden_role' || c === 'role_required') {
    return 'serverErrors.forbidden';
  }
  // The plan routes' Admin-only refusal says the same.
  if (c === 'admin_only') return 'serverErrors.admin_required';
  if (isServerErrorCode(c)) return `serverErrors.${c}`;
  return null;
}

/**
 * A refused call as an error to throw: its message is the body's `error`
 * (else `fallback`), and it keeps the body's stable code and the status, so
 * the `catch` that shows it (useCaughtErrorText) can still say a mapped
 * refusal in the person's language.
 */
export function refusalError(body: unknown, fallback: string, status = 0): Error {
  const { code, error, limit } = (typeof body === 'object' && body !== null ? body : {}) as {
    code?: unknown;
    error?: unknown;
    limit?: unknown;
  };
  const message = typeof error === 'string' && error ? error : fallback;
  return Object.assign(new Error(message), { code, error, limit, status });
}

/**
 * What a caught error says when no code maps it: its own message for an
 * error thrown in the browser (a failed fetch), else `fallback`. A server
 * action's thrown error carries a digest, and production replaces its
 * message with Next's English notice, so the caller's translated words
 * read better than either.
 */
export function caughtErrorText(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  if (typeof (err as Error & { digest?: unknown }).digest === 'string') return fallback;
  return err.message || fallback;
}
