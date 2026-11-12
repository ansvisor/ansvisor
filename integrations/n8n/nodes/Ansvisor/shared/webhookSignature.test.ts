import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyAnsvisorWebhook } from './webhookSignature';

const secret = 'brand-webhook-secret';

function signatureFor(body: Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyAnsvisorWebhook', () => {
  it('accepts a valid shared secret for ordinary events', () => {
    expect(
      verifyAnsvisorWebhook({
        event: 'daily_pulse.created',
        secret,
        receivedSecret: secret,
        signature: undefined,
      }),
    ).toBe(true);
  });

  it('rejects missing and incorrect shared secrets', () => {
    const base = {
      event: 'daily_pulse.created',
      secret,
      signature: undefined,
    };

    expect(verifyAnsvisorWebhook({ ...base, receivedSecret: undefined })).toBe(false);
    expect(verifyAnsvisorWebhook({ ...base, receivedSecret: 'wrong-secret' })).toBe(false);
  });

  it('requires the HMAC signature for content_draft.sent', () => {
    const rawBody = Buffer.from('{"event":"content_draft.sent"}');

    expect(
      verifyAnsvisorWebhook({
        event: 'content_draft.sent',
        secret,
        receivedSecret: secret,
        rawBody,
        signature: undefined,
      }),
    ).toBe(false);
  });

  it('accepts a valid HMAC over the exact raw body', () => {
    const rawBody = Buffer.from('{ "event": "content_draft.sent" }');

    expect(
      verifyAnsvisorWebhook({
        event: 'content_draft.sent',
        secret,
        receivedSecret: secret,
        rawBody,
        signature: signatureFor(rawBody),
      }),
    ).toBe(true);
  });

  it('rejects a signature for a modified or differently serialized body', () => {
    const signedBody = Buffer.from('{"event":"content_draft.sent"}');
    const receivedBody = Buffer.from('{ "event": "content_draft.sent" }');

    expect(
      verifyAnsvisorWebhook({
        event: 'content_draft.sent',
        secret,
        receivedSecret: secret,
        rawBody: receivedBody,
        signature: signatureFor(signedBody),
      }),
    ).toBe(false);
  });

  it('rejects an incorrect HMAC signature', () => {
    const rawBody = Buffer.from('{"event":"content_draft.sent"}');

    expect(
      verifyAnsvisorWebhook({
        event: 'content_draft.sent',
        secret,
        receivedSecret: secret,
        rawBody,
        signature: 'sha256=' + '0'.repeat(64),
      }),
    ).toBe(false);
  });
});
