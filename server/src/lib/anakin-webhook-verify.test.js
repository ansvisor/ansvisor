import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { verifyAnakinWebhook } from './anakin-webhook-verify.js';

/** Anakin signs the raw body: `X-Anakin-Signature: sha256=<hex HMAC-SHA256>`. */
const secret = 'whsec_abc';
const rawBody = Buffer.from('{"type":"wire.job.completed","data":{"jobId":"j1"}}');
const signature = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;

describe('verifyAnakinWebhook', () => {
  it('accepts the body as signed', () => {
    expect(verifyAnakinWebhook({ rawBody, signatureHeader: signature, secret })).toEqual({
      ok: true,
    });
  });

  it('refuses a missing signature, another secret, or a changed body', () => {
    expect(verifyAnakinWebhook({ rawBody, signatureHeader: undefined, secret })).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      verifyAnakinWebhook({ rawBody, signatureHeader: signature, secret: 'whsec_other' }),
    ).toMatchObject({ ok: false, reason: 'signature mismatch' });
    expect(
      verifyAnakinWebhook({
        rawBody: Buffer.from(`${rawBody} `),
        signatureHeader: signature,
        secret,
      }),
    ).toMatchObject({ ok: false, reason: 'signature mismatch' });
    expect(verifyAnakinWebhook({ rawBody, signatureHeader: 'sha256=abc', secret })).toMatchObject({
      ok: false,
    });
  });
});
