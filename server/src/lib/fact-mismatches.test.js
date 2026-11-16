import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { factMismatches, pagePrices } from './fact-mismatches.js';

/**
 * The server's factMismatches is the web's (web/src/lib/content/brand-facts.ts),
 * kept in step two ways, as the web's figure guard is with the Site Audit's
 * (web/src/lib/chat/facts.test.ts): the same fixtures read to the same
 * answers on both sides (the web's brand-facts.test.ts reads them too), and
 * the same patterns, read from both files.
 */

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const FIXTURES = JSON.parse(read('web/src/lib/content/__fixtures__/fact-mismatches.json'));

describe("factMismatches, the web's fixtures", () => {
  const { brandName, competitorDomains, facts, cases } = FIXTURES;

  it('reads every case as the web does', () => {
    expect(cases.length).toBeGreaterThan(80);
    for (const { sentences, compared, mismatches } of cases) {
      const got = factMismatches({ sentences, facts, brandName, competitorDomains });
      expect(
        { compared: got.compared, mismatches: got.mismatches.map(({ sentence: _, ...m }) => m) },
        sentences.join(' | '),
      ).toEqual({ compared, mismatches });
      for (const m of got.mismatches) expect(sentences).toContain(m.sentence);
    }
  });

  it('compares nothing without an approved fact still on the site', () => {
    const none = facts.map((f) => ({ ...f, status: 'pending' }));
    const sentences = cases.flatMap((c) => c.sentences);
    expect(factMismatches({ sentences, facts: none, brandName, competitorDomains })).toEqual({
      compared: 0,
      mismatches: [],
    });
  });

  it('reads a price with its currency and period, and no scale, range or "off"', () => {
    expect(pagePrices('Pro is $49/mo, $2M raised, $10–$20 a seat, $5 off.')).toMatchObject([
      { text: '$49', amount: 49, currency: 'USD', period: 'month' },
    ]);
    expect(pagePrices('From 1.299 TL per month')).toMatchObject([
      { amount: 1299, currency: 'TRY', from: true, period: 'month' },
    ]);
  });
});

describe("the web's patterns", () => {
  /** A constant's definition, whitespace aside: from its name to the `;` that ends it. */
  const definition = (src, name) =>
    src
      .match(new RegExp(`\\nconst ${name}(?::[^=]*)? =\\s*([\\s\\S]*?);\\n`))?.[1]
      ?.replace(/\s+/g, ' ');
  const web = read('web/src/lib/content/brand-facts.ts');
  const server = read('server/src/lib/fact-mismatches.js');

  it('are the server port’s, each as written', () => {
    for (const name of [
      'CURRENCY_MARKS',
      'ISO',
      'PRICE',
      'CODE_AFTER',
      'CODE_BEFORE',
      'MAGNITUDE',
      'RANGE_AFTER',
      'RANGE_BEFORE',
      'NOT_A_PRICE',
      'MONTH',
      'YEAR',
      'BILLED_YEAR',
      'BILLED_MONTH',
      'FROM',
      'FROM_AFTER',
      'COMMON_PLANS',
      'PLAN_WORD',
      'PRICED_AFTER_NAME',
      'PRICED_AFTER_PLAN',
      'COMPARING',
      'TRIAL_DAYS',
      'TRIAL_WEEKS',
      'FREE_FOR',
      'SAYS_TRIAL',
      'OWN_TRIAL',
      'OWNED_LENGTH',
      'TURN',
      'QUOTED',
    ]) {
      expect(definition(web, name), name).toBeTruthy();
      expect(definition(server, name), name).toBe(definition(web, name));
    }
  });
});
