const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getBaseUrl, apiRequest } = require('../lib/api');
const authModule = require('../authentication');
const creates = require('../creates');
const { findBrand } = require('../searches');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

function mockZapier(responseJson) {
  const calls = [];
  const z = {
    request: async (options) => {
      calls.push(options);
      return { status: 200, json: responseJson, throwForStatus() {} };
    },
  };
  return { z, calls };
}

const bundle = {
  authData: { api_key: 'ans_test_key', base_url: 'https://app.ansvisor.com/' },
  inputData: { brand_id: 'brand-123', date_from: '2026-11-01', date_to: '2026-11-08' },
};

test('uses the cloud URL by default and accepts a self-hosted HTTPS origin', () => {
  assert.equal(getBaseUrl({ authData: {} }), 'https://app.ansvisor.com');
  assert.equal(getBaseUrl({ authData: { base_url: 'https://ansvisor.example.test/' } }), 'https://ansvisor.example.test');
});

test('rejects insecure non-local API base URLs and URLs with embedded credentials', () => {
  assert.throws(() => getBaseUrl({ authData: { base_url: 'http://ansvisor.example.test' } }), /must use HTTPS/);
  assert.throws(() => getBaseUrl({ authData: { base_url: 'https://user:pass@ansvisor.example.test' } }), /must not contain credentials/);
});

test('adds the API key only as a Bearer authorization header', () => {
  const request = { headers: { Accept: 'application/json' } };
  authModule.includeApiKey(request, null, { authData: { api_key: 'ans_private_test' } });
  assert.equal(request.headers.Authorization, 'Bearer ans_private_test');
  assert.equal(request.headers.Accept, 'application/json');
});

test('authentication test calls the documented whoami endpoint', async () => {
  const { z, calls } = mockZapier({ userId: 'user-123', organizationName: 'Acme' });
  const result = await authModule.authentication.test(z, bundle);
  assert.equal(result.userId, 'user-123');
  assert.equal(calls[0].url, 'https://app.ansvisor.com/api/v1/whoami');
  assert.equal(calls[0].method, 'GET');
});

test('visibility summary calls the documented endpoint with supported filters', async () => {
  const { z, calls } = mockZapier(fixture('visibility-summary.json'));
  await creates.visibilitySummary(z, {
    ...bundle,
    inputData: { ...bundle.inputData, model: 'chatgpt,claude', region: 'US' },
  });
  assert.equal(calls[0].url, 'https://app.ansvisor.com/api/v1/visibility-summary');
  assert.deepEqual(calls[0].params, {
    brand_id: 'brand-123', date_from: '2026-11-01', date_to: '2026-11-08',
    model: 'chatgpt,claude', region: 'US',
  });
});

test('visibility trend passes granularity and topic filters', async () => {
  const { z, calls } = mockZapier(fixture('visibility-trend.json'));
  await creates.visibilityTrend(z, {
    ...bundle,
    inputData: { ...bundle.inputData, granularity: 'week', topic_id: 'topic-123' },
  });
  assert.equal(calls[0].url, 'https://app.ansvisor.com/api/v1/visibility-trend');
  assert.equal(calls[0].params.granularity, 'week');
  assert.equal(calls[0].params.topic_id, 'topic-123');
});

test('citations passes the documented source filter and limit', async () => {
  const { z, calls } = mockZapier(fixture('citations.json'));
  await creates.citations(z, {
    ...bundle,
    inputData: { ...bundle.inputData, source_filter: 'external', limit: 25 },
  });
  assert.equal(calls[0].url, 'https://app.ansvisor.com/api/v1/citations');
  assert.equal(calls[0].params.source_filter, 'external');
  assert.equal(calls[0].params.limit, 25);
});

test('AI traffic sends only the supported brand and date parameters', async () => {
  const { z, calls } = mockZapier(fixture('ai-traffic.json'));
  await creates.aiTraffic(z, bundle);
  assert.equal(calls[0].url, 'https://app.ansvisor.com/api/v1/ai-traffic');
  assert.deepEqual(calls[0].params, {
    brand_id: 'brand-123', date_from: '2026-11-01', date_to: '2026-11-08',
  });
});

test('brand search filters the brands returned by the API', async () => {
  const { z, calls } = mockZapier(fixture('brands.json'));
  const results = await findBrand(z, { ...bundle, inputData: { query: 'north' } });
  assert.equal(calls[0].url, 'https://app.ansvisor.com/api/v1/brands');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'brand-456');
});

test('API requests remove empty filters without dropping valid values', async () => {
  const { z, calls } = mockZapier({ ok: true });
  await apiRequest(z, bundle, 'visibility-summary', {
    brand_id: 'brand-123', date_from: '', date_to: undefined, limit: 0,
  });
  assert.deepEqual(calls[0].params, { brand_id: 'brand-123', limit: 0 });
});

test('metrics actions require a brand id', () => {
  const { z } = mockZapier({});
  assert.throws(
    () => creates.visibilitySummary(z, { ...bundle, inputData: {} }),
    /Choose a brand/,
  );
});
