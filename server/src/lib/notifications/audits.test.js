import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ recent: [], previous: new Map(), previousReads: 0 }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: () => {
      let prevFor = null;
      const chain = {
        select: () => chain,
        not: () => chain,
        gte: () => chain,
        lt: () => chain,
        order: () => chain,
        eq: (column, value) => {
          if (column === 'page_key' || column === 'url') prevFor = value;
          return chain;
        },
        limit: async () => {
          db.previousReads += 1;
          return {
            data: db.previous.has(prevFor) ? [db.previous.get(prevFor)] : [],
            error: null,
          };
        },
        then: (resolve) => resolve({ data: db.recent, error: null }),
      };
      return chain;
    },
  },
}));
const audience = vi.hoisted(() => ({ byKind: {} }));
vi.mock('./choices.js', async (importOriginal) => ({
  ...(await importOriginal()),
  brandAudience: async (_o, _b, kind) => audience.byKind[kind] ?? new Map(),
  ofActiveWorkspaces: async (groups) => groups,
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

const { renderAuditEmail, sendAuditAlerts, sendAuditSummaries } = await import('./audits.js');

const brands = { name: 'Acme', organization_id: 'o1' };
const audit = (id, page, score) => ({
  id,
  brand_id: 'b1',
  url: `https://acme.com/${page}`,
  page_key: page,
  total_score: score,
  completed_at: '2026-11-20T09:00:00Z',
  brands,
});
const NOW = new Date('2026-11-20T10:00:00Z');

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'k');
  vi.stubEnv('RESEND_FROM_EMAIL', 'hi@ansvisor.test');
  db.recent = [];
  db.previous = new Map();
  db.previousReads = 0;
  audience.byKind = {};
  claims.taken = new Set();
  sendEmail.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('Audit finished and Score dropped (Site Audit)', () => {
  it('lists each page with its score, and a drop as before → now', () => {
    const finished = renderAuditEmail(
      'finished',
      { brand: 'Acme', audits: [audit('s1', 'pricing', 72.4), audit('s2', 'faq', 60)] },
      'en',
    );
    expect(finished.subject).toBe('Acme: 2 audits finished');
    expect(finished.html).toContain('acme.com/pricing: 72');
    expect(finished.html).toContain('2 pages audited, 66 on average');
    const dropped = renderAuditEmail(
      'dropped',
      { brand: 'Acme', audits: [{ ...audit('s1', 'pricing', 61), before: 70 }] },
      'en',
    );
    expect(dropped.subject).toBe("Acme: a page's score dropped");
    expect(dropped.html).toContain('acme.com/pricing: 70 → 61');
    expect(dropped.html).toContain('/dashboard/audit/s1');
  });

  it('gathers a bulk run in one e-mail Right away, and never tells an audit twice', async () => {
    db.recent = [audit('s1', 'pricing', 72), audit('s2', 'faq', 60)];
    audience.byKind = {
      audit_finished: new Map([
        ['ana', 'instant'],
        ['bo', 'off'],
      ]),
    };
    expect(await sendAuditAlerts(NOW)).toBe(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: ['ana@acme.test'],
      subject: 'Acme: 2 audits finished',
    });
    // Another page finishes: only it is told.
    db.recent.push(audit('s3', 'blog', 80));
    expect(await sendAuditAlerts(NOW)).toBe(1);
    expect(sendEmail.mock.calls[1][0].subject).toBe('Acme: 1 audit finished');
    expect(await sendAuditAlerts(NOW)).toBe(0);
  });

  it('tells a drop of 5 points or more against the page’s last audit, not a smaller one or a first audit', async () => {
    db.recent = [audit('s1', 'pricing', 61), audit('s2', 'faq', 58), audit('s3', 'new', 40)];
    db.previous = new Map([
      ['pricing', { id: 'p1', total_score: 70 }],
      ['faq', { id: 'p2', total_score: 61 }],
    ]);
    audience.byKind = { score_dropped: new Map([['ana', 'daily']]) };
    expect(await sendAuditSummaries(NOW)).toBe(1);
    const [mail] = sendEmail.mock.calls[0];
    expect(mail.html).toContain('acme.com/pricing: 70 → 61');
    expect(mail.html).not.toContain('acme.com/faq');
    expect(mail.html).not.toContain('acme.com/new');
    expect(await sendAuditSummaries(NOW)).toBe(0);
  });

  it("doesn't read the pages' last audits when nobody chose Score dropped", async () => {
    db.recent = [audit('s1', 'pricing', 61), audit('s2', 'faq', 58)];
    db.previous = new Map([['pricing', { id: 'p1', total_score: 70 }]]);
    audience.byKind = {
      audit_finished: new Map([['ana', 'instant']]),
      score_dropped: new Map([['ana', 'off']]),
    };
    expect(await sendAuditAlerts(NOW)).toBe(1);
    expect(sendEmail.mock.calls[0][0].subject).toBe('Acme: 2 audits finished');
    expect(db.previousReads).toBe(0);
  });
});
