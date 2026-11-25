import crypto from 'crypto';

/**
 * Verify a signed Anakin webhook delivery: `X-Anakin-Signature` is
 * `sha256=` and the hex HMAC-SHA256 of the raw body under the account's
 * signing secret (anakin.io/docs/api-reference/webhooks). Anakin signs no
 * timestamp, so there is no replay window to check; a repeated delivery
 * finds its pending task gone and stores nothing twice.
 *
 * Pure, like cloro-webhook-verify.js.
 *
 * @param {{ rawBody: Buffer|string, signatureHeader: string|undefined, secret: string }} params
 * @returns {{ ok: true } | { ok: false, status: number, reason: string }}
 */
export function verifyAnakinWebhook({ rawBody, signatureHeader, secret }) {
  if (!signatureHeader) return { ok: false, status: 401, reason: 'missing signature header' };
  const provided = String(signatureHeader).replace(/^sha256=/, '');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return { ok: false, status: 401, reason: 'signature mismatch' };
  }
  return { ok: true };
}
