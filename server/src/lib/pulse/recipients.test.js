import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Daily Pulse's and the AI Traffic digest's recipients (brand access, spec
 * §5.4): an Admin's or Manager's list, less the members who can't see the
 * brand (an address that is no member's stays), else the members who can
 * see it — every member while everyone has All brands. Read before the
 * pulse is claimed, so a failed read leaves the day to the catch-up sweep.
 */

const emails = { u1: 'ana@acme.test', u2: 'bo@acme.test', u3: 'Cem@Acme.test' };
const db = vi.hoisted(() => ({
  lookups: [],
  tables: [],
  inserts: [],
  updates: [],
  // pulse_settings' row, and people's own choices (notification_preferences, 00554).
  settings: null,
  prefs: [],
  windows: [],
}));
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
        maybeSingle: async () => ({
          data: table === 'pulse_settings' ? db.settings : null,
          error: null,
        }),
        then: (resolve) =>
          resolve({
            data: table === 'notification_preferences' ? db.prefs : [],
            count: 0,
            error: null,
          }),
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
const hooks = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../webhook-dispatch.js', () => ({
  dispatchBrandWebhook: async () => (hooks.calls++, { sent: 1 }),
}));
vi.mock('./metrics.js', () => ({
  computePulseMetrics: async (_brandId, { windowDays }) => ({
    windowDays: db.windows.push(windowDays) && windowDays,
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
const { emailsOf, forgetEmails } = await import('./audience.js');

beforeEach(() => {
  forgetEmails();
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
  db.settings = null;
  db.prefs = [];
  db.windows = [];
  hooks.calls = 0;
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

describe("people's own choices (00554)", () => {
  const MONDAY = new Date('2026-11-16T09:00:00Z');
  const TUESDAY = new Date('2026-11-17T09:00:00Z');
  const pref = (user_id, frequency, brand_id = null) => ({ user_id, brand_id, frequency });

  afterEach(() => vi.useRealTimers());

  it('mails exactly the people it did before while nobody has saved', async () => {
    db.settings = { frequency: 'daily', recipients: ['ana@acme.test', 'client@partner.test'] };
    expect(await generatePulseForBrand('b1')).toMatchObject({ generated: true, emailSent: true });
    expect(sent.to).toEqual([['ana@acme.test', 'client@partner.test']]);
    // Nobody's e-mail is looked up for it, as before.
    expect(db.lookups).toEqual([]);
    expect(db.tables).toContain('notification_preferences');
  });

  it("leaves out a teammate who turned it off, and keeps the brand's list for the rest", async () => {
    db.prefs = [pref('u1', 'off')];
    expect(await generatePulseForBrand('b1')).toMatchObject({ generated: true, emailSent: true });
    expect(sent.to).toEqual([['bo@acme.test']]);

    // On a set list too: their address no longer speaks for them.
    sent.to = [];
    db.settings = { frequency: 'notable', recipients: ['ana@acme.test', 'client@partner.test'] };
    await generatePulseForBrand('b1');
    expect(sent.to).toEqual([['client@partner.test']]);
  });

  it("sends it to a teammate who picked it while the brand's own is off, without webhook or Slack", async () => {
    db.settings = { frequency: 'off', recipients: null };
    db.prefs = [pref('u2', 'daily')];
    expect(await generatePulseForBrand('b1')).toMatchObject({
      generated: true,
      emailSent: true,
      webhooksSent: 0,
      slackSent: false,
    });
    expect(sent.to).toEqual([['bo@acme.test']]);
    expect(hooks.calls).toBe(0);
    expect(slack.calls).toEqual([]);
    expect(db.inserts[0][1]).toMatchObject({ frequency: 'daily' });
  });

  it('sends nothing, and reads no recipients, while the brand and everyone are off', async () => {
    db.settings = { frequency: 'off', recipients: null };
    db.prefs = [pref('u1', 'off'), pref('u2', 'off')];
    expect(await generatePulseForBrand('b1')).toEqual({ skipped: 'off' });
    expect(db.inserts).toEqual([]);
    expect(sent.to).toEqual([]);
  });

  it("takes a brand's own row over All my brands", async () => {
    db.prefs = [pref('u1', 'off'), pref('u1', 'daily', 'b1'), pref('u2', 'daily', 'other')];
    await generatePulseForBrand('b1');
    // Bo saved, but only for another brand: the brand's list no longer speaks
    // for him, and he chose nothing here.
    expect(sent.to).toEqual([['ana@acme.test']]);
  });

  it('mails a weekly pick on Mondays only, with the last 7 days', async () => {
    db.prefs = [pref('u1', 'weekly')];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TUESDAY);
    await generatePulseForBrand('b1');
    expect(sent.to).toEqual([['bo@acme.test']]);
    expect(db.windows).toEqual([1]);

    sent.to = [];
    db.windows = [];
    vi.setSystemTime(MONDAY);
    await generatePulseForBrand('b1');
    // The brand's own (Only when notable) first, then the weekly one.
    expect(sent.to).toEqual([['bo@acme.test'], ['ana@acme.test']]);
    expect(db.windows).toEqual([1, 7]);
  });
});

describe('emailsOf', () => {
  it('reads each person once, keeps their order and skips those without an e-mail', async () => {
    expect(await emailsOf(['u3', 'u1', 'u9', 'u1'])).toEqual([
      'Cem@Acme.test',
      'ana@acme.test',
      'ana@acme.test',
    ]);
    expect(db.lookups).toEqual(['u3', 'u1', 'u9']);
  });

  it('answers a later ask for the same people without reading them again', async () => {
    await emailsOf(['u1', 'u2']);
    expect(await emailsOf(['u2', 'u1'])).toEqual(['bo@acme.test', 'ana@acme.test']);
    expect(db.lookups).toEqual(['u1', 'u2']);
    forgetEmails();
    await emailsOf(['u1']);
    expect(db.lookups).toEqual(['u1', 'u2', 'u1']);
  });
});
