import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ due: [], week: [], pages: 0 }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: () => {
      let kind = 'due';
      const chain = {
        select: () => chain,
        in: () => chain,
        not: () => chain,
        lte: () => chain,
        eq: () => chain,
        order: () => chain,
        or: () => ((kind = 'week'), chain),
        // PostgREST's pages: at most 1,000 rows a request.
        range: async (from, to) => {
          db.pages += 1;
          return { data: (kind === 'week' ? db.week : db.due).slice(from, to + 1), error: null };
        },
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

const { renderDueEmail, renderWeeklyEmail, sendDueActions, sendWeeklyActions } =
  await import('./actions-digest.js');

const brands = { name: 'Acme', organization_id: 'o1' };
const action = (id, no, extra = {}) => ({
  id,
  brand_id: 'b1',
  action_no: no,
  brand_no: no,
  category: 'fix',
  brands,
  ...extra,
});
const MONDAY = new Date('2026-11-23T07:00:00Z');
const TUESDAY = new Date('2026-11-24T07:00:00Z');

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'k');
  vi.stubEnv('RESEND_FROM_EMAIL', 'hi@ansvisor.test');
  db.due = [];
  db.week = [];
  db.pages = 0;
  claims.taken = new Set();
  sendEmail.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('Overdue and due today (due_actions)', () => {
  it('lists each action with its due day and how late it is', () => {
    const { subject, html } = renderDueEmail(
      {
        brand: 'Acme',
        today: '2026-11-24',
        actions: [
          action('a1', 3, { due_date: '2026-11-22' }),
          action('a2', 4, { due_date: '2026-11-24' }),
        ],
      },
      'en',
    );
    expect(subject).toBe('Acme: 2 actions assigned to you due or late');
    expect(html).toContain('AC-03 · Fix · due Nov 22, 2 days late');
    expect(html).toContain('AC-04 · Fix · due today');
  });

  it('mails each assignee their own actions, daily or on Mondays, once, and only those who may see the brand', async () => {
    db.due = [
      action('a1', 3, { due_date: '2026-11-22', assignee_id: 'ana' }),
      action('a2', 4, { due_date: '2026-11-22', assignee_id: 'bo' }),
      action('a3', 5, { due_date: '2026-11-22', assignee_id: 'gone' }),
    ];
    audience.map = new Map([
      ['ana', 'daily'],
      ['bo', 'weekly'],
    ]);
    expect(await sendDueActions(TUESDAY)).toBe(1);
    expect(sendEmail.mock.calls[0][0].to).toEqual(['ana@acme.test']);
    expect(await sendDueActions(TUESDAY)).toBe(0);
    // Monday: Weekly too.
    expect(await sendDueActions(MONDAY)).toBe(2);
  });
});

describe('Weekly action summary (weekly_actions)', () => {
  it('says what was done and what’s open, and names the next three by priority', () => {
    const next = [action('a1', 7), action('a2', 8)];
    const { subject, html } = renderWeeklyEmail(
      { brand: 'Acme', completed: 3, open: 9, next },
      'en',
    );
    expect(subject).toBe('Acme: your week in the Action Center');
    expect(html).toContain('3 actions were completed; 9 are open.');
    expect(html).toContain('AC-07 · Fix');
  });

  it('goes on Mondays only, once, to those who chose it', async () => {
    db.week = [
      action('a1', 1, { status: 'new', priority_score: 40 }),
      action('a2', 2, { status: 'in_progress', priority_score: 90 }),
      action('a3', 3, { status: 'completed', completed_at: '2026-11-20T00:00:00Z' }),
    ];
    audience.map = new Map([
      ['ana', 'weekly'],
      ['bo', 'off'],
    ]);
    expect(await sendWeeklyActions(TUESDAY)).toBe(0);
    expect(await sendWeeklyActions(MONDAY)).toBe(1);
    const [mail] = sendEmail.mock.calls[0];
    expect(mail.to).toEqual(['ana@acme.test']);
    expect(mail.html).toContain('1 action was completed; 2 are open.');
    // The highest priority first.
    expect(mail.html.indexOf('AC-02')).toBeLessThan(mail.html.indexOf('AC-01'));
    expect(await sendWeeklyActions(MONDAY)).toBe(0);
  });
});

describe('more actions than one page (PostgREST’s 1,000 rows)', () => {
  it('reads every page, so the weekly summary counts them all', async () => {
    db.week = Array.from({ length: 1200 }, (_, i) =>
      action(`a${i}`, i + 1, { status: 'new', priority_score: i }),
    );
    audience.map = new Map([['ana', 'weekly']]);
    expect(await sendWeeklyActions(MONDAY)).toBe(1);
    expect(db.pages).toBe(2);
    expect(sendEmail.mock.calls[0][0].html).toMatch(/1,?200 are open/);
  });
});
