import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ actions: [], drafts: [] }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        order: () => chain,
        then: (resolve) =>
          resolve({ data: table === 'actions' ? db.actions : db.drafts, error: null }),
      };
      return chain;
    },
  },
}));
const audience = vi.hoisted(() => ({ map: new Map(), canceled: new Set() }));
vi.mock('./choices.js', async (importOriginal) => ({
  ...(await importOriginal()),
  brandAudience: async () => audience.map,
  ofActiveWorkspaces: async (groups) =>
    groups.filter((group) => !audience.canceled.has(group.organizationId)),
}));
const claims = vi.hoisted(() => ({ taken: new Set(), sent: [] }));
vi.mock('./sends.js', async (importOriginal) => ({
  ...(await importOriginal()),
  claimSend: async ({ kind, userId, subject }) => {
    const key = `${kind}|${userId}|${subject}`;
    if (claims.taken.has(key)) return false;
    claims.taken.add(key);
    return true;
  },
  markSent: async (send) => void claims.sent.push(send),
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

const { renderCriticalEmail, sendCriticalActionAlerts, sendCriticalActionSummaries } =
  await import('./critical-action.js');
const { renderDraftsEmail, sendDraftsReview } = await import('./drafts-review.js');

const brand = { name: 'Acme', organization_id: 'o1' };
const action = (id, no, category = 'recover') => ({
  id,
  brand_id: 'b1',
  action_no: no,
  brand_no: no,
  category,
  created_at: '2026-11-20T09:00:00Z',
  brands: brand,
});

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'k');
  vi.stubEnv('RESEND_FROM_EMAIL', 'hi@ansvisor.test');
  db.actions = [];
  db.drafts = [];
  audience.map = new Map([
    ['ana', 'instant'],
    ['bo', 'daily'],
    ['cy', 'off'],
  ]);
  audience.canceled = new Set();
  claims.taken = new Set();
  claims.sent = [];
  sendEmail.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('a new Critical action (critical_action)', () => {
  it('names one action by its code and category, with a link to it', () => {
    const { subject, html } = renderCriticalEmail(
      { brand: 'Acme', actions: [action('a1', 12)] },
      'en',
    );
    expect(subject).toBe('Acme: a new Critical action, AC-12');
    expect(html).toContain('AC-12 · Recover');
    expect(html).toContain('/dashboard/action-center/actions?action=a1');
    expect(html).toContain('/dashboard/settings?tab=notifications');
  });

  it('sends Right away once per action to those who chose it, and nothing without e-mail set up', async () => {
    db.actions = [action('a1', 12), action('a2', 13, 'fix')];
    expect(await sendCriticalActionAlerts(new Date('2026-11-20T10:00:00Z'))).toBe(2);
    expect(sendEmail.mock.calls.map(([m]) => [m.to[0], m.subject])).toEqual([
      ['ana@acme.test', 'Acme: a new Critical action, AC-12'],
      ['ana@acme.test', 'Acme: a new Critical action, AC-13'],
    ]);
    // Again: claimed, nothing goes twice.
    expect(await sendCriticalActionAlerts(new Date('2026-11-20T10:10:00Z'))).toBe(0);
    vi.stubEnv('RESEND_API_KEY', '');
    claims.taken.clear();
    expect(await sendCriticalActionAlerts()).toBe(0);
  });

  it('mails nothing for a workspace whose plan is canceled', async () => {
    db.actions = [action('a1', 12)];
    audience.canceled = new Set(['o1']);
    expect(await sendCriticalActionAlerts(new Date('2026-11-20T10:00:00Z'))).toBe(0);
    db.drafts = [{ id: 'd1', brand_id: 'b1', title: 'x', updated_at: '', brands: brand }];
    audience.map = new Map([['ana', 'daily']]);
    expect(await sendDraftsReview(new Date('2026-11-17T08:00:00Z'))).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends the day’s actions in one e-mail per brand to those who chose Daily summary', async () => {
    db.actions = [action('a1', 12), action('a2', 13)];
    expect(await sendCriticalActionSummaries(new Date('2026-11-20T10:00:00Z'))).toBe(1);
    const [mail] = sendEmail.mock.calls[0];
    expect(mail.to).toEqual(['bo@acme.test']);
    expect(mail.subject).toBe('Acme: 2 new Critical actions');
    expect(claims.sent).toEqual([
      expect.objectContaining({ userId: 'bo', subject: 'daily:2026-11-20:b1' }),
    ]);
  });
});

describe('drafts waiting for your review (drafts_review)', () => {
  const draft = (id, title) => ({
    id,
    brand_id: 'b1',
    title,
    updated_at: '2026-11-19T00:00:00Z',
    brands: brand,
  });

  it('lists up to ten drafts, and counts the rest', () => {
    const drafts = Array.from({ length: 12 }, (_, i) => draft(`d${i}`, i === 0 ? '' : `Page ${i}`));
    const { subject, html } = renderDraftsEmail({ brand: 'Acme', drafts }, 'en');
    expect(subject).toBe('Acme: 12 drafts wait for your review');
    expect(html).toContain('Untitled draft');
    expect(html).toContain('and 2 more');
    expect(html).toContain('/dashboard/content/library?tab=in_review');
  });

  it('sends Daily every day and Weekly on Mondays, once each, and nothing with no draft waiting', async () => {
    audience.map = new Map([
      ['ana', 'daily'],
      ['bo', 'weekly'],
      ['cy', 'off'],
    ]);
    expect(await sendDraftsReview(new Date('2026-11-17T08:00:00Z'))).toBe(0);
    db.drafts = [draft('d1', 'Pricing FAQ')];
    // Tuesday: Daily only.
    expect(await sendDraftsReview(new Date('2026-11-17T08:00:00Z'))).toBe(1);
    expect(sendEmail.mock.calls.at(-1)[0].to).toEqual(['ana@acme.test']);
    // Monday: both, once.
    expect(await sendDraftsReview(new Date('2026-11-23T08:00:00Z'))).toBe(2);
    expect(await sendDraftsReview(new Date('2026-11-23T20:00:00Z'))).toBe(0);
  });
});
