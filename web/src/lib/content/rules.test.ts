import { describe, expect, it } from 'vitest';
import {
  NO_DRAFT_RULES,
  NOT_FOR_AGENT,
  fanoutsToUse,
  openRulesForAgent,
  activeRules,
  effectiveRules,
  splitRules,
  textRuleCheck,
  checkRule,
  draftRulesSchema,
  readPage,
  ruleLength,
  lengthWarns,
  lengthConflict,
  ruleSet,
  rulesMet,
  type ActiveRule,
  type RuleContext,
  draftRulesFit,
  ruleSetFits,
  storedBytes,
  overridesForImport,
  setToSave,
  pageTextLength,
  startingRules,
  RULE_LENGTH_MIN,
  RULE_LENGTH_MAX,
  lengthBand,
  rewriteAdvice,
  type RuleStatus,
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

  it('checks the rules against the database’s size in bytes, not characters', () => {
    const rule = (text: string, i: number) => ({ id: `r${i}`, text, on: true });
    const latin = Array.from({ length: 40 }, (_, i) => rule('a'.repeat(300), i));
    const cjk = Array.from({ length: 40 }, (_, i) => rule('日'.repeat(300), i));
    const rules = (textRules: typeof latin) => ({
      set: null,
      source: 'default' as const,
      overrides: {},
      textRules,
    });
    expect(draftRulesFit(rules(latin))).toBe(true);
    expect(draftRulesFit(rules(cjk))).toBe(false);
    expect(ruleSetFits({ overrides: {}, textRules: latin })).toBe(true);
    expect(
      ruleSetFits({
        overrides: Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`k${i}`, { value: 'ü'.repeat(300) }]),
        ),
        textRules: [],
      }),
    ).toBe(false);
    // jsonb writes a space after each ':' and ',': the count errs high, never low.
    expect(storedBytes({ a: [1, 2] })).toBeGreaterThanOrEqual('{"a": [1, 2]}'.length);
  });

  it('writes in the brand’s language by default, US English for English or none', () => {
    const language = (code?: string | null) =>
      ruleSet('guide', { language: code }).find((r) => r.key === 'language')?.value;
    expect(language('tr')).toBe('Turkish');
    expect(language('pt')).toBe('Portuguese');
    expect(language('en')).toBe('English (US)');
    expect(language(null)).toBe('English (US)');
    expect(language('xx')).toBe('English (US)');
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

  it('reads the length from the editor’s count, as a target within 20%', () => {
    // A 3,000 target: 2,400–3,600 meets it.
    expect(checkRule(rule('length'), page('', 2610), ctx)).toEqual({ state: 'ok' });
    expect(checkRule(rule('length'), page('', 3600), ctx)).toEqual({ state: 'ok' });
    expect(checkRule(rule('length'), page('', 2000), ctx)).toEqual({
      state: 'bad',
      code: 'short',
      count: 2000,
      min: 2400,
      max: 3600,
    });
    // A page far over its target is open, for Apply rules with Agent to shorten.
    expect(checkRule(rule('length'), page('', 15921), ctx)).toEqual({
      state: 'bad',
      code: 'long',
      count: 15921,
      min: 2400,
      max: 3600,
    });
  });

  it('wants one H1 per page, and leaves the agent out of it', () => {
    expect(check('oneH1', '<h1>T</h1><h2>A</h2>')).toEqual({ state: 'ok' });
    expect(check('oneH1', '<p>No title yet.</p>')).toEqual({ state: 'ok' });
    expect(check('oneH1', '<h1>T</h1><p>x</p><h1>Again</h1>')).toEqual({
      state: 'bad',
      code: 'found',
      count: 2,
    });
    // An empty H1 line is no title; an HTML block's H1 is the page's.
    expect(check('oneH1', '<h1>T</h1><h1></h1>')).toEqual({ state: 'ok' });
    expect(
      check('oneH1', `<h1>T</h1><div data-html-block="${btoa('<h1>Hero</h1>')}"></div>`),
    ).toEqual({ state: 'bad', code: 'found', count: 2 });
    // The agent changes words, never a heading's level.
    expect(NOT_FOR_AGENT.has('oneH1')).toBe(true);
    expect(ruleSet('blog_post').some((r) => r.key === 'oneH1')).toBe(true);
    // Always on: a draft's or a saved set's "off" doesn't turn it off.
    const [oneH1] = activeRules(
      ruleSet('blog_post').filter((r) => r.key === 'oneH1'),
      { overrides: { oneH1: { on: false } } },
    );
    expect(oneH1.on).toBe(true);
  });

  it('asks the agent only for what it can fix, and names the rest', () => {
    const rules = activeRules(ruleSet('blog_post'), NO_DRAFT_RULES);
    const p = page('<h1>T</h1><p>delve</p><h1>Again</h1>', 30);
    const statuses = rules.map((r) => ({ rule: r, status: checkRule(r, p, ctx) }));
    const all = openRulesForAgent(statuses);
    expect(all.forAgent.some(({ rule }) => rule.key === 'oneH1')).toBe(false);
    expect(all.notForAgent.map(({ rule }) => rule.key)).toEqual(['oneH1']);
    // Asked for one rule only, the rest stay out.
    const one = openRulesForAgent(statuses, ['aiTraces']);
    expect(one.forAgent.map(({ rule }) => rule.key)).toEqual(['aiTraces']);
    expect(one.notForAgent).toEqual([]);
    expect(openRulesForAgent(statuses, ['oneH1']).forAgent).toEqual([]);
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
    // It names the ones still to use, so the agent writes those.
    expect(check('fanoutH2', '<h2>Best espresso machines under $500</h2>')).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 3,
      missing: ['home espresso grinder', 'espresso machine reviews 2026'],
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
    expect(check('fanoutFaq', faq)).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 3,
      missing: ['best espresso machine under 500', 'espresso machine reviews 2026'],
    });
    // Fewer fan-outs than questions asked: using each one meets it, and the
    // one still needed is named.
    const two = { ...ctx, fanouts: ['home espresso grinder', 'espresso machine reviews 2026'] };
    expect(checkRule(rule('fanoutFaq'), page(faq), two)).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 2,
      missing: ['espresso machine reviews 2026'],
    });
    const both =
      '<h2>FAQ</h2><h3>Which home espresso grinder should I buy?</h3><p>The Baratza.</p>' +
      '<h3>Where are the espresso machine reviews of 2026?</h3><p>Here.</p>';
    expect(checkRule(rule('fanoutFaq'), page(both), two)).toEqual({ state: 'ok' });
    // Different fan-outs count, not questions: two asking the same one are one.
    const same =
      '<h2>FAQ</h2><h3>Which home espresso grinder should I buy?</h3><p>The Baratza.</p>' +
      '<h3>Is a home espresso grinder worth it?</h3><p>Yes.</p>';
    expect(checkRule(rule('fanoutFaq'), page(same), two)).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 2,
      missing: ['espresso machine reviews 2026'],
    });
    // One question that uses two of them counts both.
    const one =
      '<h2>FAQ</h2><h3>Which home espresso grinder do the espresso machine reviews 2026 pick?</h3><p>The Baratza.</p>';
    expect(checkRule(rule('fanoutFaq'), page(one), two)).toEqual({ state: 'ok' });
    // No FAQ yet: still the fan-outs its questions should use.
    expect(check('fanoutFaq', '<p>x</p>')).toEqual({
      state: 'bad',
      code: 'needsFaq',
      missing: [
        'best espresso machine under 500',
        'home espresso grinder',
        'espresso machine reviews 2026',
      ],
    });
  });

  it('quotes the fan-outs still to use for the agent, as many as fit', () => {
    const status = check('fanoutH2', '<h2>x</h2>');
    expect(fanoutsToUse(status)).toBe(
      '"best espresso machine under 500"; "home espresso grinder"; "espresso machine reviews 2026"',
    );
    expect(fanoutsToUse(status, 40)).toBe('"best espresso machine under 500"');
    // One that doesn't fit doesn't stop a shorter one after it.
    expect(fanoutsToUse(status, 60)).toBe(
      '"best espresso machine under 500"; "home espresso grinder"',
    );
    expect(fanoutsToUse({ state: 'ok' })).toBeNull();
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

describe('the formats www.ansvisor.com offers', () => {
  it('gives each new page type its own rules and length', () => {
    const own = (type: Parameters<typeof ruleSet>[0]) =>
      ruleSet(type)
        .filter((r) => r.group === 'type')
        .map((r) => r.key);
    expect(own('guide')).toEqual(['howToSteps']);
    expect(own('definition')).toEqual(['definitionFirst', 'examplesSection']);
    expect(own('alternatives')).toEqual(['sideBySide', 'fairness']);
    expect(own('collection_page')).toEqual(['introText', 'buyingFaq']);
    expect(own('sizing_guide')).toEqual(['sizeChart', 'measureSteps', 'fitQuestions']);
    const length = (type: Parameters<typeof ruleSet>[0]) =>
      ruleSet(type).find((r) => r.key === 'length')?.value;
    expect([length('definition'), length('sizing_guide'), length('collection_page')]).toEqual([
      '1500',
      '1000',
      '800',
    ]);
  });

  it('checks a definition in the first sentence, short, and an examples section', () => {
    const define = (html: string) => check('definitionFirst', html, undefined, 'definition');
    expect(define('<h1>Cold brew</h1><p>Cold brew is coffee steeped in cold water.</p>')).toEqual({
      state: 'ok',
    });
    expect(define('<h1>Cold brew</h1><p>Many people love it in summer.</p>')).toEqual({
      state: 'bad',
      code: 'missing',
    });
    // "is" somewhere in the paragraph isn't a definition: a pronoun's, or past the first words.
    expect(define('<h1>Cold brew</h1><p>Many people say it is great.</p>')).toEqual({
      state: 'bad',
      code: 'missing',
    });
    expect(
      define(
        '<h1>Cold brew</h1><p>On hot summer days in the city many cafés sell what is cold brew.</p>',
      ),
    ).toEqual({ state: 'bad', code: 'missing' });
    expect(
      define('<h1>Cold brew</h1><p>Cold brew. Summer drinkers say it is the best way.</p>'),
    ).toEqual({ state: 'bad', code: 'missing' });
    expect(
      define('<h1>CRM</h1><p>Customer relationship management (CRM) refers to tools that…</p>'),
    ).toEqual({ state: 'ok' });
    // Punctuation beside the verb doesn't hide it.
    expect(define('<h1>Cold brew</h1><p>Cold brew is, simply, coffee steeped cold.</p>')).toEqual({
      state: 'ok',
    });
    // Read in English words only: another language's page isn't counted.
    expect(
      checkRule(
        rule('definitionFirst', 'definition'),
        page('<h1>Soğuk demleme</h1><p>Soğuk demleme, soğuk suyla demlenen kahvedir.</p>'),
        { ...ctx, language: 'tr' },
      ),
    ).toEqual({ state: 'info', code: 'englishOnly' });
    expect(
      checkRule(
        rule('definitionFirst', 'definition'),
        page('<h1>Cold brew</h1><p>Cold brew is coffee steeped in cold water.</p>'),
        { ...ctx, language: 'en' },
      ),
    ).toEqual({ state: 'ok' });
    expect(define(`<h1>Cold brew</h1><p>Cold brew is ${'very '.repeat(60)}cold.</p>`)).toEqual({
      state: 'bad',
      code: 'words',
      count: 64,
    });
    expect(
      check('examplesSection', '<h2>Examples of cold brew</h2>', undefined, 'definition'),
    ).toEqual({ state: 'ok' });
  });

  it('checks a how-to guide’s and a sizing guide’s steps, and a size chart', () => {
    const steps = '<ol><li>a</li><li>b</li><li>c</li></ol>';
    expect(
      check('howToSteps', `<h1>How to make cold brew</h1>${steps}`, undefined, 'guide'),
    ).toEqual({ state: 'ok' });
    expect(
      check(
        'howToSteps',
        '<h1>Cold brew in 5 easy steps</h1><ol><li>a</li></ol>',
        undefined,
        'guide',
      ),
    ).toEqual({ state: 'bad', code: 'partOf', count: 1, of: 3 });
    // A guide that isn't a how-to has no steps to count.
    expect(
      check('howToSteps', '<h1>The Azores in winter</h1><p>Mild.</p>', undefined, 'guide'),
    ).toEqual({ state: 'info', code: 'notHowTo' });
    expect(check('measureSteps', '<ol><li>a</li></ol>', undefined, 'sizing_guide')).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 3,
    });
    expect(
      check('sizeChart', '<table><tr><td>M</td></tr></table>', undefined, 'sizing_guide'),
    ).toEqual({ state: 'ok' });
    expect(check('sizeChart', '<p>M fits most</p>', undefined, 'sizing_guide')).toEqual({
      state: 'bad',
      code: 'missing',
    });
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
    // 17 shared rules: sentence off; tone, language and keywords (none set) can't say.
    expect(total).toBe(13);
    expect(met).toBeGreaterThan(0);
    expect(met).toBeLessThan(total);
  });
});

