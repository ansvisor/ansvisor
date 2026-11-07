import { beforeEach, describe, expect, it, vi } from 'vitest';

/** #2170: an access log uploaded from the browser, through the API's proxy. */

let session: { access_token: string } | null;
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));

const { BOT_LOG_UPLOAD_MAX_BYTES, uploadBotLog } = await import('./bot-log-upload');

const fetchMock = vi.fn();
beforeEach(() => {
  session = { access_token: 'tok' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

const file = (text = '20.171.207.12 - - [04/Nov/2026:09:15:02 +0000] "GET / HTTP/1.1" 200 1') =>
  new File([text], 'access.log', { type: 'text/plain' });

describe('uploadBotLog', () => {
  it('sends the file as it is, with the session, and says what was read', async () => {
    answer(200, {
      received: 3,
      verified: 1,
      stored: 1,
      records: 4,
      skipped: { invalid: 1, other_host: 1, unknown_agent: 0, unverified_ip: 0, no_ranges: 0 },
    });
    const log = file();
    expect(await uploadBotLog('b 1', log)).toEqual({
      ok: true,
      records: 4,
      bots: 1,
      // A line in no format read, one too old and one for another site.
      leftOut: 3,
      duplicate: false,
      rawCapped: false,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/aeo/api/bots/upload/b%201');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer tok' },
      body: log,
    });
  });

  it('says when the file was read before, or the month’s log records are used up', async () => {
    answer(200, { received: 0, verified: 0, stored: 0, duplicate: true });
    expect(await uploadBotLog('b1', file())).toMatchObject({ ok: true, duplicate: true });
    answer(200, { received: 4, verified: 0, stored: 0, rawCapped: true, records: 4 });
    expect(await uploadBotLog('b1', file())).toMatchObject({
      ok: true,
      rawCapped: true,
      leftOut: 0,
    });
  });

  it('refuses an empty file and one past what the proxy takes, before sending them', async () => {
    expect(await uploadBotLog('b1', file(''))).toEqual({ ok: false, code: 'empty' });
    const big = new File([new Uint8Array(BOT_LOG_UPLOAD_MAX_BYTES + 1)], 'big.log');
    expect(await uploadBotLog('b1', big)).toEqual({ ok: false, code: 'too_large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the API's reasons", async () => {
    answer(413, { error: 'too_large', message: 'The file holds 20001 lines' });
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'too_large' });
    answer(400, { error: 'unreadable_file' });
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'unreadable' });
    answer(400, { error: 'empty_file' });
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'empty' });
    answer(403, { error: 'plan_limit', message: 'The AI bot report comes with the Growth plan.' });
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'plan' });
    answer(403, { error: 'Only admins and managers can manage AI bot connections.' });
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'forbidden' });
    answer(429, { success: false, message: 'Too many requests, please try again later.' });
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'busy' });
    // A read-only workspace, or the demo brand: the upgrade dialog's.
    answer(402, { error: 'plan_limit', code: 'subscription_inactive' });
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'subscription' });
    answer(402, { code: 'demo_brand' });
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'subscription' });
    answer(401, { error: 'Unauthorized' });
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'session' });
    answer(500, { error: 'Failed to read the uploaded log' });
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'failed' });
  });

  it('fails without a session, or when the API cannot be reached', async () => {
    session = null;
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'session' });
    session = { access_token: 'tok' };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await uploadBotLog('b1', file())).toEqual({ ok: false, code: 'failed' });
    error.mockRestore();
  });
});
