import { logger } from './logger.js';

/**
 * Send one email through the Resend HTTP API (RESEND_API_KEY,
 * RESEND_FROM_EMAIL). Returns true when accepted. Missing config is a silent
 * no-op, so self-host and misconfigured environments never fail a caller.
 */
export async function sendEmail({ to, subject, html, headers }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !to.length) return false;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html, ...(headers ? { headers } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: body.slice(0, 500) }, 'resend send failed');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, 'resend send errored');
    return false;
  }
}