describe('lengthWarns', () => {
  const statuses = (html: string, characters: number, on = true, value?: string) =>
    activeRules(ruleSet('blog_post'), {
      overrides: { length: { on, ...(value ? { value } : {}) } },
    }).map((r) => ({ rule: r, status: checkRule(r, page(html, characters), ctx) }));

  it('warns exactly when the Length rule reads short or long, as the Rules tab does', () => {
    // A 3,000 target passes 2,400–3,600: a page a little over it is fine.
    expect(lengthWarns(statuses('<h1>T</h1>', 3_300, true, '3000'))).toBe(false);
    expect(lengthWarns(statuses('<h1>T</h1>', 2_000, true, '3000'))).toBe(true);
    expect(lengthWarns(statuses('<h1>T</h1>', 3_700, true, '3000'))).toBe(true);
  });

  it('stays quiet with the Length rule off, even on an empty page', () => {
    expect(lengthWarns(statuses('', 0, false))).toBe(false);
  });
});

describe('lengthConflict', () => {
  const statuses = (
    overrides: Record<string, { on?: boolean; value?: string }>,
    fanouts = ctx.fanouts,
  ) =>
    activeRules(ruleSet('blog_post'), { overrides }).map((r) => ({
      rule: r,
      status: checkRule(r, page('<h1>T</h1>', 100), { ...ctx, fanouts }),
    }));

  it('says when the sections, questions and summary asked for can’t fit in Length (C)', () => {
    // 3 fan-out H2s (of 4 asked, 3 there are) × 200 + 5 FAQ questions × 150 + a summary, 100.
    expect(lengthConflict(statuses({ length: { value: '1000' } }), 3)).toEqual({
      need: 1_450,
      max: 1_200,
    });
    expect(lengthConflict(statuses({ length: { value: '1500' } }), 3)).toBeNull();
    expect(lengthConflict(statuses({}), 3)).toBeNull();
  });

  it('counts only the rules on and still open, and asks nothing of fan-outs there aren’t', () => {
    // FAQ off: the 3 fan-out questions still need a FAQ.
    expect(
      lengthConflict(statuses({ length: { value: '800' }, faq: { on: false } }), 3)?.need,
    ).toBe(600 + 450 + 100);
    // Two fan-outs: two fan-out H2s and two fan-out questions at most.
    expect(
      lengthConflict(
        statuses({ length: { value: '500' }, faq: { on: false } }, ctx.fanouts.slice(0, 2)),
        2,
      )?.need,
    ).toBe(400 + 300 + 100);
    // No fan-outs: no fan-out H2s or fan-out questions to fit.
    expect(lengthConflict(statuses({ length: { value: '600' } }, []), 0)?.need).toBe(750 + 100);
    expect(
      lengthConflict(statuses({ length: { value: '50' }, faq: { on: false } }, []), 0)?.need,
    ).toBe(100);
    // Length off asks for no length.
    expect(lengthConflict(statuses({ length: { on: false, value: '500' } }), 3)).toBeNull();
    // A page that meets them all shows they fit.
    const met = statuses({ length: { value: '1000' } }).map((s) =>
      ['fanoutH2', 'faq', 'fanoutFaq', 'summary'].includes(s.rule.key)
        ? { ...s, status: { state: 'ok' as const } }
        : s,
    );
    expect(lengthConflict(met, 3)).toBeNull();
  });
});

