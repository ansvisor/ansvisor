import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendResendEvent, sendSignedUpEvent } from './resend-event';

const fetchMock = vi.fn();

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
  it('posts the event to Resend with the key', async () => {
    await sendResendEvent('user.signed_up', 'a@b.co', { first_name: 'Ada' });
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

  it('does nothing without a key', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    await sendResendEvent('user.signed_up', 'a@b.co', {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a network error and a refusal, logging neither key nor address', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down re_test a@b.co'));
    await expect(sendResendEvent('e', 'a@b.co', {})).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(sendResendEvent('e', 'a@b.co', {})).resolves.toBeUndefined();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toMatch(/re_test|a@b\.co/);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe('sendSignedUpEvent', () => {
  it('sends the first word of the name, or an empty string', async () => {
    await sendSignedUpEvent({ email: 'a@b.co', user_metadata: { full_name: ' Ada Lovelace ' } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).payload).toEqual({ first_name: 'Ada' });
    await sendSignedUpEvent({ email: 'a@b.co', user_metadata: {} });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).payload).toEqual({ first_name: '' });
  });
});
