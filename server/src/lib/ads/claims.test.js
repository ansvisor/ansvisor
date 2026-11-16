import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AD_CHANNELS, AD_LIMITS } from '../../config/ad-limits.js';
import { gateDraft, groundingFacts } from './claims.js';

/**
 * Ads' claims gate (ADS-01 §7a.2 rule 5, §9.5): by rule, on the brand's
 * approved facts, its competitors and the channels' confirmed limits.
 */

const fact = (id, kind, value, quote, over = {}) => ({
  id,
  kind,
  value,
  quote,
  sourceKind: kind === 'founded' ? 'about' : 'pricing',
  scope: null,
  status: 'approved',
  gone: false,
  ...over,
});
const price = (id, plan, amount, over) =>
  fact(
    id,
    'price',
    { plan, amount, currency: 'USD', period: 'month', billed: null, per: null },
    `$${amount} per month`,
    over,
  );
const FACTS = [
  price('pro', 'Pro', 49),
  price('business', 'Business', 199),
  fact('trial', 'trial', { days: 14 }, '14-day free trial'),
  fact('year', 'founded', { year: 2015 }, 'Founded in 2015'),
  fact('teams', 'claim', {}, 'Trusted by 2,000 teams'),
  // Not approved, or gone from the site: never grounds a draft.
  price('pending', 'Pro', 59, { status: 'pending' }),
  price('gone', 'Pro', 69, { gone: true }),
];
const COMPETITORS = [
  { name: 'Northwind', domain: 'northwind.example' },
  { name: 'Kestrel Books', domain: 'https://www.kestrel.example/' },
];
const facts = groundingFacts(FACTS, 'best bookkeeping app for small teams');
const gate = (draft, over = {}) =>
  gateDraft(
    {
      channel: 'google',
      headlines: ['Ledgerly Pro from $49/month'],
      descriptions: ['Bookkeeping for small teams. Trusted by 2,000 teams.'],
      contextHint: null,
      keywords: ['bookkeeping app'],
      claims: [
        { text: 'Ledgerly Pro from $49/month', factId: 'pro' },
        { text: 'Trusted by 2,000 teams', factId: 'teams' },
      ],
      ...draft,
    },
    { facts, brandName: 'Ledgerly', competitors: COMPETITORS, ...over },
  );
const codes = (result) => result.failures.map((f) => f.code);

