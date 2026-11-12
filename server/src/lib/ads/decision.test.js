import { describe, expect, it } from 'vitest';
import { AD_CHANNELS, DECISIONS, REASON_CODES, RULES, channelsFor, earnOrPay } from './decision.js';

/**
 * Earn or pay (ADS-01 §2), one case per row of the table, then what the
 * table leaves to the rule: the order rows are checked in, paid not
 * measured, the volume threshold, and where paying can happen.
 */

const RIVAL = '7d1f0c52-5e3b-4b8a-9b51-2c4a0e6f8a11';
// The engines Ansvisor tracks: ChatGPT, Claude, Gemini, Google AI Overviews,
// Google AI Mode and Bing AI Mode (copilot-web).
const ALL_ENGINES = [
  'chatgpt-web',
  'claude',
  'gemini-web',
  'google-aio',
  'google-aimode',
  'copilot-web',
];

/** A measured standing, overridden per case. */
const standing = (over = {}) => ({
  weCited: false,
  ourPosition: null,
  leader: 'none',
  rivalPays: false,
  wePay: false,
  volume: 5000,
  engines: ALL_ENGINES,
  ...over,
});

const codes = (result) => result.reasons.map((r) => r.code);

describe('earnOrPay: the §2 table, one case per row', () => {
  it('row 1: we are cited in the top answers and no rival pays → earn (protect)', () => {
    const result = earnOrPay(standing({ weCited: true, ourPosition: 2, leader: 'none' }));
    expect(result).toEqual({
      decision: 'earn',
      rule: 'protect',
      reasons: [{ code: 'we_cited' }, { code: 'no_rival_pays' }],
      channels: [],
      noAdChannel: ['claude', 'gemini-web'],
      paidMeasured: true,
    });
  });

  it('row 2: a rival leads organically and the prompt has volume → earn + pay', () => {
    const result = earnOrPay(standing({ leader: RIVAL, ourPosition: 3, volume: 5000 }));
    expect(result).toEqual({
      decision: 'earn_pay',
      rule: 'rival_leads',
      reasons: [
        { code: 'rival_leads', competitorId: RIVAL },
        { code: 'volume_at_least', volume: 5000, threshold: 1000 },
      ],
      channels: ['chatgpt', 'google', 'microsoft'],
      noAdChannel: ['claude', 'gemini-web'],
      paidMeasured: true,
    });
  });

  it('row 3: we lead organically but a rival pays on it → pay (defend)', () => {
    const result = earnOrPay(
      standing({ leader: 'us', ourPosition: 1, weCited: true, rivalPays: true }),
    );
    expect(result).toEqual({
      decision: 'pay',
      rule: 'defend',
      reasons: [{ code: 'we_lead', position: 1 }, { code: 'rival_pays' }],
      channels: ['chatgpt', 'google', 'microsoft'],
      noAdChannel: ['claude', 'gemini-web'],
      paidMeasured: true,
    });
  });

  it('row 4: no one leads and no one pays → earn, the cheapest to win with content', () => {
    const result = earnOrPay(standing({ volume: 400 }));
    expect(result).toEqual({
      decision: 'earn',
      rule: 'open',
      reasons: [
        { code: 'no_leader' },
        { code: 'no_rival_pays' },
        { code: 'volume_below', volume: 400, threshold: 1000 },
      ],
      channels: [],
      noAdChannel: ['claude', 'gemini-web'],
      paidMeasured: true,
    });
  });

  it('row 4: ... and paid too only from the volume threshold up → earn + pay', () => {
    const result = earnOrPay(standing({ volume: 1000 }));
    expect(result.decision).toBe('earn_pay');
    expect(result.rule).toBe('open');
    expect(result.reasons).toContainEqual({
      code: 'volume_at_least',
      volume: 1000,
      threshold: 1000,
    });
    expect(result.channels).toEqual(['chatgpt', 'google', 'microsoft']);
  });

  it('row 5: we pay, but we are already cited → overlap, a candidate for savings', () => {
    const result = earnOrPay(standing({ weCited: true, wePay: true }));
    expect(result).toEqual({
      decision: 'overlap',
      rule: 'overlap',
      reasons: [{ code: 'we_pay' }, { code: 'we_cited' }],
      channels: [],
      noAdChannel: ['claude', 'gemini-web'],
      paidMeasured: true,
    });
  });
});

