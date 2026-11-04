import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A scheduled job's e-mails (CHAT-12 items 19, 26; W3-04b): its result to
 * its creator and the workspace's people it names, checked as it is sent
 * (still a member, still reaching its brand); the first lines of the
 * answer, Open in Chat and Pause this job; the PDF attached up to 5 MB;
 * from "Ansvisor" or the white label kit's company; once per run, its
 * outcome kept on the run.
 */

const db = vi.hoisted(() => ({ tables: {} }));
const deliver = vi.hoisted(() => vi.fn(async () => ({ status: 'sent', id: 'resend-1' })));
const readers = vi.hoisted(() => ({ map: new Map() }));

function query(table) {
  const filters = [];
  let values = null;
  let one = false;
  const chain = {
    select: () => chain,
    eq: (col, val) => (filters.push((r) => r[col] === val), chain),
    in: (col, vals) => (filters.push((r) => vals.includes(r[col])), chain),
    update: (v) => ((values = v), chain),
    maybeSingle: () => ((one = true), chain),
    then: (resolve) => {
      const rows = (db.tables[table] ??= []);
      const found = rows.filter((r) => filters.every((f) => f(r)));
      if (values) for (const row of found) Object.assign(row, values);
      return resolve({ data: one ? (found[0] ?? null) : found, error: null });
    },
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => query(table),
    auth: {
      admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@acme.test` } } }) },
    },
  },
}));
vi.mock('./email.js', () => ({ deliverEmailWithId: deliver }));
vi.mock('./access.js', () => ({ brandReaders: async () => readers.map }));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const mail = await import('./chat-schedule-email.js');

const ORG = 'org-1';
const JOB = 'job-1';
const RUN = 'run-1';
const BRAND = 'brand-1';
const pdf = (bytes) => ({
  filename: 'weekly-report-2026-11-02.pdf',
  content: Buffer.alloc(bytes, 1).toString('base64'),
});

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.stubEnv('IS_CLOUD', 'true');
  vi.stubEnv('PUBLIC_APP_URL', 'https://app.ansvisor.test/');
  deliver.mockClear();
  readers.map = new Map([
    ['creator', new Set([BRAND])],
    ['teammate', new Set([BRAND])],
  ]);
  db.tables = {
    chat_schedules: [
      {
        id: JOB,
        organization_id: ORG,
        title: 'Weekly report',
        brand_id: BRAND,
        created_by: 'creator',
        recipient_ids: ['teammate', 'narrowed', 'left'],
        deliver_to: ['chat', 'email'],
        conversation_id: 'chat-1',
      },
    ],
    chat_schedule_runs: [{ id: RUN, schedule_id: JOB, message_id: 'msg-1', email_status: null }],
    chat_messages: [
      {
        id: 'msg-1',
        content_md:
          '# Weekly report\n\n**Citations rose 12%** this week.\n\n| a | b |\n|---|---|\n\n- ChatGPT cited [/pricing](https://acme.com/pricing) 4 times\n- Perplexity dropped /blog\n\n```\ncode\n```\nLast line one\nLast line two',
      },
    ],
    profiles: [
      { id: 'creator', organization_id: ORG },
      { id: 'teammate', organization_id: ORG },
      { id: 'narrowed', organization_id: ORG },
      { id: 'left', organization_id: 'org-2' },
    ],
    organizations: [{ id: ORG, plan: 'starter', plan_overrides: null }],
    white_label_kits: [{ organization_id: ORG, company_name: 'Northwind Agency' }],
  };
});
afterEach(() => vi.unstubAllEnvs());

const send = (over = {}) =>
  mail.sendScheduleEmail({ orgId: ORG, scheduleId: JOB, runId: RUN, kind: 'result', ...over });

describe('summaryLines', () => {
  it('takes the answer’s first lines of text, its Markdown out, code and tables left out', () => {
    expect(mail.summaryLines(db.tables.chat_messages[0].content_md)).toEqual([
      'Weekly report',
      'Citations rose 12% this week.',
      'ChatGPT cited /pricing 4 times',
      'Perplexity dropped /blog',
      'Last line one',
    ]);
    expect(mail.summaryLines('')).toEqual([]);
  });
});

describe('sendScheduleEmail', () => {
  it('sends the result to the creator and named members who still reach the brand, once', async () => {
    expect(await send({ attachment: pdf(1000) })).toEqual({ status: 'sent', sent: 2 });
    expect(deliver.mock.calls.map(([m]) => m.to)).toEqual([
      ['creator@acme.test'],
      ['teammate@acme.test'],
    ]);
    const [message] = deliver.mock.calls[0];
    expect(message.subject).toBe('Weekly report: your scheduled results');
    expect(message.html).toContain('Citations rose 12% this week.');
    expect(message.html).toContain('https://app.ansvisor.test/dashboard/chat/chat-1');
    expect(message.html).toContain('https://app.ansvisor.test/dashboard/chat/scheduled/job-1');
    expect(message.html).toContain('The report is attached as a PDF.');
    expect(message.attachments).toEqual([pdf(1000)]);
    // Starter has no white label: from Ansvisor.
    expect(message.fromName).toBe('Ansvisor');
    expect(db.tables.chat_schedule_runs[0]).toMatchObject({
      email_status: 'sent',
      resend_message_id: 'resend-1',
    });

    // A second call for the same run sends nothing.
    expect(await send()).toEqual({ status: 'skipped', sent: 0 });
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('attaches a PDF of 5 MB at most; a bigger one or another file goes as the link', async () => {
    await send({ attachment: pdf(5 * 1024 * 1024 + 1) });
    expect(deliver.mock.calls[0][0]).not.toHaveProperty('attachments');
    expect(deliver.mock.calls[0][0].html).toContain('Open it in Chat to read it all');
    expect(mail.attachable(pdf(5 * 1024 * 1024))).not.toBeNull();
    expect(mail.attachable({ filename: 'report.html', content: 'aGk=' })).toBeNull();
  });

  it('comes from the white label kit’s company on a plan with white label', async () => {
    db.tables.organizations[0].plan = 'growth';
    await send();
    expect(deliver.mock.calls[0][0].fromName).toBe('Northwind Agency');
    db.tables.white_label_kits[0].company_name = '  ';
    expect(await mail.senderNameOf(ORG)).toBe('Ansvisor');
  });

  it('says a run didn’t run, or the job paused, with why, Retry and Open in Chat', async () => {
    await mail.sendScheduleEmail({
      orgId: ORG,
      scheduleId: JOB,
      runId: RUN,
      kind: 'failed',
      reason: 'Something went wrong.',
    });
    const [failed] = deliver.mock.calls[0];
    expect(failed.subject).toBe("Weekly report didn't run");
    expect(failed.html).toContain('Something went wrong.');
    expect(failed.html).toContain('Retry');
    expect(db.tables.chat_schedule_runs[0].email_status).toBe('sent');

    deliver.mockClear();
    await mail.sendScheduleEmail({
      orgId: ORG,
      scheduleId: JOB,
      kind: 'paused',
      reason: 'The monthly AI limit was reached.',
    });
    expect(deliver.mock.calls[0][0].subject).toBe('Weekly report is paused');
  });

  it('sends nothing for a job that doesn’t e-mail, another workspace’s job, Chat off or no Resend', async () => {
    db.tables.chat_schedules[0].deliver_to = ['chat'];
    expect(await send()).toEqual({ status: 'skipped', sent: 0 });
    db.tables.chat_schedules[0].deliver_to = ['email'];
    expect(
      await mail.sendScheduleEmail({ orgId: 'org-2', scheduleId: JOB, runId: RUN, kind: 'result' }),
    ).toEqual({
      status: 'not_found',
      sent: 0,
    });
    deliver.mockResolvedValue({ status: 'skipped', id: null });
    expect(await send()).toEqual({ status: 'skipped', sent: 0 });
    expect(db.tables.chat_schedule_runs[0].email_status).toBeNull();
    deliver.mockResolvedValue({ status: 'refused', id: null });
    expect(await send()).toEqual({ status: 'failed', sent: 0 });
    expect(db.tables.chat_schedule_runs[0].email_status).toBe('failed');
    deliver.mockResolvedValue({ status: 'sent', id: 'resend-1' });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await send()).toEqual({ status: 'skipped', sent: 0 });
  });

  it('sends to no one outside the workspace or the brand, and to the creator alone on a workspace job', async () => {
    readers.map = new Map([['teammate', new Set([BRAND])]]);
    await send();
    expect(deliver.mock.calls.map(([m]) => m.to)).toEqual([['teammate@acme.test']]);
    deliver.mockClear();
    db.tables.chat_schedule_runs[0].email_status = null;
    db.tables.chat_schedules[0].brand_id = null;
    db.tables.chat_schedules[0].recipient_ids = [];
    await send();
    expect(deliver.mock.calls.map(([m]) => m.to)).toEqual([['creator@acme.test']]);
  });
});