describe('gateDraft', () => {
  it('passes a draft whose every claim and number is an approved fact', () => {
    expect(gate({})).toMatchObject({
      passed: true,
      failures: [],
      factIds: ['pro', 'teams'],
      keywords: ['bookkeeping app'],
      droppedKeywords: [],
      competitors: 'blocked',
    });
    // A trial in weeks is its days; the year it was founded.
    const trial = gate({
      headlines: ['Ledgerly: every plan has a 2-week free trial', 'Since 2015'],
      descriptions: ['Try it today.'],
      claims: [
        { text: '2-week free trial', factId: 'trial' },
        { text: 'Since 2015', factId: 'year' },
      ],
    });
    expect([trial.passed, trial.factIds]).toEqual([true, ['trial', 'year']]);
  });

  it('rejects a claim without a fact id, or with one not approved, gone or unknown', () => {
    expect(codes(gate({ claims: [{ text: 'Trusted by 2,000 teams', factId: null }] }))).toEqual([
      'claim_without_fact',
      // Its numbers aren't any fact's either.
      'number_without_fact',
      'number_without_fact',
    ]);
    for (const factId of ['pending', 'gone', 'made-up']) {
      const result = gate({
        headlines: ['Bookkeeping for small teams'],
        descriptions: ['Simple books.'],
        claims: [{ text: 'Simple books', factId }],
      });
      expect([result.passed, codes(result)], factId).toEqual([false, ['unknown_fact']]);
    }
  });

  it('rejects a wrong price or trial, and any number no fact claimed holds', () => {
    // Business's $199 is a fact, but not Pro's: Trust's check reads the plan's.
    const plan = gate({
      headlines: ['Ledgerly Pro costs $199 a month'],
      claims: [{ text: 'Ledgerly Pro costs $199 a month', factId: 'business' }],
      descriptions: ['Bookkeeping for small teams.'],
    });
    expect(plan.failures).toEqual([
      { code: 'fact_mismatch', detail: { kind: 'price', page: '$199', fact: '$49' } },
    ]);
    expect(codes(gate({ headlines: ['Ledgerly Pro: $59 a month'] }))).toEqual([
      'number_without_fact',
      'fact_mismatch',
    ]);
    const trial = gate({
      headlines: ['Try Ledgerly free for 30 days'],
      descriptions: ['Every plan has a free trial.'],
      claims: [{ text: 'free for 30 days', factId: 'trial' }],
    });
    expect(trial.failures).toEqual([
      { code: 'number_without_fact', at: 'headlines[0]', detail: 30 },
      { code: 'fact_mismatch', detail: { kind: 'trial', page: '30-day', fact: '14-day' } },
    ]);
    // A number of no fact: 24/7, a rank, a year that isn't the founding one.
    const invented = gate({ descriptions: ['24/7 support, #1 in 2026.'] });
    expect(invented.failures.map((f) => f.detail)).toEqual([24, 7, 1, 2026]);
  });

  it("blocks a competitor's name or domain in the text, and drops a keyword naming one", () => {
    for (const text of [
      'Ledgerly vs Northwind',
      'A NORTHWIND alternative',
      'Better than northwind.example',
      'Leave kestrel.example today',
      'Kestrel Books, without the fees',
    ]) {
      const result = gate({ headlines: [text] });
      expect([result.passed, codes(result)], text).toEqual([false, ['competitor_named']]);
    }
    const kept = gate({
      keywords: ['northwind alternative', 'bookkeeping app', 'Bookkeeping  app', 'kestrel books'],
    });
    expect(kept).toMatchObject({
      passed: true,
      keywords: ['bookkeeping app'],
      droppedKeywords: ['northwind alternative', 'kestrel books'],
    });
    // A word inside another isn't the name.
    expect(gate({ headlines: ['Northwinds of change'] }).passed).toBe(true);
  });

  it('checks a confirmed limit, and reports every field whose limit is still to confirm', () => {
    // Today none is confirmed (config/ad-limits.js): each draft says so.
    for (const channel of AD_CHANNELS) {
      expect(AD_LIMITS[channel], channel).toBeDefined();
      expect(
        Object.values(AD_LIMITS[channel]).every((v) => v === null),
        channel,
      ).toBe(true);
    }
    expect(gate({})).toMatchObject({
      limits: 'unconfirmed',
      unconfirmed: ['headline', 'description'],
    });
    const chatgpt = gate({ channel: 'chatgpt', contextHint: 'For small teams comparing apps' });
    expect(chatgpt).toMatchObject({
      passed: true,
      limits: 'unconfirmed',
      unconfirmed: ['headline', 'description', 'contextHint'],
    });
    // Test limits, not a channel's.
    const limits = { google: { headline: 20, description: null } };
    expect(gate({}, { limits })).toMatchObject({
      passed: false,
      failures: [{ code: 'too_long', at: 'headlines[0]', detail: { max: 20, length: 27 } }],
      limits: 'unconfirmed',
      unconfirmed: ['description'],
    });
    const confirmed = { google: { headline: 40, description: 80 } };
    expect(gate({}, { limits: confirmed })).toMatchObject({ passed: true, limits: 'confirmed' });
  });

  it("holds each channel's draft to its fields", () => {
    expect(codes(gate({ contextHint: 'A hint' }))).toEqual(['shape']);
    expect(codes(gate({ headlines: [] }))).toEqual(['shape']);
    expect(codes(gate({ channel: 'meta' }))).toEqual(['shape']);
    const chatgpt = gate({ channel: 'chatgpt', headlines: ['One', 'Two'], contextHint: ' ' });
    expect(chatgpt.failures.map((f) => f.at)).toEqual(['headlines', 'contextHint']);
  });
});

describe('groundingFacts', () => {
  it("keeps the brand's facts and the scopes the prompt names, never another place's", () => {
    const ferry = [
      price('any', 'Day pass', 20),
      price('bozcaada', 'Day pass', 25, { scope: 'Bozcaada' }),
      price('gokceada', 'Day pass', 30, { scope: 'Gökçeada' }),
    ];
    const grounded = groundingFacts(ferry, 'Ferry tickets to BOZCAADA this summer');
    expect(grounded.map((f) => f.id)).toEqual(['any', 'bozcaada']);
    // A claim on the other island's fact, or its price, doesn't pass: the day pass is $20 or $25 here.
    const result = gateDraft(
      {
        channel: 'google',
        headlines: ['Day pass $30'],
        descriptions: ['Ferries every hour.'],
        claims: [{ text: 'Day pass $30', factId: 'gokceada' }],
      },
      { facts: grounded, brandName: 'Seaways' },
    );
    expect(codes(result)).toEqual(['unknown_fact', 'number_without_fact', 'fact_mismatch']);
    expect(groundingFacts(FACTS, '').map((f) => f.id)).toEqual([
      'pro',
      'business',
      'trial',
      'year',
      'teams',
    ]);
  });
});

describe('config/ad-limits.js', () => {
  it('has no limit without the official page it was read from', () => {
    const src = readFileSync(new URL('../../config/ad-limits.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('export const AD_LIMITS'));
    for (const line of block.split('\n').filter((l) => /:\s*\d/.test(l))) {
      expect(line, 'a limit cites its source on its line').toMatch(/https:\/\//);
    }
  });
});
