import { describe, expect, it } from 'vitest';
import { NO_JS, compareNoJs, rawWords } from './no-js.js';
import { auditContextOf } from './context.js';
import { noJsContent } from './signals/structure.js';

/**
 * The no-JS render check (SA-009): the page's main text, as a browser
 * renders it, against the HTML an AI bot gets before JavaScript runs.
 */

const intro =
  'Pour-over coffee is simple to make at home, and it tastes clean and bright in the cup.';
const steps =
  'Rinse the filter with hot water first, then add twenty grams of coffee and shake it level.';
const bloom =
  'Start with a short pour and wait thirty seconds while the fresh coffee blooms and releases gas.';
const mistakes =
  'Many beginners pour too fast, which makes a weak and sour cup that nobody wants to drink.';
const tail =
  'Measure your coffee, watch the clock and keep notes on each cup so the next one is better.';

const article = (paragraphs) =>
  `<main><article><h1>How to brew pour-over coffee</h1>${paragraphs
    .map((p) => `<p>${p}</p>`)
    .join('')}</article></main>`;
const page = (body) =>
  `<!doctype html><html lang="en"><head><title>Pour-over</title></head><body><nav><a href="/">Home</a></nav>${body}<footer>© Beans</footer></body></html>`;

const rendered = page(article([intro, steps, bloom, mistakes, tail]));
const ctxOf = (rawHtml) =>
  Object.assign(
    auditContextOf({
      url: 'https://beans.example/guide',
      statusCode: 200,
      html: rendered,
      robotsTxt: null,
      llmsTxt: null,
    }),
    { rawPage: rawHtml === null ? null : { html: rawHtml, from: 'gptbot' } },
  );

describe('rawWords', () => {
  it('reads <noscript> as a crawler that runs no scripts does, and leaves scripts out', () => {
    expect(
      rawWords(
        '<body><noscript><p>Enable JavaScript</p></noscript><script>render("Hidden")</script></body>',
      ),
    ).toEqual(['enable', 'javascript']);
  });
});

describe('compareNoJs', () => {
  const blocks = [intro, steps, bloom].map((text) => ({ tag: 'p', text }));

  it('finds nothing hidden on a page rendered on the server', () => {
    expect(compareNoJs(blocks, rendered)).toMatchObject({
      hiddenWords: 0,
      hiddenShare: 0,
      hidden: [],
    });
  });

  it('counts the words of the blocks only JavaScript writes, and names the first', () => {
    const shell = page(article([intro]));
    const { words, hiddenWords, hiddenShare, hidden } = compareNoJs(blocks, shell);
    // Words as the check splits them: "Pour-over" is two.
    const count = (t) => t.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length;
    expect(words).toBe(count(intro) + count(steps) + count(bloom));
    expect(hiddenWords).toBe(count(steps) + count(bloom));
    expect(hiddenShare).toBeCloseTo(hiddenWords / words, 2);
    expect(hidden).toEqual([steps, bloom]);
  });

  it('keeps a block whose date or counter a script wrote in: most of it is there', () => {
    const live = [{ tag: 'p', text: `${steps} Updated 3 minutes ago.` }];
    expect(compareNoJs(live, page(article([steps]))).hiddenWords).toBe(0);
  });

  it('reads a short block as written, and cuts a long example short', () => {
    const short = [{ tag: 'h2', text: 'Step by step' }];
    expect(compareNoJs(short, '<h2>Step  by step</h2>').hiddenWords).toBe(0);
    expect(compareNoJs(short, '<h2>Steps</h2>').hiddenWords).toBe(3);
    const long = [{ tag: 'p', text: `${intro} ${steps}` }];
    const [example] = compareNoJs(long, '<p>Nothing</p>').hidden;
    expect(example).toHaveLength(NO_JS.exampleChars);
    expect(example.endsWith('…')).toBe(true);
  });
});

describe('noJsContent', () => {
  it('passes a page whose main text is all in the HTML a bot gets', () => {
    expect(noJsContent.evaluate(ctxOf(rendered))).toMatchObject({
      status: 'pass',
      score: 1,
      evidence: { hiddenPercent: 0, hiddenWords: 0, readAs: 'gptbot' },
    });
  });

  it('fails a page whose main text appears only once JavaScript runs', () => {
    const shell = page('<div id="app"></div><noscript>You need to enable JavaScript.</noscript>');
    const { status, score, evidence } = noJsContent.evaluate(ctxOf(shell));
    expect({ status, score }).toEqual({ status: 'fail', score: 0 });
    expect(evidence.hiddenPercent).toBe(100);
    expect(evidence.hiddenText[0]).toBe('How to brew pour-over coffee');
    expect(evidence.mainWords).toBeGreaterThanOrEqual(NO_JS.minWords);
  });

  it('warns when a part of it is missing, within the warning band', () => {
    // The last paragraph alone, about a fifth of the text, is written by a script.
    const { status, evidence } = noJsContent.evaluate(
      ctxOf(page(article([intro, steps, bloom, mistakes]))),
    );
    expect(evidence.hiddenPercent).toBeGreaterThan(NO_JS.passUpTo * 100);
    expect(evidence.hiddenPercent).toBeLessThanOrEqual(NO_JS.warnUpTo * 100);
    expect(status).toBe('warn');
  });

  it('says nothing without the HTML a bot got, or with too little main text', () => {
    expect(noJsContent.evaluate(ctxOf(null))).toEqual({
      status: 'na',
      score: null,
      evidence: { compared: false },
    });
    const thin = Object.assign(
      auditContextOf({
        url: 'https://beans.example/',
        statusCode: 200,
        html: page(article([intro])),
        robotsTxt: null,
        llmsTxt: null,
      }),
      { rawPage: { html: '', from: 'gptbot' } },
    );
    expect(noJsContent.evaluate(thin)).toMatchObject({
      status: 'na',
      evidence: { compared: false },
    });
  });
});
