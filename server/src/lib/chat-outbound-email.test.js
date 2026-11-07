import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A scheduled job's e-mails to addresses outside the workspace (W4-28,
 * Wave 4 decision 16): a run only prepares them (pending, nothing sent, on
 * Full auto too); Send is an Admin's or a Manager's click, not in the trial,
 * 50 a day per workspace, through email.js with Reply-To the clicker, the
 * summary and the PDF, no link into the app and the "Sent by" footer, then
 * sent and logged; Cancel is logged too; 7 days unsent, it expires.
 */

const db = vi.hoisted(() => ({ tables: {}, files: new Map(), removed: [] }));
const deliver = vi.hoisted(() => vi.fn(async () => ({ status: 'sent', id: 'resend-1' })));
const readers = vi.hoisted(() => ({ map: new Map() }));

function query(table) {
  const filters = [];
  let values = null;
  let inserting = null;
  let one = false;
  let head = false;
  let limit = Infinity;
  const chain = {
    select: (_cols, options) => ((head = !!options?.head), chain),
    eq: (col, val) => (filters.push((r) => r[col] === val), chain),
    in: (col, vals) => (filters.push((r) => vals.includes(r[col])), chain),
    gt: (col, val) => (filters.push((r) => r[col] !== null && r[col] > val), chain),
    lte: (col, val) => (filters.push((r) => r[col] !== null && r[col] <= val), chain),
    limit: (n) => ((limit = n), chain),
    update: (v) => ((values = v), chain),
    insert: (v) => ((inserting = v), chain),
    maybeSingle: () => ((one = true), chain),
    then: (resolve) => {
      const rows = (db.tables[table] ??= []);
      if (inserting) {
        const row = { id: `${table}-${rows.length + 1}`, ...inserting };
        if (
          table === 'chat_outbound_emails' &&
          rows.some(
            (r) => r.schedule_run_id === row.schedule_run_id && r.to_address === row.to_address,
          )
        ) {
          return resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
        }
        rows.push({
          status: 'pending',
          expires_at: '2026-11-09T09:00:00.000Z',
          sent_at: null,
          ...row,
        });
        return resolve({ data: null, error: null });
      }
      const found = rows.filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (values) for (const row of found) Object.assign(row, values);
      if (head) return resolve({ count: found.length, error: null });
      return resolve({ data: one ? (found[0] ?? null) : found, error: null });
    },
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => query(table),
    storage: {
      from: () => ({
        upload: async (path, bytes) => (db.files.set(path, bytes), { error: null }),
        download: async (path) =>
          db.files.has(path)
            ? { data: { arrayBuffer: async () => db.files.get(path) }, error: null }
            : { data: null, error: { message: 'gone' } },
        remove: async (paths) => (db.removed.push(...paths), { error: null }),
      }),
    },
    auth: {
      admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@acme.test` } } }) },
    },
  },
}));
vi.mock('./email.js', () => ({ deliverEmailWithId: deliver }));
vi.mock('./access.js', async (original) => ({
  ...(await original()),
  brandReaders: async () => readers.map,
}));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const schedule = await import('./chat-schedule-email.js');
const outside = await import('./chat-outbound-email.js');

const ORG = 'org-1';
const JOB = 'job-1';
const RUN = 'run-1';
const BRAND = 'brand-1';
const NOW = new Date('2026-11-03T09:00:00.000Z');
const PDF = Buffer.from('%PDF-1.7 report');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.stubEnv('IS_CLOUD', 'true');
  vi.stubEnv('PUBLIC_APP_URL', 'https://app.ansvisor.test/');
  deliver.mockReset().mockResolvedValue({ status: 'sent', id: 'resend-1' });
  db.files = new Map();
  db.removed = [];
  readers.map = new Map([
    ['creator', new Set([BRAND])],
    ['admin', new Set([BRAND])],
  ]);
  db.tables = {
    chat_schedules: [
      {
        id: JOB,
        organization_id: ORG,
        title: 'Weekly report',
        brand_id: BRAND,
        created_by: 'creator',
        recipient_ids: [],
        deliver_to: ['chat'],
        conversation_id: 'chat-1',
        external_recipients: ['jane@client.com', 'ops@client.com'],
      },
    ],
    chat_schedule_runs: [{ id: RUN, schedule_id: JOB, message_id: 'msg-1', email_status: null }],
    chat_messages: [
      {
        id: 'msg-1',
        content_md:
          '# Citations rose 12%\n\nSee https://app.ansvisor.test/dashboard/visibility for more.\n\n- [ChatGPT cited /pricing](https://app.ansvisor.test/dashboard/citations) 4 times',
      },
    ],
    profiles: [
      { id: 'creator', organization_id: ORG, role: 'manager', full_name: 'Ayşe Demir' },
      { id: 'admin', organization_id: ORG, role: 'admin', full_name: 'Ali Admin' },
      { id: 'analyst', organization_id: ORG, role: 'analyst', full_name: 'An Analyst' },
      { id: 'stranger', organization_id: 'org-2', role: 'admin', full_name: 'Other' },
    ],
    organizations: [
      { id: ORG, name: 'Acme Agency', plan: 'starter', subscription_status: 'active' },
    ],
    white_label_kits: [],
    chat_outbound_emails: [],
    chat_activity_log: [],
  };
});
afterEach(() => vi.unstubAllEnvs());

const runDone = (over = {}) =>
  schedule.sendScheduleEmail({
    orgId: ORG,
    scheduleId: JOB,
    runId: RUN,
    kind: 'result',
    attachment: { filename: 'weekly-report-2026-11-03.pdf', content: PDF.toString('base64') },
    ...over,
  });
const emails = () => db.tables.chat_outbound_emails;
const jane = () => emails().find((row) => row.to_address === 'jane@client.com');

describe('a run with outside addresses', () => {
  it('prepares a pending e-mail per address, with the summary and the PDF, and sends nothing', async () => {
    expect(await runDone()).toEqual({ status: 'skipped', sent: 0, prepared: 2 });
    expect(deliver).not.toHaveBeenCalled();
    expect(emails().map((row) => [row.to_address, row.status])).toEqual([
      ['jane@client.com', 'pending'],
      ['ops@client.com', 'pending'],
    ]);
    expect(jane()).toMatchObject({
      organization_id: ORG,
      schedule_id: JOB,
      schedule_run_id: RUN,
      subject: 'Weekly report',
      files: [{ path: `${ORG}/outbound/${RUN}/report.pdf`, name: 'weekly-report-2026-11-03.pdf' }],
    });
    // The answer's lines, with no address of the app left in them.
    expect(jane().summary).toBe(
      'Citations rose 12%\nSee for more.\nChatGPT cited /pricing 4 times',
    );
    expect(db.files.get(`${ORG}/outbound/${RUN}/report.pdf`).equals(PDF)).toBe(true);
    // The same run again prepares nothing new.
    expect(await runDone()).toMatchObject({ prepared: 0 });
    expect(emails()).toHaveLength(2);
  });

  it('still only prepares when the job also e-mails its people, and on Full auto', async () => {
    // Going live on its own, on for the workspace: it never covers an outside e-mail.
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'true');
    db.tables.chat_settings = [{ organization_id: ORG, auto_go_live_groups: ['content'] }];
    db.tables.chat_schedules[0].deliver_to = ['chat', 'email'];
    expect(await runDone()).toEqual({ status: 'sent', sent: 1, prepared: 2 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0].to).toEqual(['creator@acme.test']);
    expect(emails().every((row) => row.status === 'pending')).toBe(true);
  });
});

describe('Send', () => {
  beforeEach(async () => {
    await runDone();
  });
  const send = (userId = 'creator', now = NOW) =>
    outside.sendOutsideEmail({ userId, id: jane().id, now });

  it('sends through email.js with Reply-To the clicker, the summary, the PDF and the footer', async () => {
    expect(await send()).toEqual({ ok: true });
    expect(deliver).toHaveBeenCalledTimes(1);
    const message = deliver.mock.calls[0][0];
    expect(message).toMatchObject({
      to: ['jane@client.com'],
      subject: 'Weekly report',
      replyTo: 'creator@acme.test',
      fromName: 'Ansvisor',
      attachments: [{ filename: 'weekly-report-2026-11-03.pdf', content: PDF.toString('base64') }],
    });
    expect(message.html).toContain('Citations rose 12%');
    expect(message.html).toContain('Sent by Ayşe Demir from Acme Agency via Ansvisor');
    expect(message.html).toContain('attached as a PDF');
    expect(jane()).toMatchObject({
      status: 'sent',
      sent_at: NOW.toISOString(),
      approved_by: 'creator',
      resend_id: 'resend-1',
    });
    expect(db.tables.chat_activity_log).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        user_id: 'creator',
        surface: 'schedule',
        kind: 'change',
        class: 'execute',
        approval_kind: 'click',
        tool_key: 'sendOutsideEmail',
        target_type: 'chat_outbound_email',
        target_id: jane().id,
        summary_key: 'outsideEmailSent',
        summary_params: { title: 'Weekly report', to: 'jane@client.com' },
      }),
    ]);
    // ops@ still waits: the run's PDF stays until it goes too.
    expect(db.removed).toEqual([]);
    // A second click sends nothing.
    expect(await send()).toMatchObject({ ok: false, code: 'sent', status: 409 });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('puts no link into the app in the body', async () => {
    await send();
    const { html } = deliver.mock.calls[0][0];
    expect(html).not.toMatch(/<a\b/i);
    expect(html).not.toContain('href');
    expect(html).not.toContain('app.ansvisor.test');
    expect(html).not.toContain('/dashboard');
  });

  it('refuses an Analyst, another workspace and a job the Manager doesn’t own', async () => {
    expect(await send('analyst')).toMatchObject({ ok: false, code: 'forbidden', status: 403 });
    expect(await send('stranger')).toMatchObject({ ok: false, code: 'not_found', status: 404 });
    db.tables.profiles.push({ id: 'manager2', organization_id: ORG, role: 'manager' });
    expect(await send('manager2')).toMatchObject({ ok: false, code: 'not_found' });
    expect(deliver).not.toHaveBeenCalled();
    // An Admin may send a teammate's.
    expect(await send('admin')).toEqual({ ok: true });
    expect(deliver.mock.calls[0][0].replyTo).toBe('admin@acme.test');
  });

  it('refuses in the free trial and without an active plan', async () => {
    db.tables.organizations[0].subscription_status = 'trialing';
    expect(await send()).toMatchObject({ ok: false, code: 'trial', status: 402 });
    db.tables.organizations[0].subscription_status = 'canceled';
    expect(await send()).toMatchObject({ ok: false, code: 'plan', status: 402 });
    expect(deliver).not.toHaveBeenCalled();
    expect(jane().status).toBe('pending');
  });

  it('keeps to 50 sends a day per workspace', async () => {
    const sent = (n, at) =>
      Array.from({ length: n }, (_, i) => ({
        id: `old-${at}-${i}`,
        organization_id: ORG,
        status: 'sent',
        sent_at: at,
      }));
    // 50 in the last 24 hours: the 51st waits.
    emails().push(...sent(50, '2026-11-02T10:00:00.000Z'));
    expect(await send()).toMatchObject({ ok: false, code: 'daily_limit', status: 429 });
    expect(deliver).not.toHaveBeenCalled();
    expect(jane()).toMatchObject({ status: 'pending', sent_at: null, approved_by: null });
    // A day later they no longer count.
    db.tables.chat_outbound_emails = emails().filter((row) => !row.id.startsWith('old-'));
    emails().push(...sent(49, '2026-11-02T10:00:00.000Z'), ...sent(10, '2026-11-01T08:00:00.000Z'));
    expect(await send()).toEqual({ ok: true });
  });

  it('keeps it pending, with why, when Resend doesn’t take it', async () => {
    deliver.mockResolvedValueOnce({ status: 'refused', id: null });
    expect(await send()).toMatchObject({ ok: false, code: 'send_failed', status: 502 });
    expect(jane()).toMatchObject({ status: 'pending', sent_at: null });
    expect(jane().send_error).toMatch(/didn’t take it/);
    expect(db.tables.chat_activity_log).toEqual([]);
    expect(await send()).toEqual({ ok: true });
    expect(jane().send_error).toBeNull();
  });

  it('doesn’t send to an address taken off the job', async () => {
    db.tables.chat_schedules[0].external_recipients = ['ops@client.com'];
    expect(await send()).toMatchObject({ ok: false, code: 'removed', status: 409 });
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('Cancel and expiry', () => {
  beforeEach(async () => {
    await runDone();
  });

  it('Cancel sends nothing, and is logged', async () => {
    expect(
      await outside.cancelOutsideEmail({ userId: 'creator', id: jane().id, now: NOW }),
    ).toEqual({ ok: true });
    expect(jane().status).toBe('cancelled');
    expect(deliver).not.toHaveBeenCalled();
    expect(db.tables.chat_activity_log).toEqual([
      expect.objectContaining({
        class: 'write',
        approval_kind: 'run',
        tool_key: 'cancelOutsideEmail',
        summary_key: 'outsideEmailCancelled',
        summary_params: { title: 'Weekly report', to: 'jane@client.com' },
      }),
    ]);
    expect(
      await outside.sendOutsideEmail({ userId: 'creator', id: jane().id, now: NOW }),
    ).toMatchObject({ ok: false, code: 'cancelled' });
    // Cancelling the last one lets the run's PDF go.
    const ops = emails().find((row) => row.to_address === 'ops@client.com');
    await outside.cancelOutsideEmail({ userId: 'creator', id: ops.id, now: NOW });
    expect(db.removed).toEqual([`${ORG}/outbound/${RUN}/report.pdf`]);
  });

  it('expires an e-mail not sent in its 7 days', async () => {
    const later = new Date('2026-11-09T09:00:00.000Z');
    expect(
      await outside.sendOutsideEmail({ userId: 'creator', id: jane().id, now: later }),
    ).toMatchObject({ ok: false, code: 'expired', status: 410 });
    expect(jane().status).toBe('expired');
    expect(deliver).not.toHaveBeenCalled();
    // The minute sweep takes the rest, and their PDF.
    expect(await outside.expireOutsideEmails(NOW)).toBe(0);
    expect(await outside.expireOutsideEmails(later)).toBe(1);
    expect(emails().map((row) => row.status)).toEqual(['expired', 'expired']);
    expect(db.removed).toContain(`${ORG}/outbound/${RUN}/report.pdf`);
  });
});

describe('outsidePlanRefusal', () => {
  it('is Starter and up, paid and active; billing doesn’t apply self-hosted', () => {
    expect(outside.outsidePlanRefusal({ plan: 'starter', subscription_status: 'active' })).toBe(
      null,
    );
    expect(outside.outsidePlanRefusal({ plan: 'growth', subscription_status: 'trialing' })).toBe(
      'trial',
    );
    expect(
      outside.outsidePlanRefusal({ plan: 'enterprise', subscription_status: 'trialing' }),
    ).toBe(null);
    expect(outside.outsidePlanRefusal({ plan: 'starter', subscription_status: 'past_due' })).toBe(
      'plan',
    );
    vi.stubEnv('IS_CLOUD', 'false');
    expect(outside.outsidePlanRefusal({ plan: 'starter', subscription_status: 'trialing' })).toBe(
      null,
    );
  });
});
