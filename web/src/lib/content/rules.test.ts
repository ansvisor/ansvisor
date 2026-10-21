import { describe, expect, it } from 'vitest';
import {
  NO_DRAFT_RULES,
  activeRules,
  effectiveRules,
  splitRules,
  textRuleCheck,
  checkRule,
  draftRulesSchema,
  readPage,
  ruleLength,
  ruleSet,
  rulesMet,
  type ActiveRule,
  type RuleContext,
} from './rules';

const ctx: RuleContext = {
  brandDomains: ['acme.example'],
  competitorDomains: ['crema.example'],
  fanouts: [
    'best espresso machine under 500',
    'home espresso grinder',
    'espresso machine reviews 2026',
  ],
};

const rule = (
  key: string,
  pageType: Parameters<typeof ruleSet>[0] = 'feature_page',
  value?: string,
): ActiveRule => {
  const rules = activeRules(
    ruleSet(pageType),
    value === undefined ? NO_DRAFT_RULES : { overrides: { [key]: { value } } },
  );
  const found = rules.find((r) => r.key === key);
  if (!found) throw new Error(`no rule ${key}`);
  return found;
};

const page = (html: string, characters = 0) => readPage(html, characters);
const check = (
  key: string,
  html: string,
  value?: string,
  pageType?: Parameters<typeof ruleSet>[0],
) => checkRule(rule(key, pageType ?? 'feature_page', value), page(html), ctx);

describe('rule sets', () => {
  it('puts the page type’s own rules above the shared groups, with its length', () => {
    expect(
      ruleSet('feature_page')
        .map((r) => r.key)
        .slice(0, 4),
    ).toEqual(['comparisonTable', 'whoFor', 'proofPerSection', 'sentence']);
    expect(ruleSet('blog_post')[0].key).toBe('sentence');
    expect(ruleSet('product_page').find((r) => r.key === 'length')?.value).toBe('1200');
    expect(ruleSet(null).find((r) => r.key === 'length')?.value).toBe('3000');
    expect(
      ruleSet('guide', { keywords: ['espresso', 'grinder'] }).find((r) => r.key === 'keywords')
        ?.value,
    ).toBe('espresso, grinder');
  });

  it('applies the draft’s choices', () => {
    const rules = activeRules(ruleSet('category_page'), {
      overrides: { length: { value: '1000' }, faq: { on: false } },
    });
    expect(rules.find((r) => r.key === 'length')).toMatchObject({
      current: '1000',
      changed: true,
      on: true,
    });
    expect(rules.find((r) => r.key === 'faq')).toMatchObject({ on: false, changed: true });
    expect(rules.find((r) => r.key === 'sentence')).toMatchObject({ changed: false });
    expect(ruleLength(rules, 'category_page')).toBe(1000);
    const off = activeRules(ruleSet('category_page'), {
      overrides: { length: { on: false } },
    });
    expect(ruleLength(off, 'category_page')).toBe(800);
    // Kept within what Rebuild outline builds for.
    const tiny = activeRules(ruleSet('category_page'), {
      overrides: { length: { value: '50' } },
    });
    expect(ruleLength(tiny, 'category_page')).toBe(100);
    const huge = activeRules(ruleSet('category_page'), {
      overrides: { length: { value: '600000' } },
    });
    expect(ruleLength(huge, 'category_page')).toBe(50_000);
  });

  it('keeps the draft’s choices to their limits', () => {
    expect(
      draftRulesSchema.safeParse({ set: 'blog_post', overrides: { faq: { on: false } } }).success,
    ).toBe(true);
    expect(draftRulesSchema.safeParse({ set: 'nope', overrides: {} }).success).toBe(false);
    expect(
      draftRulesSchema.safeParse({ overrides: { tone: { value: 'x'.repeat(501) } } }).success,
    ).toBe(false);
  });
});

describe('length and structure', () => {
  it('counts sentences over the limit', () => {
    expect(check('sentence', `<p>Short one. ${'Long '.repeat(40)}sentence.</p>`)).toEqual({
      state: 'bad',
      code: 'over',
      count: 1,
    });
    expect(check('sentence', '<p>Short. Also short!</p>')).toEqual({ state: 'ok' });
  });

  it('reads the length from the editor’s count', () => {
    expect(checkRule(rule('length'), page('', 2610), ctx)).toEqual({
      state: 'bad',
      code: 'current',
      count: 2610,
    });
    expect(checkRule(rule('length'), page('', 3000), ctx)).toEqual({ state: 'ok' });
  });

  it('wants a short summary under the H1, and a short answer under each H2', () => {
    expect(check('summary', '<h1>T</h1><h2>A</h2>')).toEqual({ state: 'bad', code: 'missing' });
    expect(check('summary', `<h1>T</h1><p>${'word '.repeat(60)}</p>`)).toEqual({
      state: 'bad',
      code: 'words',
      count: 60,
    });
    expect(check('summary', '<h1>T</h1><p>A short answer.</p><h2>A</h2>')).toEqual({ state: 'ok' });

    expect(check('h2Answer', '<h1>T</h1><p>x</p>')).toEqual({ state: 'bad', code: 'noH2' });
    expect(
      check('h2Answer', `<h2>A</h2><p>Short.</p><h2>B</h2><table><tr><td>x</td></tr></table>`),
    ).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 2,
    });
  });
});

