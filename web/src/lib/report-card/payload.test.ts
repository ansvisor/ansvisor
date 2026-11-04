import { describe, expect, it } from 'vitest';
import { reportCardPayloadSchema } from './payload';
import { SAMPLE_REPORT_CARD } from './sample';

describe('reportCardPayloadSchema', () => {
  it('takes the sample card as it is', () => {
    expect(reportCardPayloadSchema.parse(SAMPLE_REPORT_CARD)).toEqual(SAMPLE_REPORT_CARD);
  });

  it('takes a card with no site type, ad data or deal value', () => {
    const card = { ...SAMPLE_REPORT_CARD, siteType: null, cpc: null, dealValue: null };
    expect(reportCardPayloadSchema.safeParse(card).success).toBe(true);
  });

  it('refuses an engine the card does not ask, a negative count and a bad currency', () => {
    for (const card of [
      { ...SAMPLE_REPORT_CARD, engines: [{ engine: 'grok-web', answers: 25, named: 1 }] },
      { ...SAMPLE_REPORT_CARD, ownCitations: -1 },
      { ...SAMPLE_REPORT_CARD, dealValue: { amount: 38, currency: 'dollars' } },
      { ...SAMPLE_REPORT_CARD, engines: [] },
    ]) {
      expect(reportCardPayloadSchema.safeParse(card).success).toBe(false);
    }
  });
});