describe('rewriteAdvice', () => {
  const statuses = (
    length: number | null,
    open: string[] = [],
    lengthValue = '8000',
  ): { rule: ActiveRule; status: RuleStatus }[] =>
    activeRules(ruleSet('blog_post'), { overrides: { length: { value: lengthValue } } }).map(
      (rule) => {
        if (rule.key === 'length' && length !== null) {
          const band = lengthBand(Number(rule.current));
          const ok = length >= band.min && length <= band.max;
          return {
            rule,
            status: ok
              ? { state: 'ok' as const }
              : {
                  state: 'bad' as const,
                  code: length > band.max ? ('long' as const) : ('short' as const),
                  count: length,
                  min: band.min,
                  max: band.max,
                },
          };
        }
        return {
          rule,
          status: open.includes(rule.key)
            ? { state: 'bad' as const, code: 'missing' as const }
            : { state: 'ok' as const },
        };
      },
    );

  it('recommends a rewrite for a page more than 30% off its Length', () => {
    // The user's page: 19,203 characters for 8,000.
    expect(rewriteAdvice(statuses(19_203))).toEqual({
      reason: 'length',
      count: 19_203,
      target: 8_000,
      percent: 140,
    });
    // 30% off, no more, is for small edits.
    expect(rewriteAdvice(statuses(10_400))).toBeNull();
    // An empty page has nothing to rewrite; one past 60,000 can't be sent whole.
    expect(rewriteAdvice(statuses(0, ['faq', 'summary', 'h2Answer', 'keywords']))).toBeNull();
    expect(rewriteAdvice(statuses(60_001))).toBeNull();
  });

  it('recommends it for 4 rules or more the agent can fix', () => {
    expect(rewriteAdvice(statuses(null, ['faq', 'summary', 'h2Answer']))).toBeNull();
    expect(rewriteAdvice(statuses(null, ['faq', 'summary', 'h2Answer', 'keywords']))).toEqual({
      reason: 'open',
      count: 4,
    });
    // A rule it can't fix doesn't count.
    expect(rewriteAdvice(statuses(null, ['faq', 'summary', 'h2Answer', 'oneH1']))).toBeNull();
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

  it('aims a page brought in to optimize at its own length, over the set’s (F)', () => {
    const imported = { ...NO_DRAFT_RULES, importLength: 18_000 };
    const withLength = {
      ...mine,
      overrides: { ...mine.overrides, length: { on: true, value: '2000' } },
    };
    // My rules apply, but not their length: that's for a new page.
    expect(effectiveRules(imported, withLength).overrides).toEqual({
      sentence: { value: '120' },
      length: { on: true },
    });
    const [length] = activeRules(
      ruleSet('blog_post', { length: imported.importLength }).filter((r) => r.key === 'length'),
      effectiveRules(imported, withLength),
    );
    expect(length.current).toBe('18000');
    // Kept through a save.
    expect(draftRulesSchema.parse(imported).importLength).toBe(18_000);
    // Without one, the type's length, as before.
    expect(ruleSet('blog_post').find((r) => r.key === 'length')!.value).toBe('3000');
  });

  it('keeps the page’s own length when My rules are picked or saved (F)', () => {
    const withLength = { length: { on: true, value: '2000' }, sentence: { value: '120' } };
    // Picked from the set menu: as the untouched draft showed it.
    expect(overridesForImport(withLength, 18_000)).toEqual({
      length: { on: true },
      sentence: { value: '120' },
    });
    expect(overridesForImport(withLength, undefined)).toBe(withLength);
    // Saved as My rules: the workspace's Length value stays…
    const imported = {
      ...NO_DRAFT_RULES,
      overrides: { length: { on: true }, faq: { on: false } },
      importLength: 18_000,
    };
    expect(setToSave(imported, { overrides: withLength, textRules: [] })).toEqual({
      overrides: { length: { on: true, value: '2000' }, faq: { on: false } },
      textRules: [],
    });
    // …a value the person gave is theirs, and a set without one gets none.
    const typed = { ...imported, overrides: { length: { value: '15000' } } };
    expect(setToSave(typed, { overrides: withLength, textRules: [] }).overrides).toEqual({
      length: { value: '15000' },
    });
    expect(setToSave(imported, undefined).overrides).toEqual(imported.overrides);
  });

  it('starts only a page brought in to optimize at its own length (F)', () => {
    expect(pageTextLength('<h1>Pricing</h1><p>Plans &amp; prices</p>')).toBe(22);
    expect(pageTextLength('<p>a<script>x()</script>  b</p><style>p{}</style>')).toBe(3);
    const page = `<h1>Pricing</h1><p>${'word '.repeat(40)}</p>`;
    expect(startingRules('optimize', page)).toEqual({ ...NO_DRAFT_RULES, importLength: 207 });
    // Within the range the Length rule takes.
    expect(startingRules('optimize', '<p>Short</p>').importLength).toBe(RULE_LENGTH_MIN);
    expect(startingRules('optimize', `<p>${'x'.repeat(60_000)}</p>`).importLength).toBe(
      RULE_LENGTH_MAX,
    );
    expect(startingRules('optimize', undefined)).toBe(NO_DRAFT_RULES);
    expect(startingRules('optimize', '<p> </p>')).toBe(NO_DRAFT_RULES);
    expect(startingRules('create', page)).toBe(NO_DRAFT_RULES);
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
