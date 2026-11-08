const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createWebhookPerform, verifyWebhookRequest } = require('../lib/webhook');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const SECRET = 'brand-webhook-secret-for-tests';

function makeBundle(payload, options = {}) {
  const content = options.content || JSON.stringify(payload);
  const headers = Object.assign(
    { 'X-Webhook-Secret': options.receivedSecret === undefined ? SECRET : options.receivedSecret },
    options.headers || {},
  );
  if (payload.event === 'content_draft.sent' && options.sign !== false) {
    const signature = crypto.createHmac('sha256', SECRET).update(content, 'utf8').digest('hex');
    if (!Object.prototype.hasOwnProperty.call(options.headers || {}, 'X-Ansvisor-Signature')) {
      headers['X-Ansvisor-Signature'] = 'sha256=' + signature;
    }
  }
  return {
    authData: { webhook_secret: options.configuredSecret === undefined ? SECRET : options.configuredSecret },
    rawRequest: { method: 'POST', headers, content },
  };
}

test('Daily Pulse trigger accepts the documented event and adds a stable Zapier id', () => {
  const result = createWebhookPerform('daily_pulse.created')({}, makeBundle(fixture('daily-pulse.json')));
  assert.equal(result.length, 1);
  assert.equal(result[0].event, 'daily_pulse.created');
  assert.equal(result[0].id, 'brand-123:2026-11-08');
});

test('Action Center trigger accepts the documented task event', () => {
  const result = createWebhookPerform('action_task.sent')({}, makeBundle(fixture('action-task.json')));
  assert.equal(result[0].id, 'task-123');
  assert.equal(result[0].task.title, 'Update the shipping guide');
});

test('Content Draft trigger verifies HMAC over the exact raw request body', () => {
  const result = createWebhookPerform('content_draft.sent')({}, makeBundle(fixture('content-draft.json')));
  assert.equal(result[0].id, 'delivery-123');
  assert.equal(result[0].page.title, 'A practical guide');
});

test('Ansvisor test deliveries are accepted by each event trigger', () => {
  for (const event of ['daily_pulse.created', 'content_draft.sent', 'action_task.sent']) {
    const result = createWebhookPerform(event)({}, makeBundle(fixture('webhook-test.json')));
    assert.equal(result[0].event, 'webhook.test');
    assert.match(result[0].id, /^[a-f0-9]{64}$/);
  }
});

test('rejects a missing configured webhook secret', () => {
  assert.throws(
    () => verifyWebhookRequest(makeBundle(fixture('daily-pulse.json'), { configuredSecret: '' }), 'daily_pulse.created'),
    /Add this brand’s webhook secret/,
  );
});

test('rejects a missing or mismatched X-Webhook-Secret header', () => {
  assert.throws(
    () => verifyWebhookRequest(makeBundle(fixture('daily-pulse.json'), { receivedSecret: 'wrong-secret' }), 'daily_pulse.created'),
    /did not match/,
  );
});

test('rejects malformed JSON and events sent to the wrong trigger', () => {
  const payload = fixture('daily-pulse.json');
  assert.throws(
    () => verifyWebhookRequest(makeBundle(payload, { content: '{not-json' }), 'daily_pulse.created'),
    /not valid JSON/,
  );
  assert.throws(
    () => verifyWebhookRequest(makeBundle(payload), 'action_task.sent'),
    /different Ansvisor event/,
  );
});

test('rejects Content Draft events without the additional HMAC signature', () => {
  assert.throws(
    () => verifyWebhookRequest(makeBundle(fixture('content-draft.json'), { sign: false }), 'content_draft.sent'),
    /signature is missing or invalid/,
  );
});

test('rejects an invalid Content Draft signature', () => {
  assert.throws(
    () => verifyWebhookRequest(makeBundle(fixture('content-draft.json'), {
      sign: false,
      headers: { 'X-Ansvisor-Signature': 'sha256=' + '0'.repeat(64) },
    }), 'content_draft.sent'),
    /signature is missing or invalid/,
  );
});

test('rejects a body changed after its Content Draft signature was created', () => {
  const payload = fixture('content-draft.json');
  const bundle = makeBundle(payload);
  bundle.rawRequest.content = bundle.rawRequest.content.replace('A practical guide', 'A modified guide');
  assert.throws(
    () => verifyWebhookRequest(bundle, 'content_draft.sent'),
    /signature is missing or invalid/,
  );
});

test('does not require the additional HMAC header for other webhook event types', () => {
  const bundle = makeBundle(fixture('action-task.json'), { headers: { 'X-Ansvisor-Signature': undefined } });
  assert.equal(verifyWebhookRequest(bundle, 'action_task.sent').event, 'action_task.sent');
});

test('a webhook.test delivery does not require the Content Draft HMAC header', () => {
  const bundle = makeBundle(fixture('webhook-test.json'));
  assert.equal(createWebhookPerform('content_draft.sent')({}, bundle)[0].event, 'webhook.test');
});