describe('earnOrPay: where rows meet, and what the table leaves open', () => {
  it('defends rather than calling it overlap when a rival pays on a prompt we lead', () => {
    const result = earnOrPay(
      standing({ leader: 'us', weCited: true, rivalPays: true, wePay: true }),
    );
    expect(result.decision).toBe('pay');
    expect(result.rule).toBe('defend');
    expect(codes(result)).toEqual(['we_lead', 'rival_pays', 'we_pay']);
  });

  it('calls it overlap even where a rival leads: we already pay and are cited', () => {
    const result = earnOrPay(standing({ leader: RIVAL, weCited: true, wePay: true }));
    expect(result.decision).toBe('overlap');
  });

  it('a rival leading wins over our being cited: pay to show up now', () => {
    const result = earnOrPay(standing({ leader: RIVAL, weCited: true, ourPosition: 2 }));
    expect(result.decision).toBe('earn_pay');
    expect(result.rule).toBe('rival_leads');
  });

  it('a rival leading a prompt with too little volume is earn', () => {
    const result = earnOrPay(standing({ leader: RIVAL, volume: 999 }));
    expect(result.decision).toBe('earn');
    expect(result.rule).toBe('rival_leads');
    expect(result.reasons).toContainEqual({ code: 'volume_below', volume: 999, threshold: 1000 });
  });

  it('never pays on a volume that was not measured', () => {
    for (const volume of [null, undefined, Number.NaN, -1, '5000']) {
      const result = earnOrPay(standing({ leader: RIVAL, volume }));
      expect(result.decision, String(volume)).toBe('earn');
      expect(result.reasons).toContainEqual({ code: 'volume_not_measured', threshold: 1000 });
    }
  });

  it('protects a prompt we lead even where our pages are not cited', () => {
    const result = earnOrPay(standing({ leader: 'us', ourPosition: 1, weCited: false }));
    expect(result.decision).toBe('earn');
    expect(result.rule).toBe('protect');
    expect(codes(result)).toEqual(['we_lead', 'no_rival_pays']);
  });

  it('a rival paying where no one leads: earn, and pay from the volume threshold', () => {
    const high = earnOrPay(standing({ rivalPays: true, weCited: true }));
    expect(high.decision).toBe('earn_pay');
    expect(high.rule).toBe('rival_pays');
    expect(codes(high)).toEqual(['no_leader', 'we_cited', 'rival_pays', 'volume_at_least']);
    expect(earnOrPay(standing({ rivalPays: true, volume: 10 })).decision).toBe('earn');
  });

  it('reads an empty or missing leader as no one leading', () => {
    for (const leader of ['none', '', '   ', null, undefined]) {
      expect(earnOrPay(standing({ leader, volume: 0 })).rule, String(leader)).toBe('open');
    }
  });
});

