// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '../testing/fake-supabase';

/**
 * A scheduled job's e-mails, handed to the server (W3-04b, CHAT-12 items
 * 19, 26): a done run's result with its answer's PDF attached up to 5 MB
 * (else only the link), a failed retry or a pause with why; only for a job
 * that delivers by e-mail; in the background, never in the run's way.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('../testing/fake-supabase')).createFakeSupabase(),
}));
const pdf = vi.hoisted(() => ({ bytes: new Uint8Array([37, 80, 68, 70]) }));
vi.mock('../export-pdf', () => ({ answerPdf: vi.fn(async () => pdf.bytes) }));
vi.mock('next/server', () => ({
  after: () => {
    throw new Error('outside a request');
  },
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const email = await import('./email');

const fetchMock = vi.fn<
  (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>
>(async () => ({ ok: true, status: 200 }));
const sent = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'shh');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  pdf.bytes = new Uint8Array([37, 80, 68, 70]);
  db.tables = {
    chat_schedules: [
      {
        id: 'job-1',
        organization_id: 'org-1',
        title: 'Weekly report',
        deliver_to: ['chat', 'email'],
      },
    ],
    chat_messages: [
      {
        id: 'msg-1',
        content_md: 'Citations rose 12% this week.',
        generated_at: '2026-11-02T06:02:00.000Z',
        data_as_of: '2026-11-02T00:00:00.000Z',
        timezone: 'Europe/Istanbul',
        created_at: '2026-11-02T06:02:00.000Z',
      },
    ],
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('emailRunResult', () => {
  it('hands the server the run with its answer’s PDF attached', async () => {
    email.emailRunResult({ id: 'run-1', schedule_id: 'job-1' }, { messageId: 'msg-1' });
    await settle();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/internal\/chat\/schedules\/email$/);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer shh',
    });
    expect(sent()).toEqual([
      {
        orgId: 'org-1',
        scheduleId: 'job-1',
        runId: 'run-1',
        kind: 'result',
        attachment: {
          filename: expect.stringMatching(/^weekly-report.*\.pdf$/),
          content: Buffer.from(pdf.bytes).toString('base64'),
        },
      },
    ]);
  });

  it('sends the link only past 5 MB, and nothing for a job that doesn’t e-mail', async () => {
    pdf.bytes = new Uint8Array(email.PDF_ATTACH_MAX_BYTES + 1);
    email.emailRunResult({ id: 'run-1', schedule_id: 'job-1' }, { messageId: 'msg-1' });
    await settle();
    expect(sent()[0].attachment).toBeNull();

    fetchMock.mockClear();
    db.tables.chat_schedules[0].deliver_to = ['chat'];
    email.emailRunResult({ id: 'run-1', schedule_id: 'job-1' }, { messageId: 'msg-1' });
    email.emailJobProblem('job-1', 'paused', 'Its brand was deleted.');
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws into the run when the server is down', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(() =>
      email.emailRunResult({ id: 'run-1', schedule_id: 'job-1' }, { messageId: 'msg-1' }),
    ).not.toThrow();
    await settle();
    expect(error).toHaveBeenCalled();
  });
});

describe('emailJobProblem', () => {
  it('hands the server why the run didn’t run, or the job paused', async () => {
    email.emailJobProblem('job-1', 'failed', 'Something went wrong.', 'run-2');
    email.emailJobProblem('job-1', 'paused', 'The monthly AI limit was reached.');
    await settle();
    expect(sent()).toEqual([
      {
        orgId: 'org-1',
        scheduleId: 'job-1',
        runId: 'run-2',
        kind: 'failed',
        reason: 'Something went wrong.',
      },
      {
        orgId: 'org-1',
        scheduleId: 'job-1',
        runId: null,
        kind: 'paused',
        reason: 'The monthly AI limit was reached.',
      },
    ]);
  });
});
