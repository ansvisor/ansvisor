import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Resend's answer, told apart: accepted, refused (nothing went out), or no
 * answer at all (it may have gone out), and nothing to do without config.
 */

vi.mock('./logger.js', () => ({ logger: { warn: vi.fn() } }));

const { deliverEmail, deliverEmailWithId, senderOf, sendEmail, ATTACHMENTS_MAX_BYTES } =
  await import('./email.js');

const message = { to: ['team@acme.example'], subject: 'Hi', html: '<p>Hi</p>' };
const answer = (status, body = '{}') => ({ ok: status < 300, status, text: async () => body });
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('RESEND_FROM_EMAIL', 'Ansvisor <hello@acme.example>');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('deliverEmail', () => {
  it('says sent when Resend accepts it, and refused when it answers with an error', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, '{"id":"e1"}'));
    expect(await deliverEmail(message)).toBe('sent');
    fetchMock.mockResolvedValueOnce(answer(422, '{"message":"invalid"}'));
    expect(await deliverEmail(message)).toBe('refused');
  });

  it('sends from another address and with files when asked', async () => {
    fetchMock.mockResolvedValueOnce(answer(200));
    await deliverEmail({
      ...message,
      from: 'Ansvisor <reports@acme.example>',
      attachments: [{ filename: 'card.pdf', content: 'JVBERi0=' }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe('Ansvisor <reports@acme.example>');
    expect(body.attachments).toEqual([{ filename: 'card.pdf', content: 'JVBERi0=' }]);
    fetchMock.mockResolvedValueOnce(answer(200));
    await deliverEmail(message);
    const plain = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(plain.from).toBe('Ansvisor <hello@acme.example>');
    expect(plain).not.toHaveProperty('attachments');
  });

  it('says unknown when no answer came: a timeout or a dropped connection', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    expect(await deliverEmail(message)).toBe('unknown');
  });

  it('sends a reply to replyTo when given', async () => {
    fetchMock.mockResolvedValue(answer(200));
    await deliverEmail({ ...message, replyTo: 'ada@customer.example' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reply_to).toBe('ada@customer.example');
    await deliverEmail(message);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('reply_to');
  });

  it('skips without config or recipients', async () => {
    expect(await deliverEmail({ ...message, to: [] })).toBe('skipped');
    vi.stubEnv('RESEND_API_KEY', '');
    expect(await deliverEmail(message)).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendEmail', () => {
  it('is true only when Resend accepted it', async () => {
    fetchMock.mockResolvedValueOnce(answer(200));
    expect(await sendEmail(message)).toBe(true);
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    expect(await sendEmail(message)).toBe(false);
  });
});

describe('deliverEmailWithId', () => {
  it('answers Resend’s id, sends attachments and a display name on the configured address', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, '{"id":"e1"}'));
    const outcome = await deliverEmailWithId({
      ...message,
      fromName: 'Northwind "Agency"',
      attachments: [{ filename: 'report.pdf', content: 'aGk=' }],
    });
    expect(outcome).toEqual({ status: 'sent', id: 'e1' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe('"Northwind Agency" <hello@acme.example>');
    expect(body.attachments).toEqual([{ filename: 'report.pdf', content: 'aGk=' }]);
    expect(senderOf('hello@acme.example', 'Acme')).toBe('"Acme" <hello@acme.example>');
    expect(senderOf('Ansvisor <hello@acme.example>', null)).toBe('Ansvisor <hello@acme.example>');
  });

  it('refuses attachments past the limit without calling Resend, and sends none it isn’t given', async () => {
    const big = Buffer.alloc(ATTACHMENTS_MAX_BYTES + 1, 1).toString('base64');
    expect(
      await deliverEmailWithId({ ...message, attachments: [{ filename: 'a.pdf', content: big }] }),
    ).toEqual({ status: 'refused', id: null });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(answer(200, 'not json'));
    expect(await deliverEmailWithId(message)).toEqual({ status: 'sent', id: null });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('attachments');
  });
});