describe('earnOrPay: paid not measured (null), today’s normal case', () => {
  const unmeasured = (over) => standing({ rivalPays: null, wePay: null, ...over });

  it('never says pay (defend) or overlap, whatever else holds', () => {
    const seen = new Set();
    for (const weCited of [true, false]) {
      for (const leader of ['us', RIVAL, 'none']) {
        for (const ourPosition of [null, 1, 4]) {
          for (const volume of [null, 0, 999, 1000, 50000]) {
            const result = earnOrPay(unmeasured({ weCited, leader, ourPosition, volume }));
            seen.add(result.decision);
            expect(result.decision).not.toBe('pay');
            expect(result.decision).not.toBe('overlap');
            expect(result.rule).not.toBe('defend');
            expect(result.rule).not.toBe('overlap');
            expect(result.paidMeasured).toBe(false);
            expect(result.reasons).toContainEqual({
              code: 'paid_not_measured',
              rivalPays: true,
              wePay: true,
            });
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(['earn', 'earn_pay']);
  });

  it('protects a prompt we are cited for, and says paid is not measured', () => {
    const result = earnOrPay(unmeasured({ weCited: true, leader: 'us', ourPosition: 1 }));
    expect(result).toMatchObject({ decision: 'earn', rule: 'protect', paidMeasured: false });
    expect(codes(result)).toEqual(['we_lead', 'we_cited', 'paid_not_measured']);
  });

  it('reads anything but true or false as not measured', () => {
    for (const value of [undefined, 'true', 1, 0, 'yes']) {
      const result = earnOrPay(standing({ leader: 'us', rivalPays: value, wePay: value }));
      expect(result.rule).toBe('protect');
      expect(result.paidMeasured).toBe(false);
    }
  });

  it('defends only on a rival seen paying, and calls nothing overlap before a rival is measured', () => {
    // Our ads seen, a rival's not measured: our paying may be defence.
    const ours = earnOrPay(standing({ weCited: true, wePay: true, rivalPays: null }));
    expect(ours.decision).toBe('earn');
    expect(ours.rule).toBe('protect');
    expect(ours.reasons).toContainEqual({
      code: 'paid_not_measured',
      rivalPays: true,
      wePay: false,
    });
    // A rival seen paying, ours not measured: defending needs only the rival.
    const theirs = earnOrPay(standing({ leader: 'us', rivalPays: true, wePay: null }));
    expect(theirs.rule).toBe('defend');
    expect(theirs.paidMeasured).toBe(false);
  });
});

describe('earnOrPay: thresholds', () => {
  it('uses the defaults: 1,000 Google searches a month, and leading means named first', () => {
    expect(earnOrPay(standing({ leader: RIVAL, volume: 999 })).decision).toBe('earn');
    expect(earnOrPay(standing({ leader: RIVAL, volume: 1000 })).decision).toBe('earn_pay');
    expect(earnOrPay(standing({ leader: RIVAL, ourPosition: 2 })).rule).toBe('rival_leads');
  });

  it("takes a workspace's own volume threshold", () => {
    const result = earnOrPay(standing({ leader: RIVAL, volume: 300 }), { minPaidVolume: 250 });
    expect(result.decision).toBe('earn_pay');
    expect(result.reasons).toContainEqual({
      code: 'volume_at_least',
      volume: 300,
      threshold: 250,
    });
    expect(earnOrPay(standing({ volume: 5000 }), { minPaidVolume: 10000 }).decision).toBe('earn');
  });

  it("takes a workspace's own lead position: named second can count as leading", () => {
    const rivalPays = standing({ leader: RIVAL, ourPosition: 2, rivalPays: true });
    expect(earnOrPay(rivalPays).rule).toBe('rival_leads');
    expect(earnOrPay(rivalPays, { leadPosition: 2 })).toMatchObject({
      decision: 'pay',
      rule: 'defend',
      reasons: [{ code: 'we_lead', position: 2 }, { code: 'rival_pays' }],
    });
  });

  it('ignores a threshold that is not a sensible number', () => {
    for (const minPaidVolume of [-5, Number.NaN, Infinity, '10', null]) {
      expect(earnOrPay(standing({ leader: RIVAL, volume: 999 }), { minPaidVolume }).decision).toBe(
        'earn',
      );
    }
  });
});

describe('earnOrPay: channels', () => {
  it('suggests channels only when paying, in the owner’s order', () => {
    const engines = ['copilot-web', 'google-aimode', 'chatgpt-web', 'google-aio'];
    expect(earnOrPay(standing({ leader: RIVAL, engines })).channels).toEqual([
      'chatgpt',
      'google',
      'microsoft',
    ]);
    expect(earnOrPay(standing({ weCited: true, engines })).channels).toEqual([]);
  });

  it('names Claude and Gemini as carrying no ads, rather than giving them a channel', () => {
    const result = earnOrPay(standing({ leader: RIVAL, engines: ['claude', 'gemini-web'] }));
    expect(result.decision).toBe('earn');
    expect(result.rule).toBe('rival_leads');
    expect(result.channels).toEqual([]);
    expect(result.noAdChannel).toEqual(['claude', 'gemini-web']);
    expect(result.reasons.at(-1)).toEqual({
      code: 'no_ad_channel',
      engines: ['claude', 'gemini-web'],
    });
  });

  it('drops the pay part, and says why, when the prompt is tracked nowhere', () => {
    for (const engines of [[], undefined, null]) {
      const result = earnOrPay(standing({ leader: 'us', rivalPays: true, engines }));
      expect(result.decision).toBe('earn');
      expect(result.rule).toBe('defend');
      expect(codes(result).at(-1)).toBe('no_ad_channel');
    }
  });

  it('pays where the engines that carry ads are: Google alone for AIO and AI Mode', () => {
    const result = earnOrPay(
      standing({ leader: RIVAL, engines: ['google-aio', 'google-aimode', 'gemini-web'] }),
    );
    expect(result.decision).toBe('earn_pay');
    expect(result.channels).toEqual(['google']);
    expect(result.noAdChannel).toEqual(['gemini-web']);
  });
});

describe('channelsFor', () => {
  it('maps every tracked engine: three to a channel, Claude and Gemini to none', () => {
    expect(channelsFor(ALL_ENGINES)).toEqual({
      channels: ['chatgpt', 'google', 'microsoft'],
      noAdChannel: ['claude', 'gemini-web'],
    });
    expect(AD_CHANNELS['chatgpt-shopping']).toBe('chatgpt');
    expect(AD_CHANNELS.claude).toBeUndefined();
    expect(AD_CHANNELS['gemini-web']).toBeUndefined();
  });

  it('gives no channel to an engine it does not know, and drops repeats and blanks', () => {
    expect(
      channelsFor(['grok-web', 'chatgpt-web', 'chatgpt-web', '', null, 'toString', 'claude']),
    ).toEqual({ channels: ['chatgpt'], noAdChannel: ['grok-web', 'toString', 'claude'] });
  });
});

describe('earnOrPay: its output', () => {
  const cases = [];
  for (const weCited of [true, false]) {
    for (const leader of ['us', RIVAL, 'none']) {
      for (const rivalPays of [true, false, null]) {
        for (const wePay of [true, false, null]) {
          for (const volume of [null, 10, 5000]) {
            for (const engines of [ALL_ENGINES, ['claude']]) {
              cases.push(standing({ weCited, leader, rivalPays, wePay, volume, engines }));
            }
          }
        }
      }
    }
  }

  it('is always a known decision and rule, with reasons as fact codes, not sentences', () => {
    for (const input of cases) {
      const result = earnOrPay(input);
      expect(DECISIONS).toContain(result.decision);
      expect(RULES).toContain(result.rule);
      expect(result.reasons.length).toBeGreaterThan(0);
      for (const reason of result.reasons) {
        expect(REASON_CODES).toContain(reason.code);
        for (const value of Object.values(reason)) {
          expect(typeof value === 'string' ? value : '').not.toMatch(/\s/);
        }
      }
      const pays = result.decision === 'pay' || result.decision === 'earn_pay';
      expect(result.channels.length > 0).toBe(pays);
    }
  });

  it('is pure: the same answer each time, and its input left as it was', () => {
    for (const input of cases.slice(0, 40)) {
      const frozen = Object.freeze({ ...input, engines: Object.freeze([...input.engines]) });
      expect(earnOrPay(frozen)).toEqual(earnOrPay(frozen));
    }
  });

  it('takes no input at all', () => {
    expect(earnOrPay()).toMatchObject({ decision: 'earn', rule: 'open', paidMeasured: false });
  });
});
