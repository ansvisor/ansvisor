import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ runs: [], chats: [], orgs: [], admins: [], prefs: [] }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        in: () => chain,
        not: () => chain,
        gte: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        then: (resolve) =>
          resolve({
            data: {
              chat_agent_runs: db.runs,
              chat_conversations: db.chats,
              organizations: db.orgs,
              profiles: db.admins,
              notification_preferences: db.prefs,
            }[table],
            error: null,
          }),
      };
      return chain;
    },
  },
}));
const audience = vi.hoisted(() => ({ map: new Map() }));
vi.mock('./choices.js', async (importOriginal) => ({
  ...(await importOriginal()),
  brandAudience: async () => audience.map,
  ofActiveWorkspaces: async (groups) => groups,
}));
const usage = vi.hoisted(() => ({ byOrg: {}, budget: {} }));
vi.mock('../plan-guard.js', () => ({
  getAiUsage: async (orgId) => usage.byOrg[orgId],
  aiBudgetOf: async (orgId) => ({
    includedUsd: orgId in usage.budget ? usage.budget[orgId] : 25,
  }),
}));
const claims = vi.hoisted(() => ({ taken: new Set() }));
vi.mock('./sends.js', async (importOriginal) => ({
  ...(await importOriginal()),
  claimSend: async ({ kind, userId, subject }) => {
    const key = `${kind}|${userId}|${subject}`;
    if (claims.taken.has(key)) return false;
    claims.taken.add(key);
    return true;
  },
  markSent: async () => undefined,
}));
vi.mock('../pulse/audience.js', () => ({
  emailsOf: async (ids) => ids.map((id) => `${id}@acme.test`),
}));
vi.mock('../i18n.js', async (importOriginal) => ({
  ...(await importOriginal()),
  uiLanguagesOf: async (ids) => new Map(ids.map((id) => [id, 'en'])),
}));
const sendEmail = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../email.js', () => ({ sendEmail }));

const { renderRunsEmail, sendRunAlerts, sendRunSummaries, sendUsageAlerts } =
  await import('./runs-usage.js');

const run = (id, status, extra = {}) => ({
  id,
  organization_id: 'o1',
  brand_id: 'b1',
  acting_user_id: 'ana',
  status,
  finished_at: '2026-11-20T09:00:00Z',
  chat_agents: { name: 'Weekly report' },
  brands: { name: 'Acme' },
  ...extra,
});
const period = (percentUsed, extra = {}) => ({
  unlimited: false,
  percentUsed,
  periodStart: '2026-11-01T00:00:00.000Z',
  periodEnd: '2026-12-01T00:00:00.000Z',
  ...extra,
});

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'k');
  vi.stubEnv('RESEND_FROM_EMAIL', 'hi@ansvisor.test');
  Object.assign(db, { runs: [], chats: [], orgs: [], admins: [], prefs: [] });
  audience.map = new Map([['ana', 'instant']]);
  usage.byOrg = {};
  usage.budget = {};
  claims.taken = new Set();
  sendEmail.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('Run finished (run_finished)', () => {
  it('names the agent and how it ended, linking to its chat', () => {
    const { subject, html } = renderRunsEmail(
      { brand: 'Acme', runs: [{ ...run('r1', 'failed'), chatId: 'c1' }] },
      'en',
    );
    expect(subject).toBe('Acme: Weekly report failed');
    expect(html).toContain('/dashboard/chat/c1');
  });

  it('tells the person a run acted for, Right away, once each, and the day’s in one summary', async () => {
    db.runs = [
      run('r1', 'done'),
      run('r2', 'stopped'),
      run('r3', 'done', { acting_user_id: 'bo' }),
    ];
    db.chats = [{ id: 'c1', agent_run_id: 'r1' }];
    expect(await sendRunAlerts(new Date('2026-11-20T10:00:00Z'))).toBe(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: ['ana@acme.test'],
      subject: 'Acme: 2 agent runs ended',
    });
    expect(await sendRunAlerts(new Date('2026-11-20T10:10:00Z'))).toBe(0);
    audience.map = new Map([['ana', 'daily']]);
    expect(await sendRunSummaries(new Date('2026-11-20T23:00:00Z'))).toBe(1);
    expect(await sendRunSummaries(new Date('2026-11-20T23:30:00Z'))).toBe(0);
  });
});

describe('AI usage (ai_usage, Admins)', () => {
  beforeEach(() => {
    db.orgs = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }];
    db.admins = [{ id: 'ana' }, { id: 'bo' }];
  });

  it('tells each Admin who wants it at 80%, then at 100%, once per month', async () => {
    db.prefs = [{ user_id: 'bo', frequency: 'off' }];
    usage.byOrg = { o1: period(82), o2: period(40), o3: period(null, { unlimited: true }) };
    expect(await sendUsageAlerts()).toBe(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: ['ana@acme.test'],
      subject: 'Your workspace has used 80% of its monthly AI limit',
    });
    expect(await sendUsageAlerts()).toBe(0);
    usage.byOrg.o1 = period(100);
    expect(await sendUsageAlerts()).toBe(1);
    expect(sendEmail.mock.calls[1][0].subject).toBe(
      'Your workspace has used 100% of its monthly AI limit',
    );
  });

  it('skips a workspace with no limit or a limit of 0, which would read as used up', async () => {
    db.orgs = [{ id: 'o1' }, { id: 'o2' }];
    usage.budget = { o1: 0, o2: null };
    usage.byOrg = { o1: period(100), o2: period(100) };
    expect(await sendUsageAlerts()).toBe(0);
  });

  it('reaching 100% first sends only that one, never 80% after it', async () => {
    db.orgs = [{ id: 'o1' }];
    usage.byOrg = { o1: period(100) };
    expect(await sendUsageAlerts()).toBe(2);
    expect(sendEmail.mock.calls.map(([m]) => m.subject)).toEqual([
      'Your workspace has used 100% of its monthly AI limit',
      'Your workspace has used 100% of its monthly AI limit',
    ]);
    expect(await sendUsageAlerts()).toBe(0);
  });
});
