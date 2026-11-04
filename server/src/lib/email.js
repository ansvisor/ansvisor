import { logger } from './logger.js';

/** The most an e-mail's attachments may weigh together, decoded: under Resend's 40 MB. */
export const ATTACHMENTS_MAX_BYTES = 10 * 1024 * 1024;

/**
 * The sender, with a display name in place of the configured one when
 * given (a white label kit's company): `"Acme Agency" <hello@ansvisor.com>`.
 * The address is always RESEND_FROM_EMAIL's own.
 */
export function senderOf(from, fromName) {
  if (!fromName) return from;
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from.trim();
  const name = String(fromName)
    .replace(/[\r\n"<>\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return name ? `"${name}" <${address}>` : from;
}

/** Decoded size of a base64 text, in bytes. */
const base64Bytes = (text) => {
  const clean = String(text ?? '').replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
};

/**
 * Send one email through the Resend HTTP API (RESEND_API_KEY,
 * RESEND_FROM_EMAIL) and say what became of it, with Resend's id when it
 * was accepted:
 *   - 'sent': Resend accepted it;
 *   - 'refused': Resend answered with an error, so nothing went out;
 *   - 'unknown': no answer (the 15 s timeout, a dropped connection), and
 *     Resend may have sent it all the same;
 *   - 'skipped': not configured or no recipients. Missing config is a silent
 *     no-op, so self-host and misconfigured environments never fail a caller.
 * `replyTo`, when given, is where a reply goes instead of the sender;
 * `from` sends from another address than RESEND_FROM_EMAIL (it must be on
 * a domain Resend has verified: the report card's own sender);
 * `fromName` the sender's display name (senderOf); `attachments`
 * ({ filename, content: base64 }) go with it, refused as a whole past
 * ATTACHMENTS_MAX_BYTES.
 */
export async function deliverEmailWithId({
  to,
  subject,
  html,
  headers,
  replyTo,
  from: sender,
  fromName,
  attachments,
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = sender || process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !to.length) return { status: 'skipped', id: null };
  const files = (attachments ?? []).filter((file) => file?.filename && file?.content);
  if (files.reduce((sum, file) => sum + base64Bytes(file.content), 0) > ATTACHMENTS_MAX_BYTES) {
    logger.warn({ files: files.length }, 'resend send refused: attachments too large');
    return { status: 'refused', id: null };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: senderOf(from, fromName),
        to,
        subject,
        html,
        ...(headers ? { headers } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(files.length
          ? { attachments: files.map(({ filename, content }) => ({ filename, content })) }
          : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: body.slice(0, 500) }, 'resend send failed');
      return { status: 'refused', id: null };
    }
    const body = await res.text().catch(() => '');
    let id = null;
    try {
      const parsed = JSON.parse(body);
      id = typeof parsed?.id === 'string' ? parsed.id.slice(0, 200) : null;
    } catch {
      id = null;
    }
    return { status: 'sent', id };
  } catch (err) {
    logger.warn({ err }, 'resend send errored');
    return { status: 'unknown', id: null };
  }
}

/** deliverEmailWithId's outcome alone (above). */
export async function deliverEmail(message) {
  return (await deliverEmailWithId(message)).status;
}

/** deliverEmail as a yes or no: true when Resend accepted it. */
export async function sendEmail(message) {
  return (await deliverEmail(message)) === 'sent';
}
