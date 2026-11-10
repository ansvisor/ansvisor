import { describe, expect, it } from 'vitest';
import { buildCancelAnalysisEmail } from './follow-up-email.js';

/**
 * The follow-up in the cancel e-mail's thread: the AI's analysis first, then
 * the data, every part escaped, and one line for each part that failed.
 */

const subject = 'Acme Coffee cancelled their plan';
const activity = {
  ok: true,
  days: 14,
  totals: { activeDays: 2, sessions: 3, pageviews: 1234, lastSeen: '2026-11-09T16:45:00.000Z' },
  truncated: false,
  dayByDay: [
    {
      day: '2026-11-08',
      pages: ['/dashboard', '/dashboard/brands/:id/prompts'],
      morePages: 4,
      events: [{ event: 'prompt_added', count: 2 }],
      sessions: [
        {
          id: '019a6b2c-1111-7000-8000-00000000c0de',
          url: 'https://eu.posthog.com/project/1/replay/019a6b2c-1111-7000-8000-00000000c0de',
        },
      ],
    },
    {
      day: '2026-11-09',
      pages: [],
      morePages: 0,
      events: [],
      sessions: [],
    },
  ],
  friction: {
    walls: [{ feature: 'brands', count: 2, reasons: ['limit'], sources: [] }],
    errorsByPage: [{ page: '/dashboard/content', count: 1, kinds: ['server'] }],
    flowsNotFinished: [
      {
        flow: 'cms_connect',
        started: 2,
        completed: 0,
        failed: 1,
        notCompleted: 2,
        errorCodes: ['401'],
        targets: [],
      },
    ],
    clicksByPage: [{ page: '/dashboard/brands/:id/prompts', rage: 4, dead: 1 }],
    cancelFlow: [{ event: 'subscription_canceled', at: '2026-11-09T16:40:00.000Z' }],
  },
  replays: [
    {
      id: '019a6b2c-1111-7000-8000-00000000c0de',
      score: 5,
      day: '2026-11-08',
      page: '/dashboard/brands/:id/prompts',
      rage: 4,
      dead: 1,
      errors: 0,
      walls: 0,
      failedFlows: 0,
      url: 'https://eu.posthog.com/project/1/replay/019a6b2c-1111-7000-8000-00000000c0de',
    },
  ],
  personUrl: 'https://eu.posthog.com/project/1/person/u1',
};
const featureUse = [
  { key: 'cms', label: 'Connected a CMS', count: 0 },
  { key: 'competitors', label: 'Added competitors', count: 4 },
  { key: 'chat', label: 'Used Chat', count: null },
];
const ai = {
  ok: true,
  why: 'Marka sınırına iki kez takılmış ve WordPress bağlanamamış.',
  fixes: [{ item: 'WordPress bağlantı hatası', evidence: 'cms_connect 2 başladı, 0 bitti' }],
};

const build = (overrides = {}) =>
  buildCancelAnalysisEmail({ subject, activity, featureUse, ai, ...overrides });

describe('buildCancelAnalysisEmail', () => {
  it('answers the first e-mail: "Re:" its subject', () => {
    expect(build().subject).toBe('Re: Acme Coffee cancelled their plan');
  });

  it('puts the AI’s analysis first, then day by day, stuck, replays, not used and PostHog', () => {
    const { html } = build();
    const order = [
      'Neden iptal etmiş olabilir?',
      'Marka sınırına iki kez takılmış',
      'Bizim düzeltmemiz gerekenler',
      'WordPress bağlantı hatası',
      'Day by day (last 14 days, UTC)',
      'Where they got stuck',
      'Replays to watch',
      'Not used',
      'Open their PostHog profile and replays',
    ];
    const at = order.map((text) => html.indexOf(text));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('shows each day’s pages, events and sessions', () => {
    const { html } = build();
    expect(html).toContain(
      '2 active days · 3 sessions · 1,234 page views · last seen November 9, 16:45 UTC',
    );
    expect(html).toContain('Sun, November 8');
    expect(html).toContain('/dashboard → /dashboard/brands/:id/prompts');
    expect(html).toContain('+4 more');
    expect(html).toContain('prompt_added ×2');
    expect(html).toContain(
      '<a href="https://eu.posthog.com/project/1/replay/019a6b2c-1111-7000-8000-00000000c0de" style="color:#1C1A17;">00c0de</a>',
    );
    expect(html).toContain('No page views');
    expect(html).toContain('No product events');
  });

  it('shows where they got stuck and the replays to watch', () => {
    const { html } = build();
    for (const text of [
      'Upgrade walls',
      'brands',
      '×2 · reason limit',
      'Errors',
      '/dashboard/content',
      '×1 · server',
      'Flows not finished',
      'cms_connect',
      'started 2 · completed 0 · failed 1 · codes 401',
      'Rage and dead clicks',
      '4 rage clicks · 1 dead click',
      'Cancel flow',
      'subscription_canceled',
      'November 9, 16:40 UTC',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain(
      '<a href="https://eu.posthog.com/project/1/replay/019a6b2c-1111-7000-8000-00000000c0de" style="color:#1C1A17;">Watch</a> Sun, November 8 · /dashboard/brands/:id/prompts',
    );
    expect(html).toContain('— 4 rage clicks, 1 dead click');
  });

  it('says what the workspace never used', () => {
    const { html } = build();
    expect(html).toMatch(/>Connected a CMS<\/td><td[^>]*font-weight:600;">Never<\/td>/);
    expect(html).toMatch(/>Added competitors<\/td><td[^>]*>Yes \(4\)<\/td>/);
    expect(html).toMatch(/>Used Chat<\/td><td[^>]*>Couldn't read<\/td>/);
  });

  it('says in one line when the AI didn’t answer, and keeps the data', () => {
    const { html } = build({ ai: { ok: false } });
    expect(html).toContain(
      "The AI analysis didn't come back, so this e-mail has only the data below.",
    );
    expect(html).not.toContain('Neden iptal etmiş olabilir?');
    expect(html).toContain('Where they got stuck');
  });

  it('says in one line when PostHog didn’t answer, and keeps the rest', () => {
    const { html } = build({ activity: { ok: false } });
    expect(html).toContain("PostHog didn't answer, so there is no activity.");
    expect(html).not.toContain('Where they got stuck');
    expect(html).not.toContain('PostHog profile');
    expect(html).toContain('Neden iptal etmiş olabilir?');
    expect(html).toContain('Not used');
  });

  it('says when nothing went wrong and nothing is worth watching', () => {
    const { html } = build({
      activity: {
        ...activity,
        friction: {
          walls: [],
          errorsByPage: [],
          flowsNotFinished: [],
          clicksByPage: [],
          cancelFlow: [],
        },
        replays: [],
      },
    });
    expect(html).toContain('Nothing recorded');
    expect(html).toContain('No session had friction to watch.');
  });

  it('escapes everything it shows', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { html } = build({
      ai: { ok: true, why: `<script>x()</script>`, fixes: [{ item: evil, evidence: evil }] },
      activity: {
        ...activity,
        dayByDay: [
          { ...activity.dayByDay[0], pages: [`/${evil}`], events: [{ event: evil, count: 1 }] },
        ],
        personUrl: 'https://eu.posthog.com/project/1/person/"><script>y</script>',
      },
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x()&lt;/script&gt;');
    expect(html).toContain('/&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain(
      'href="https://eu.posthog.com/project/1/person/&quot;&gt;&lt;script&gt;',
    );
  });

  it('tells the team a reply stays with them', () => {
    expect(build().html).toContain("a reply to this e-mail doesn't go to the customer");
  });
});
