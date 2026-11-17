import { describe, expect, it } from 'vitest';
import {
  COMPETITOR_TYPE_WORDS,
  DEFAULT_COMPETITOR_TYPES,
  competitorTypeLabel,
  competitorTypeOptions,
  groupCompetitorsByType,
  matchesCompetitorType,
  missingCompetitorTypeColumn,
  normalizeCompetitorType,
} from './competitor-types';
import messages from '../../messages/en.json';

/**
 * Competitor types (00542): generic types stored by key, a brand's own labels
 * as it wrote them, null for none; the picker offers the generic ones and the
 * labels of this brand's competitors only.
 */

describe('competitorTypeLabel', () => {
  it("names a generic type from en.json, a brand's label as typed, and none as null", () => {
    expect(competitorTypeLabel('direct')).toBe('Direct competitor');
    expect(competitorTypeLabel('marketplace')).toBe(messages.competitors.type.defaults.marketplace);
    expect(competitorTypeLabel('Tour operator')).toBe('Tour operator');
    expect(competitorTypeLabel(null)).toBeNull();
    expect(competitorTypeLabel(undefined)).toBeNull();
    expect(competitorTypeLabel('')).toBeNull();
  });
});

describe('normalizeCompetitorType', () => {
  it('stores a generic type by its key, whether typed by key or by name, in any case', () => {
    expect(normalizeCompetitorType('direct')).toEqual({ ok: true, type: 'direct' });
    expect(normalizeCompetitorType('  MARKETPLACE / Aggregator ')).toEqual({
      ok: true,
      type: 'marketplace',
    });
    expect(normalizeCompetitorType('publisher / review   site')).toEqual({
      ok: true,
      type: 'publisher',
    });
  });

  it("joins one of the brand's labels in any case, as the brand first wrote it", () => {
    expect(normalizeCompetitorType('airline', ['Airline', 'direct', null])).toEqual({
      ok: true,
      type: 'Airline',
    });
    expect(normalizeCompetitorType('  Ferry   line ', [])).toEqual({
      ok: true,
      type: 'Ferry line',
    });
  });

  it('reads empty, "none" and "No type" as no type, and refuses a label past 40 characters', () => {
    expect(normalizeCompetitorType('')).toEqual({ ok: true, type: null });
    expect(normalizeCompetitorType('   ')).toEqual({ ok: true, type: null });
    expect(normalizeCompetitorType(null)).toEqual({ ok: true, type: null });
    expect(normalizeCompetitorType('None')).toEqual({ ok: true, type: null });
    expect(normalizeCompetitorType('no type')).toEqual({ ok: true, type: null });
    expect(normalizeCompetitorType('x'.repeat(40))).toEqual({ ok: true, type: 'x'.repeat(40) });
    expect(normalizeCompetitorType('x'.repeat(41))).toEqual({ ok: false, reason: 'too_long' });
  });
});

describe('competitorTypeOptions', () => {
  it("offers the generic types, then this brand's own labels A to Z, each once", () => {
    const brandA = [
      { type: 'Tour operator' },
      { type: 'airline' },
      { type: 'marketplace' },
      { type: null },
      { type: 'Tour operator' },
    ];
    expect(competitorTypeOptions(brandA)).toEqual([
      ...DEFAULT_COMPETITOR_TYPES,
      'airline',
      'Tour operator',
    ]);
  });

  it("never offers another brand's labels: only the competitors passed in", () => {
    const brandB = [{ type: 'Reseller' }];
    expect(competitorTypeOptions(brandB)).not.toContain('Tour operator');
    expect(competitorTypeOptions([])).toEqual([...DEFAULT_COMPETITOR_TYPES]);
  });
});

describe('matchesCompetitorType', () => {
  it('matches a type by key or name in any case, none for the untyped, and all when empty', () => {
    expect(matchesCompetitorType('direct', 'Direct competitor')).toBe(true);
    expect(matchesCompetitorType('direct', 'DIRECT')).toBe(true);
    expect(matchesCompetitorType('Airline', 'airline')).toBe(true);
    expect(matchesCompetitorType('Airline', 'Ferry')).toBe(false);
    expect(matchesCompetitorType(null, 'none')).toBe(true);
    expect(matchesCompetitorType('direct', 'none')).toBe(false);
    expect(matchesCompetitorType(null, 'direct')).toBe(false);
    expect(matchesCompetitorType(null, '')).toBe(true);
    expect(matchesCompetitorType('Airline', undefined)).toBe(true);
  });
});

describe('groupCompetitorsByType', () => {
  it('groups generic types first, then labels A to Z, the untyped last, keeping order', () => {
    const list = [
      { id: '1', type: 'Tour operator' },
      { id: '2', type: null },
      { id: '3', type: 'direct' },
      { id: '4', type: 'Airline' },
      { id: '5', type: 'direct' },
    ];
    expect(groupCompetitorsByType(list).map((g) => [g.type, g.items.map((c) => c.id)])).toEqual([
      ['direct', ['3', '5']],
      ['Airline', ['4']],
      ['Tour operator', ['1']],
      [null, ['2']],
    ]);
  });

  it('leaves out empty groups', () => {
    expect(groupCompetitorsByType([{ type: null }])).toEqual([
      { type: null, items: [{ type: null }] },
    ]);
  });
});

describe("the tools' words", () => {
  it('name every generic type as the page does', () => {
    for (const label of Object.values(messages.competitors.type.defaults)) {
      expect(COMPETITOR_TYPE_WORDS).toContain(`"${label}"`);
    }
  });
});

describe('missingCompetitorTypeColumn', () => {
  it('tells a database without 00542 from any other error', () => {
    expect(
      missingCompetitorTypeColumn({
        code: '42703',
        message: 'column competitors.type does not exist',
      }),
    ).toBe(true);
    expect(
      missingCompetitorTypeColumn({
        code: 'PGRST204',
        message: "Could not find the 'type' column of 'competitors' in the schema cache",
      }),
    ).toBe(true);
    expect(
      missingCompetitorTypeColumn({
        code: '42703',
        message: 'column brands.site_type does not exist',
      }),
    ).toBe(false);
    expect(missingCompetitorTypeColumn({ code: '57014', message: 'type canceled' })).toBe(false);
    expect(missingCompetitorTypeColumn(null)).toBe(false);
  });
});
