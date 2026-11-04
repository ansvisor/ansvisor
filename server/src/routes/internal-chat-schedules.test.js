import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The web's scheduled-job worker asks the server to send a job's e-mail,
 * server to server with CRON_SECRET; the body is checked before anything
 * is sent, and a report's PDF is a .pdf in base64 within the size it may be.
 */

const ORG = '22222222-2222-2222-2222-222222222222';
const JOB = '33333333-3333-3333-3333-333333333333';
const RUN = '44444444-4444-4444-4444-444444444444';

const sendScheduleEmail = vi.fn();
vi.mock('../lib/chat-schedule-email.js', () => ({
  sendScheduleEmail: (...args) => sendScheduleEmail(...args),
}));
vi.mock('../lib/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { default: router } = await import('./internal-chat-schedules.js');

let server;
let baseUrl;

beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', 'shh');
  sendScheduleEmail.mockReset().mockResolvedValue({ status: 'sent', sent: 2 });
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/internal/chat/schedules', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/internal/chat/schedules`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const post = (body, secret = 'shh') =>
  fetch(`${baseUrl}/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

describe('POST /api/internal/chat/schedules/email', () => {
  it('sends the job’s e-mail and says what went out', async () => {
    const body = {
      orgId: ORG,
      scheduleId: JOB,
      runId: RUN,
      kind: 'result',
      attachment: { filename: 'weekly-report.pdf', content: 'aGVsbG8=' },
    };
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: 'sent', sent: 2 });
    expect(sendScheduleEmail).toHaveBeenCalledWith(body);
  });

  it('answers only the web, and refuses a body it can’t read', async () => {
    const ok = { orgId: ORG, scheduleId: JOB, kind: 'paused', reason: 'Its brand was deleted.' };
    expect((await post(ok, 'nope')).status).toBe(401);
    for (const body of [
      { ...ok, kind: 'other' },
      { ...ok, orgId: 'nope' },
      { ...ok, to: ['someone@outside.example'] },
      { ...ok, attachment: { filename: 'report.exe', content: 'aGk=' } },
      { ...ok, attachment: { filename: '../x.pdf', content: 'aGk=' } },
      { ...ok, attachment: { filename: 'r.pdf', content: 'not base64!' } },
      { ...ok, attachment: { filename: 'r.pdf', content: 'A'.repeat(7_300_000) } },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(sendScheduleEmail).not.toHaveBeenCalled();
  });

  it('says it couldn’t send when the send fails', async () => {
    sendScheduleEmail.mockRejectedValueOnce(new Error('down'));
    const res = await post({ orgId: ORG, scheduleId: JOB, kind: 'failed', reason: 'x' });
    expect(res.status).toBe(500);
  });
});
