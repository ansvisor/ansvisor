import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendResendEvent, sendSignedUpEvent } from './resend-event';

const fetchMock = vi.fn();
const ACCEPTED = { accepted: true, reason: 'accepted' };

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubGlobal('fetch', fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendResendEvent', () => {
  it('posts the event to Resend with the key, and says it was accepted', async () => {
    await expect(
      sendResendEvent('user.signed_up', 'a@b.co', { first_name: 'Ada' }),
    ).resolves.toEqual(ACCEPTED);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/events/send');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer re_test',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toEqual({
      event: 'user.signed_up',
      email: 'a@b.co',
      payload: { first_name: 'Ada' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends nothing without a key or an address, and says which', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    await expect(sendResendEvent('user.signed_up', 'a@b.co', {})).resolves.toEqual({
      accepted: false,
      reason: 'no_key',
    });
    vi.stubEnv('RESEND_API_KEY', 're_test');
    await expect(sendResendEvent('user.signed_up', '', {})).resolves.toEqual({
      accepted: false,
      reason: 'no_email',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says a refusal, a failure and a timeout were not accepted, by status or name only', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422 });
    await expect(sendResendEvent('e', 'a@b.co', {})).resolves.toEqual({
      accepted: false,
      reason: 'refused:422',
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(sendResendEvent('e', 'a@b.co', {})).resolves.toEqual({
      accepted: false,
      reason: 'refused:500',
    });
    fetchMock.mockRejectedValueOnce(new Error('down re_test a@b.co'));
    await expect(sendResendEvent('e', 'a@b.co', {})).resolves.toEqual({
      accepted: false,
      reason: 'failed:Error',
    });
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(sendResendEvent('e', 'a@b.co', {})).resolves.toEqual({
      accepted: false,
      reason: 'failed:TimeoutError',
    });
    // The caller logs the reason; nothing here.
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('sendSignedUpEvent', () => {
  it('sends the first word of the name, or an empty string', async () => {
    await expect(
      sendSignedUpEvent({ email: 'a@b.co', user_metadata: { full_name: ' Ada Lovelace ' } }),
    ).resolves.toEqual(ACCEPTED);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).payload).toEqual({ first_name: 'Ada' });
    await sendSignedUpEvent({ email: 'a@b.co', user_metadata: {} });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).payload).toEqual({ first_name: '' });
  });

  it('says whether Resend accepted it, and sends nothing without an address', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(sendSignedUpEvent({ email: 'a@b.co' })).resolves.toEqual({
      accepted: false,
      reason: 'refused:503',
    });
    await expect(sendSignedUpEvent({ email: null })).resolves.toEqual({
      accepted: false,
      reason: 'no_email',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