describe('fan-outs and keywords', () => {
  it('counts the top fan-outs used as H2s', () => {
    expect(
      check(
        'fanoutH2',
        '<h2>Best espresso machines under $500</h2><h2>Home espresso grinders</h2>',
        '2',
      ),
    ).toEqual({ state: 'ok' });
    expect(check('fanoutH2', '<h2>Best espresso machines under $500</h2>')).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 3,
    });
    expect(checkRule(rule('fanoutH2'), page('<h2>x</h2>'), { ...ctx, fanouts: [] })).toEqual({
      state: 'info',
      code: 'noFanouts',
    });
  });

  it('finds the FAQ and its questions, and the fan-outs they use', () => {
    const faq =
      '<h2>FAQ</h2><h3>Which home espresso grinder should I buy?</h3><p>The Baratza.</p>' +
      '<h3>Is it loud?</h3><p>A bit.</p><h2>Next</h2><p>Is this counted?</p>';
    expect(check('faq', faq)).toEqual({ state: 'bad', code: 'partOf', count: 2, of: 5 });
    expect(check('faq', faq, '2')).toEqual({ state: 'ok' });
    expect(check('faq', '<h2>Questions</h2>')).toEqual({ state: 'bad', code: 'missing' });
    expect(check('fanoutFaq', faq)).toEqual({ state: 'bad', code: 'partOf', count: 1, of: 3 });
    expect(check('fanoutFaq', '<p>x</p>')).toEqual({ state: 'bad', code: 'needsFaq' });
  });

  it('counts the keywords on the page', () => {
    expect(check('keywords', '<p>A pipeline forecast.</p>', 'pipeline forecast, accuracy')).toEqual(
      {
        state: 'bad',
        code: 'partOf',
        count: 1,
        of: 2,
      },
    );
    expect(check('keywords', '<p>x</p>')).toEqual({ state: 'info', code: 'addKeywords' });
  });
});

describe('links and sources', () => {
  const html =
    '<p>See <a href="/guides/milk">milk</a>, <a href="https://www.acme.example/beans">beans</a> and ' +
    '<a href="#top">top</a>.</p>' +
    '<p>Per <a href="https://www.nist.gov/coffee">NIST</a> and <a href="https://crema.example/x">Crema</a>.</p>';

  it('counts internal links, and outbound ones that aren’t a competitor’s', () => {
    expect(check('internalLinks', html, '2')).toEqual({ state: 'ok' });
    expect(check('outboundLinks', html)).toEqual({ state: 'bad', code: 'partOf', count: 1, of: 2 });
    expect(check('citeInline', html)).toEqual({ state: 'ok' });
    expect(check('citeInline', '<p><a href="https://crema.example/x">x</a></p>')).toEqual({
      state: 'bad',
      code: 'missing',
    });
  });

  it('wants a dated data point in the first 100 words', () => {
    expect(check('datedPoint', '<p>In 2026, 62% of buyers asked AI first.</p>')).toEqual({
      state: 'ok',
    });
    expect(check('datedPoint', `<p>${'word '.repeat(120)}In 2026.</p>`)).toEqual({
      state: 'bad',
      code: 'missing',
    });
  });
});

describe('style', () => {
  it('finds AI traces and banned words', () => {
    expect(check('aiTraces', '<p>Let’s delve in. It is important to note this.</p>')).toEqual({
      state: 'bad',
      code: 'found',
      count: 2,
    });
    expect(check('aiTraces', '<p>Plain words.</p>')).toEqual({ state: 'ok' });
    expect(check('bannedWords', '<p>A seamless, robust tool. Leverage it.</p>')).toEqual({
      state: 'bad',
      code: 'found',
      count: 3,
    });
    expect(check('bannedWords', '<p>Seamlessly done.</p>')).toEqual({ state: 'ok' });
  });

  it('leaves tone and language to AI', () => {
    expect(check('tone', '<p>x</p>')).toEqual({ state: 'info', code: 'aiCheck' });
    expect(check('language', '<p>x</p>')).toEqual({ state: 'info', code: 'aiCheck' });
  });
});

