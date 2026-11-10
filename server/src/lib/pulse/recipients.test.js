import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Daily Pulse's and the AI Traffic digest's recipients (brand access, spec
 * §5.4): an Admin's or Manager's list, less the members who can't see the
 * brand (an address that is no member's stays), else the members who can
 * see it — every member while everyone has All brands. Read before the
 * pulse is claimed, so a failed read leaves the day to the catch-up sweep.
 */

const emails = { u1: 'ana@acme.test', u2: 'bo@acme.test', u3: 'Cem@Acme.test' };
const db = vi.hoisted(() => ({ lookups: [], tables: [], inserts: [], updates: [] }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      db.tables.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        limit: () => chain,
        insert: (row) => (db.inserts.push([table, row]), chain),
        update: (patch) => (db.updates.push([table, patch]), chain),
        single: async () =>
          table === 'brands'
            ? {
                data: { id: 'b1', name: 'Acme', organization_id: 'org-1', is_active: true },
                error: null,
              }
            : table === 'organizations'
              ? { data: { subscription_status: 'active' }, error: null }
              : { data: { id: 'pulse-1' }, error: null },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve) => resolve({ data: [], count: 0, error: null }),
      };
      return chain;
    },
    auth: {
      admin: {
        getUserById: async (id) => (db.lookups.push(id), { data: { user: { email: emails[id] } } }),
      },
    },
  },
}));
const asked = vi.hoisted(() => ({
  calls: [],
  readers: new Map(),
  outsiders: [],
  error: null,
}));
vi.mock('../access.js', () => ({
  brandReaders: async (...args) => {
    asked.calls.push(['readers', ...args]);
    if (asked.error) throw asked.error;
    return asked.readers;
  },
  brandOutsiders: async (...args) => {
    asked.calls.push(['outsiders', ...args]);
    if (asked.error) throw asked.error;
    return asked.outsiders;
  },
}));
vi.mock('../../config/plans.js', () => ({
  isCloud: () => true,
  isSubscriptionActive: () => true,
}));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ logger, default: logger }));
vi.mock('../webhook-dispatch.js', () => ({ dispatchBrandWebhook: async () => ({ sent: 1 }) }));
vi.mock('./metrics.js', () => ({
  computePulseMetrics: async () => ({
    kpis: { totalResults: 12 },
    highlights: [],
    warnings: [],
    degradedPlatforms: [],
  }),
}));
const sent = vi.hoisted(() => ({ to: [] }));
vi.mock('./email.js', () => ({
  renderPulseEmail: () => ({ subject: 'Pulse', html: '<p>Pulse</p>' }),
  sendPulseEmail: async ({ to }) => (sent.to.push(to), true),
}));

// The Slack leg (#2139): lib/slack/deliver.js decides and posts; here, what it is asked.
const slack = vi.hoisted(() => ({
  calls: [],
  answer: { status: 'skipped', reason: 'not_connected' },
}));
vi.mock('../slack/deliver.js', () => ({
  deliverToSlack: async (input) => (slack.calls.push(input), slack.answer),
}));

const { generatePulseForBrand, resolveRecipients } = await import('./engine.js');

beforeEach(() => {
  asked.calls = [];
  asked.readers = new Map([
    ['u1', new Set(['b1'])],
    ['u2', new Set(['b1'])],
  ]);
  asked.outsiders = [];
  asked.error = null;
  db.lookups = [];
  db.tables = [];
  db.inserts = [];
  db.updates = [];
  sent.to = [];
  slack.calls = [];
  slack.answer = { status: 'skipped', reason: 'not_connected' };
  logger.error.mockClear();
});

describe('resolveRecipients', () => {
  it('sends to the members who can see the brand', async () => {
    expect(await resolveRecipients('org-1', {}, 'b1')).toEqual(['ana@acme.test', 'bo@acme.test']);
    expect(asked.calls).toEqual([['readers', 'org-1', ['b1']]]);
    // Someone who can't see it isn't among them.
    asked.readers = new Map([['u2', new Set(['b1'])]]);
    expect(await resolveRecipients('org-1', null, 'b1')).toEqual(['bo@acme.test']);
  });

  it('keeps a set list as it is while everyone has All brands', async () => {
    const list = ['ana@acme.test', 'team@acme.test'];
    expect(await resolveRecipients('org-1', { recipients: list }, 'b1')).toEqual(list);
    expect(asked.calls).toEqual([['outsiders', 'org-1', 'b1']]);
    // Nobody's e-mail is looked up for it.
    expect(db.lookups).toEqual([]);
  });

  it('drops a member who can’t see the brand from a set list, whatever its case', async () => {
    asked.outsiders = ['u1', 'u3'];
    const list = ['ANA@acme.test', ' cem@acme.test', 'bo@acme.test', 'client@partner.test'];
    // A member who can still see it, and an address that is no member's, stay.
    expect(await resolveRecipients('org-1', { recipients: list }, 'b1')).toEqual([
      'bo@acme.test',
      'client@partner.test',
    ]);
    expect(db.lookups).toEqual(['u1', 'u3']);
  });
});

describe('generatePulseForBrand', () => {
  it('mails the brand’s readers', async () => {
    expect(await generatePulseForBrand('b1')).toMatchObject({ generated: true, emailSent: true });
    expect(sent.to).toEqual([['ana@acme.test', 'bo@acme.test']]);
  });

  it('claims nothing when the recipients can’t be read, so the catch-up sweep sends it', async () => {
    asked.error = new Error('503 Service Unavailable');
    expect(await generatePulseForBrand('b1')).toEqual({ error: true });
    // No sent_pulses claim, no webhook, no mail.
    expect(db.inserts).toEqual([]);
    expect(sent.to).toEqual([]);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("posts the Pulse to the brand's Slack channel once a day, and records it when it went", async () => {
    expect(await generatePulseForBrand('b1')).toMatchObject({ generated: true, slackSent: false });
    expect(slack.calls).toHaveLength(1);
    const [call] = slack.calls;
    expect(call).toMatchObject({
      brand: { id: 'b1', name: 'Acme', organization_id: 'org-1' },
      kind: 'pulse',
      dedupeKey: `pulse:${new Date().toISOString().slice(0, 10)}`,
    });
    // Worded only when it goes: the deliverer calls it once its checks pass.
    expect(typeof call.message).toBe('function');
    // Not sent: sent_pulses says nothing of Slack.
    expect(db.updates.filter(([, patch]) => 'slack_sent' in patch)).toEqual([]);

    slack.answer = { status: 'sent', ts: '1.2' };
    expect(await generatePulseForBrand('b1')).toMatchObject({ generated: true, slackSent: true });
    expect(db.updates).toContainEqual(['sent_pulses', { slack_sent: true }]);
  });
});
