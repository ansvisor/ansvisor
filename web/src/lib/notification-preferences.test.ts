import { describe, expect, it } from 'vitest';
import {
  carryOverChoices,
  choiceFor,
  choicesFromRows,
  defaultChoices,
  legacyChoices,
  rowsFromChoices,
} from './notification-preferences';

/**
 * A person's own e-mail choices (00554): what they get before they save is
 * what pulse_settings sends them today, so nobody's e-mail changes by itself.
 */

describe('legacyChoices', () => {
  it("gives everyone the brand's Pulse and digest while its list is empty", () => {
    expect(legacyChoices(undefined, 'ana@acme.test')).toEqual({
      daily_pulse: 'notable',
      traffic_digest: 'weekly',
    });
    expect(legacyChoices({ frequency: 'daily', recipients: [] }, 'ana@acme.test')).toEqual({
      daily_pulse: 'daily',
      traffic_digest: 'weekly',
    });
  });

  it('gives only the people on a set list, whatever the case', () => {
    const settings = { frequency: 'weekly', recipients: ['ANA@acme.test ', 'client@partner.test'] };
    expect(legacyChoices(settings, 'ana@acme.test').daily_pulse).toBe('weekly');
    expect(legacyChoices(settings, 'bo@acme.test')).toEqual({
      daily_pulse: 'off',
      traffic_digest: 'off',
    });
  });

  it('keeps the digest off where it or the Pulse is off', () => {
    expect(legacyChoices({ frequency: 'daily', traffic_digest: false }, 'a@b.test')).toEqual({
      daily_pulse: 'daily',
      traffic_digest: 'off',
    });
    expect(legacyChoices({ frequency: 'off' }, 'a@b.test')).toEqual({
      daily_pulse: 'off',
      traffic_digest: 'off',
    });
  });
});

describe('carryOverChoices', () => {
  it('takes what most brands give for All my brands and keeps the rest per brand', () => {
    const settings = new Map([
      ['b1', { frequency: 'daily' }],
      ['b2', { frequency: 'daily' }],
      ['b3', { frequency: 'weekly', recipients: ['someone@else.test'] }],
    ]);
    const choices = carryOverChoices(['b1', 'b2', 'b3'], settings, 'ana@acme.test');
    expect(choices.all.daily_pulse).toBe('daily');
    expect(choices.all.traffic_digest).toBe('weekly');
    expect(choices.brands).toEqual({ b3: { daily_pulse: 'off', traffic_digest: 'off' } });
    expect(choiceFor(choices, 'daily_pulse', 'b3')).toBe('off');
    expect(choiceFor(choices, 'daily_pulse', 'b1')).toBe('daily');
    // The e-mails with no sender yet start at their defaults.
    expect(choices.all.critical_action).toBe('off');
    expect(choices.all.weekly_actions).toBe('weekly');
    expect(choices.all.ai_usage).toBe('on');
  });

  it('gives the defaults with no brands', () => {
    expect(carryOverChoices([], new Map(), 'a@b.test')).toEqual(defaultChoices());
  });
});

describe('rows and choices', () => {
  it('saves every kind for All my brands and a brand only where it differs', () => {
    const choices = defaultChoices();
    choices.all.daily_pulse = 'daily';
    choices.brands = {
      b1: { daily_pulse: 'off', traffic_digest: 'weekly' },
      // Not one of theirs.
      other: { daily_pulse: 'weekly' },
    };
    const rows = rowsFromChoices(choices, { brandIds: ['b1'], isAdmin: true });
    expect(rows.filter((row) => row.brand_id !== null)).toEqual([
      { kind: 'daily_pulse', brand_id: 'b1', frequency: 'off', delivery: 'per_brand' },
    ]);
    expect(rows.filter((row) => row.brand_id === null)).toHaveLength(10);
    expect(choicesFromRows(rows)).toEqual({
      ...choices,
      brands: { b1: { daily_pulse: 'off' } },
    });
  });

  it("drops a choice a kind doesn't offer, and the Account e-mails for a non-Admin", () => {
    const choices = defaultChoices();
    (choices.all as Record<string, string>).traffic_digest = 'instant';
    (choices.brands as Record<string, Record<string, string>>).b1 = { ai_usage: 'off' };
    const rows = rowsFromChoices(choices, { brandIds: ['b1'], isAdmin: false });
    expect(rows.find((row) => row.kind === 'traffic_digest')?.frequency).toBe('weekly');
    expect(rows.some((row) => row.kind === 'ai_usage')).toBe(false);
    expect(rows.some((row) => row.brand_id === 'b1')).toBe(false);
  });

  it('reads saved rows, leaving out what no longer fits', () => {
    const choices = choicesFromRows([
      { kind: 'daily_pulse', brand_id: null, frequency: 'weekly', delivery: 'per_brand' },
      { kind: 'daily_pulse', brand_id: 'b2', frequency: 'off' },
      { kind: 'unknown', brand_id: null, frequency: 'on' },
      { kind: 'traffic_digest', brand_id: null, frequency: 'notable' },
    ]);
    expect(choices.all.daily_pulse).toBe('weekly');
    expect(choices.all.traffic_digest).toBe('weekly');
    expect(choices.brands).toEqual({ b2: { daily_pulse: 'off' } });
  });
});
