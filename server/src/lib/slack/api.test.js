import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/**
 * Slack's Web API through Composio's proxy (#2139): reads as GETs, writes as
 * JSON POSTs, on the connection's connected account. A refusal, a 429 or a
 * failure around the call is a SlackError with a code only.
 */

vi.mock('../composio.js', () => ({ proxyRequest: vi.fn() }));

const { SlackError, slackGet, slackPost } = await import('./api.js');

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/slack-api.json', import.meta.url)));
const CONNECTION = { composioAccountId: 'ca_slack' };

const proxyAnswering = (answer) => vi.fn(async () => answer);

describe('slackGet / slackPost', () => {
  it('reads with a GET on the connected account, its arguments in the query', async () => {
    const proxy = proxyAnswering(FIX['auth.test']);
    await expect(slackGet(CONNECTION, 'auth.test', {}, { proxy })).resolves.toMatchObject({
      team: 'Acme Test',
    });
    expect(proxy).toHaveBeenCalledWith('ca_slack', {
      endpoint: 'https://slack.com/api/auth.test',
      method: 'GET',
      query: {},
    });
  });

  it('writes with a POST of JSON', async () => {
    const proxy = proxyAnswering(FIX['chat.postMessage']);
    const body = { channel: 'C00000001', text: 'Hi' };
    await expect(slackPost(CONNECTION, 'chat.postMessage', body, { proxy })).resolves.toMatchObject(
      { ts: '1762770000.000100' },
    );
    expect(proxy).toHaveBeenCalledWith('ca_slack', {
      endpoint: 'https://slack.com/api/chat.postMessage',
      method: 'POST',
      body,
    });
  });

  it("turns Slack's refusal into its code", async () => {
    const proxy = proxyAnswering(FIX['error:not_in_channel']);
    const err = await slackPost(CONNECTION, 'chat.postMessage', {}, { proxy }).catch((e) => e);
    expect(err).toBeInstanceOf(SlackError);
    expect(err).toMatchObject({ code: 'not_in_channel', status: 200 });
  });

  it('says how long Slack asks to wait on a 429', async () => {
    const proxy = proxyAnswering(FIX['error:ratelimited']);
    const err = await slackPost(CONNECTION, 'chat.postMessage', {}, { proxy }).catch((e) => e);
    expect(err).toMatchObject({ code: 'ratelimited', status: 429, retryAfter: 30 });
  });

  it('names a Slack outage and an odd answer by code', async () => {
    let proxy = proxyAnswering(FIX['error:unavailable']);
    await expect(slackGet(CONNECTION, 'auth.test', {}, { proxy })).rejects.toMatchObject({
      code: 'slack_unavailable',
      status: 503,
    });
    proxy = proxyAnswering({ status: 302, headers: {}, data: null });
    await expect(slackGet(CONNECTION, 'auth.test', {}, { proxy })).rejects.toMatchObject({
      code: 'http_302',
    });
    proxy = proxyAnswering({ status: 200, headers: {}, data: 'nope' });
    await expect(slackGet(CONNECTION, 'auth.test', {}, { proxy })).rejects.toMatchObject({
      code: 'bad_response',
    });
    proxy = proxyAnswering({ status: 200, headers: {}, data: { ok: false } });
    await expect(slackGet(CONNECTION, 'auth.test', {}, { proxy })).rejects.toMatchObject({
      code: 'unknown_error',
    });
  });

  it("says Composio's own refusal and a lost call by code, never their words", async () => {
    const refused = Object.assign(new Error('403 Connected account xyz inactive'), { status: 403 });
    let proxy = vi.fn(async () => {
      throw refused;
    });
    const err = await slackGet(CONNECTION, 'auth.test', {}, { proxy }).catch((e) => e);
    expect(err).toMatchObject({ code: 'composio_refused', status: 403 });
    expect(err.message).not.toContain('xyz');

    proxy = vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });
    await expect(slackGet(CONNECTION, 'auth.test', {}, { proxy })).rejects.toMatchObject({
      code: 'timeout',
    });

    proxy = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    await expect(slackGet(CONNECTION, 'auth.test', {}, { proxy })).rejects.toMatchObject({
      code: 'composio_failed',
    });
  });

  it('calls nothing without a connected account', async () => {
    const proxy = vi.fn();
    await expect(
      slackGet({ composioAccountId: null }, 'auth.test', {}, { proxy }),
    ).rejects.toMatchObject({ code: 'not_connected' });
    expect(proxy).not.toHaveBeenCalled();
  });
});