describe('page type rules', () => {
  it('checks a feature page', () => {
    expect(check('comparisonTable', '<table><tr><td>x</td></tr></table>')).toEqual({ state: 'ok' });
    expect(check('comparisonTable', '<p>x</p>')).toEqual({ state: 'bad', code: 'missing' });
    expect(check('whoFor', '<p>x</p>')).toEqual({ state: 'bad', code: 'notSet' });
    expect(check('whoFor', '<p>x</p>', 'Sales leaders')).toEqual({
      state: 'info',
      code: 'aiCheck',
    });
    expect(
      check(
        'proofPerSection',
        '<h2>A</h2><p>Used by 400 teams.</p><h2>B</h2><blockquote><p>Love it</p></blockquote><h2>C</h2><p>x</p>',
      ),
    ).toEqual({ state: 'bad', code: 'partOf', count: 2, of: 3 });
  });

  it('checks a solution page’s steps', () => {
    expect(
      check('useCaseSteps', '<ol><li>a</li><li>b</li><li>c</li></ol>', undefined, 'solution_page'),
    ).toEqual({
      state: 'ok',
    });
    expect(check('useCaseSteps', '<ol><li>a</li></ol>', undefined, 'solution_page')).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 3,
    });
  });

  it('checks a product and a category page', () => {
    expect(check('feedMatch', '<p>x</p>', undefined, 'product_page')).toEqual({
      state: 'info',
      code: 'needsFeed',
    });
    expect(
      check(
        'fitQuestions',
        '<h3>Does it fit wide feet?</h3><p>Which size should I order?</p>',
        '2',
        'product_page',
      ),
    ).toEqual({ state: 'ok' });
    expect(
      check(
        'introText',
        `<h1>Shoes</h1><p>${'word '.repeat(40)}</p><h2>All</h2>`,
        undefined,
        'category_page',
      ),
    ).toEqual({ state: 'bad', code: 'current', count: 40 });
  });

  it('checks a destination page’s summary', () => {
    expect(
      check(
        'bestTime',
        '<h1>Lisbon</h1><p>The best time to visit is May.</p>',
        undefined,
        'destination_page',
      ),
    ).toEqual({ state: 'ok' });
  });
});

describe('rulesMet', () => {
  it('counts the rules on that the page can say', () => {
    const rules = activeRules(ruleSet('blog_post'), {
      overrides: { sentence: { on: false } },
    });
    const p = page('<h1>T</h1><p>Short summary.</p>', 10);
    const statuses = rules.map((r) => ({ rule: r, status: checkRule(r, p, ctx) }));
    const { met, total } = rulesMet(statuses);
    // 16 shared rules: sentence off; tone, language and keywords (none set) can't say.
    expect(total).toBe(12);
    expect(met).toBeGreaterThan(0);
    expect(met).toBeLessThan(total);
  });
});

describe('My rules and text rules', () => {
  const mine = {
    overrides: { sentence: { value: '120' } },
    textRules: [{ id: 'm1', text: 'Mention free shipping', on: true }],
  };

  it('starts an untouched draft from the workspace’s My rules', () => {
    expect(effectiveRules(NO_DRAFT_RULES, mine)).toEqual({ set: null, source: 'mine', ...mine });
    expect(effectiveRules(NO_DRAFT_RULES, undefined)).toEqual(NO_DRAFT_RULES);
  });

  it('keeps a draft’s own choices, and a reset draft on the default', () => {
    const own = { ...NO_DRAFT_RULES, overrides: { faq: { on: false } } };
    expect(effectiveRules(own, mine)).toEqual(own);
    const reset = { ...NO_DRAFT_RULES, source: 'default' as const };
    expect(effectiveRules(reset, mine)).toEqual(reset);
  });

  it('reads rules saved before text rules with none', () => {
    expect(draftRulesSchema.parse({ set: 'guide', overrides: {} })).toEqual({
      set: 'guide',
      source: null,
      overrides: {},
      textRules: [],
    });
  });

  it('splits pasted rules into lines, bullets and numbering off', () => {
    expect(
      splitRules('- Mention free shipping\n\n2) Use 3 images\n• Keep it short  \n1. '),
    ).toEqual(['Mention free shipping', 'Use 3 images', 'Keep it short']);
    expect(splitRules('x'.repeat(400))[0]).toHaveLength(300);
  });

  it('checks a rule with a number as a number, the rest by AI', () => {
    expect(textRuleCheck('Use at least 3 images')).toBe('numberCheck');
    expect(textRuleCheck('Mention free shipping')).toBe('aiCheck');
  });
});
