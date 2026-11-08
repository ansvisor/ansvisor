const crypto = require('node:crypto');

function getHeader(headers, expectedName) {
  if (!headers || typeof headers !== 'object') return '';
  const key = Object.keys(headers).find((name) => name.toLowerCase() === expectedName.toLowerCase());
  if (!key) return '';
  const value = headers[key];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function safeEqualStrings(expected, received) {
  if (typeof expected !== 'string' || !expected || typeof received !== 'string' || !received) return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const receivedBytes = Buffer.from(received, 'utf8');
  return expectedBytes.length === receivedBytes.length && crypto.timingSafeEqual(expectedBytes, receivedBytes);
}

function verifyContentDraftSignature(rawBody, signature, secret) {
  if (typeof rawBody !== 'string' || typeof signature !== 'string') return false;
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const received = Buffer.from(signature.slice('sha256='.length), 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(expected, received);
}

function verifyWebhookRequest(bundle, expectedEvent) {
  const secret = bundle && bundle.authData && bundle.authData.webhook_secret;
  if (typeof secret !== 'string' || !secret) {
    throw new Error('Add this brand’s webhook secret to the Ansvisor connection before using this trigger.');
  }
  const rawRequest = bundle && bundle.rawRequest;
  if (!rawRequest || typeof rawRequest.content !== 'string') {
    throw new Error('Zapier did not provide the raw webhook body, so this event cannot be verified.');
  }
  const receivedSecret = getHeader(rawRequest.headers, 'x-webhook-secret');
  if (!safeEqualStrings(secret, receivedSecret)) {
    throw new Error('The Ansvisor webhook secret did not match. Check the secret saved for this brand.');
  }

  let payload;
  try { payload = JSON.parse(rawRequest.content); }
  catch { throw new Error('The Ansvisor webhook body was not valid JSON.'); }

  if (!payload || payload.event !== expectedEvent) {
    throw new Error('This trigger received a different Ansvisor event than the one it handles.');
  }
  if (expectedEvent === 'content_draft.sent') {
    const signature = getHeader(rawRequest.headers, 'x-ansvisor-signature');
    if (!verifyContentDraftSignature(rawRequest.content, signature, secret)) {
      throw new Error('The Content Editor webhook signature is missing or invalid.');
    }
  }
  return payload;
}

function addZapierId(payload, expectedEvent, rawBody) {
  let id;
  if (expectedEvent === 'daily_pulse.created') {
    id = [payload.brand && payload.brand.id, payload.pulse && payload.pulse.date].filter(Boolean).join(':');
  } else if (expectedEvent === 'content_draft.sent') {
    id = payload.delivery && payload.delivery.id;
    if (!id) id = payload.page && payload.page.draftId;
  } else if (expectedEvent === 'action_task.sent') {
    id = payload.task && payload.task.id;
  } else if (expectedEvent === 'webhook.test') {
    id = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
  }
  if (!id) throw new Error('The Ansvisor webhook did not contain the identifier required by Zapier.');
  return Object.assign({}, payload, { id: String(id) });
}

function createWebhookPerform(expectedEvent) {
  return (z, bundle) => {
    const payload = verifyWebhookRequest(bundle, expectedEvent);
    return [addZapierId(payload, expectedEvent, bundle.rawRequest.content)];
  };
}

module.exports = {
  getHeader, safeEqualStrings, verifyContentDraftSignature,
  verifyWebhookRequest, addZapierId, createWebhookPerform,
};
