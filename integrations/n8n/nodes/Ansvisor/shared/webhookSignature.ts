import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookVerificationInput {
  event: string;
  secret: string;
  receivedSecret: string | undefined;
  rawBody?: Buffer;
  signature: string | undefined;
}

function constantTimeStringEqual(expected: string, received: string | undefined): boolean {
  if (typeof received !== 'string') return false;

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

/**
 * Ansvisor sends X-Webhook-Secret for every configured webhook.
 * content_draft.sent additionally carries an HMAC-SHA256 of the exact raw body.
 */
export function verifyAnsvisorWebhook(input: WebhookVerificationInput): boolean {
  if (!input.secret || !constantTimeStringEqual(input.secret, input.receivedSecret)) {
    return false;
  }

  if (input.event !== 'content_draft.sent') {
    return true;
  }

  if (!input.rawBody || !input.signature) return false;

  const expectedSignature = `sha256=${createHmac('sha256', input.secret)
    .update(input.rawBody)
    .digest('hex')}`;

  return constantTimeStringEqual(expectedSignature, input.signature);
}
