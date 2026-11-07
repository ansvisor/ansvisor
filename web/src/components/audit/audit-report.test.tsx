import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { AuditRecommendation, AuditResult, AuditSignal } from '@/lib/actions/audits';
import { AuditReport } from './audit-report';

// Outbound authority links' way to Settings (00449).
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE =
  'Your input needed: replace each highlighted [bracket] with your own details before you publish.';

const rec = (over: Partial<AuditRecommendation> = {}): AuditRecommendation => ({
  signalKey: 'case-study-evidence',
  label: 'Case study evidence',
  category: 'eeat',
  priority: 'medium',
  recommendation: 'Add one real customer result next to the plans.',
  draft: null,
  ...over,
});

const audit = (
  recommendations: AuditRecommendation[],
  previous: Partial<
    Pick<AuditResult, 'previousScore' | 'previousCreatedAt' | 'signals' | 'partial' | 'pageTrend'>
  > = {},
): AuditResult => ({
  id: 'a1',
  brandId: 'b1',
  url: 'https://ansvisor.com/pricing',
  finalUrl: 'https://ansvisor.com/pricing',
  status: 'completed',
  totalScore: 0.63,
  categoryScores: {},
  signalsEvaluated: 45,
  signalsTotal: 47,
  rubricVersion: '1',
  error: null,
  createdAt: '2026-10-17T09:00:00.000Z',
  completedAt: '2026-10-17T09:01:00.000Z',
  signals: [],
  recommendations,
  ...previous,
});

const signal = (over: Partial<AuditSignal>): AuditSignal => ({
  key: 'readability',
  category: 'content',
  status: 'pass',
  score: 1,
  evidence: {},
  label: 'Readability',
  what: null,
  why: null,
  howToFix: null,
  impactTier: 'standard',
  ...over,
});

let container: HTMLDivElement;
let root: Root;

function render(
  recommendations: AuditRecommendation[],
  previous: Partial<
    Pick<AuditResult, 'previousScore' | 'previousCreatedAt' | 'signals' | 'partial' | 'pageTrend'>
  > = {},
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuditReport audit={audit(recommendations, previous)} />
      </NextIntlClientProvider>,
    );
  });
}

const marks = () => [...container.querySelectorAll('pre mark')].map((m) => m.textContent);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AuditReport recommendations', () => {
  it('highlights the brand’s own facts in a draft as its input needed', () => {
    render([rec({ draft: '[customer name] grew AI citations by [your result] with Growth.' })]);

    expect(container.querySelector('pre')?.textContent).toBe(
      '[customer name] grew AI citations by [your result] with Growth.',
    );
    expect(marks()).toEqual(['[customer name]', '[your result]']);
    expect([...container.querySelectorAll('mark')].map((m) => m.getAttribute('title'))).toEqual([
      'Your input needed',
      'Your input needed',
    ]);
    expect(container.textContent).toContain(NOTE);
  });

  it('shows the code in its own block with its own copy button', () => {
    render([
      rec({
        signalKey: 'faq-schema',
        draft: 'How much is Starter? Starter costs $49 a month.',
        code: '{"@type": "FAQPage", "dateModified": "[date]", "mainEntity": ["a", "b"]}',
      }),
    ]);

    const blocks = [...container.querySelectorAll('pre')].map((p) => p.textContent);
    expect(blocks).toEqual([
      'How much is Starter? Starter costs $49 a month.',
      '{"@type": "FAQPage", "dateModified": "[date]", "mainEntity": ["a", "b"]}',
    ]);
    expect(container.querySelector('[aria-label="Copy draft"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Copy code"]')).not.toBeNull();
    // A JSON array is not a placeholder.
    expect(marks()).toEqual(['[date]']);
    expect(container.textContent).toContain(NOTE);
  });

  it('adds no note to copy without placeholders, or to an older audit without code', () => {
    render([rec({ draft: 'Ansvisor pricing: AI visibility plans for every team size' })]);

    expect(container.querySelectorAll('pre')).toHaveLength(1);
    expect(marks()).toEqual([]);
    expect(container.textContent).not.toContain(NOTE);
  });
});

describe('AuditReport score change', () => {
  it('shows a positive percentage-point delta and the previous audit date', () => {
    render([], {
      previousScore: 0.56,
      previousCreatedAt: '2026-09-28T09:00:00.000Z',
    });

    expect(container.textContent).toContain('+7 since Sep 28');
  });

  it('shows negative and zero deltas accurately', () => {
    render([], {
      previousScore: 0.7,
      previousCreatedAt: '2026-09-28T09:00:00.000Z',
    });
    expect(container.textContent).toContain('-7 since Sep 28');

    render([], {
      previousScore: 0.63,
      previousCreatedAt: '2026-09-28T09:00:00.000Z',
    });
    expect(container.textContent).toContain('0 since Sep 28');
  });

  it('does not show a delta when there is no prior completed score/date', () => {
    render([]);
    expect(container.textContent).not.toContain('since');

    render([], { previousScore: 0.56 });
    expect(container.textContent).not.toContain('since');
  });
});

describe('AuditReport partial audit', () => {
  const PARTIAL = messages.audit.partialNote;
  const NO_CREDIT = messages.audit.partialNoCredit;

  it("says when the AI checks didn't run, and that it used no audit; not otherwise", () => {
    render([], { partial: true });
    expect(container.textContent).toContain(PARTIAL);
    expect(container.textContent).toContain(NO_CREDIT);

    render([]);
    expect(container.textContent).not.toContain(PARTIAL);
    expect(container.textContent).not.toContain(NO_CREDIT);
  });
});

describe('AuditReport score range', () => {
  const mark = () => container.querySelector('[data-slot=score-range]');

  it("shows the range beside the score, from the page's own audits, and says what it means", () => {
    render([], { pageTrend: [0.62, 0.66, 0.63] });
    expect(mark()?.textContent).toBe('± 2');
    expect(mark()?.parentElement?.textContent).toBe('63± 2');
    const tip = "This page's last 3 audits scored 62 to 66, changes to the page included.";
    expect(mark()?.getAttribute('title')).toBe(tip);
    // Written out once beside the gauge, so screen readers hear it once.
    expect(container.textContent?.split(tip)).toHaveLength(2);
  });

  it('says the audits scored the same when the range is ± 0', () => {
    render([], { pageTrend: [0.63, 0.63, 0.63] });
    expect(mark()?.textContent).toBe('± 0');
    expect(container.textContent).toContain("This page's last 3 audits all scored 63.");
  });

  it('shows no range with too few audits, or on a partial audit', () => {
    render([], { pageTrend: [0.6, 0.63] });
    expect(mark()).toBeNull();
    expect(container.textContent).not.toContain('±');

    render([]);
    expect(mark()).toBeNull();

    render([], { partial: true, pageTrend: [0.62, 0.66, 0.63] });
    expect(mark()).toBeNull();
    expect(container.textContent).not.toContain("This page's last");
  });
});

describe('a signal’s finding', () => {
  /** Opens each signal row, and reads the panels' text. */
  const open = () => {
    for (const button of container.querySelectorAll<HTMLButtonElement>('button[aria-controls]')) {
      act(() => button.click());
    }
    return [...container.querySelectorAll('[id^="signal-panel-"]')].map((p) => p.textContent);
  };

  it('shows readability in parts, with the formula and language it was read in', () => {
    render([], {
      signals: [
        signal({
          evidence: {
            language: 'tr',
            formula: 'atesman',
            readingScore: 81,
            wordsPerSentence: 5.6,
            syllablesPerWord: 2.6,
            lettersPerWord: 6,
            wordsPerParagraph: 33,
            mobileLinesPerParagraph: 6,
          },
        }),
      ],
    });
    expect(open()).toEqual([
      'Finding: Reading score 81 (Ateşman, Turkish)' +
        'Sentences: 5.6 words on average' +
        'Words: 2.6 syllables and 6 letters on average' +
        'Paragraphs: 33 words on average, about 6 lines each on a phone',
    ]);
  });

  it('says when a language has no reading formula yet, and counts first-person sentences', () => {
    render([], {
      signals: [
        signal({
          status: 'warn',
          evidence: {
            language: 'it',
            formula: null,
            readingScore: null,
            wordsPerSentence: 24,
            syllablesPerWord: null,
            lettersPerWord: 5.1,
            wordsPerParagraph: null,
            mobileLinesPerParagraph: null,
          },
        }),
        signal({
          key: 'first-person',
          category: 'eeat',
          label: 'First-person evidence',
          evidence: { language: 'en', firstPersonSentences: 29, sentences: 35 },
        }),
      ],
    });
    expect(open()).toEqual([
      'Finding: No reading-score formula for Italian yet: read by sentence and word length' +
        'Sentences: 24 words on average' +
        'Words: 5.1 letters on average',
      'Finding: 29 sentences of 35 told in the first person (English)',
    ]);
  });

  it('shows an older audit’s Flesch score as nothing rather than a part', () => {
    render([], { signals: [signal({ status: 'fail', evidence: { fleschReadingEase: 27 } })] });
    expect(open()).toEqual(['']);
  });
});

describe('evidence levels (SA-010)', () => {
  const llms = signal({
    key: 'llms-txt-presence',
    category: 'trust',
    status: 'fail',
    score: 0,
    label: 'llms.txt presence',
    impactTier: 'medium',
    evidenceLevel: 'informational',
    evidenceNote:
      'Weak evidence: Ahrefs found 97% of llms.txt files are never requested, and Google says it has no effect.',
  });
  const fresh = signal({
    key: 'freshness',
    category: 'authority',
    label: 'Freshness',
    impactTier: 'standard',
    evidenceLevel: 'strong',
  });

  it('labels each signal with its evidence level, not its impact tier', () => {
    render([], { signals: [fresh, signal({ evidenceLevel: 'hygiene' })] });
    const rows = [...container.querySelectorAll('button[aria-controls]')].map((b) => b.textContent);
    // Content's card comes before Authority's.
    expect(rows).toEqual(['ReadabilityHygiene / informational', 'FreshnessStrong evidence']);
    expect(container.textContent).not.toContain('standard');
  });

  it('marks llms.txt as not in the score, with its evidence note', () => {
    render([], { signals: [llms] });
    const row = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="signal-panel-llms-txt-presence"]',
    );
    expect(row?.textContent).toBe('llms.txt presenceNot in the scoreHygiene / informational');
    act(() => row?.click());
    expect(container.querySelector('#signal-panel-llms-txt-presence')?.textContent).toContain(
      'Evidence: Weak evidence: Ahrefs found 97% of llms.txt files are never requested, and Google says it has no effect. Not in the score.',
    );
  });

  it('shows an older payload without evidence levels with no badge', () => {
    render([], { signals: [signal({ evidenceLevel: undefined })] });
    expect(container.querySelector('button[aria-controls]')?.textContent).toBe('Readability');
  });

  it('opens the Formula panel with the category weights, the levels and what is left out', () => {
    render([], { signals: [fresh, llms] });
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Formula',
    );
    act(() => button?.click());
    const text = document.querySelector('[role="dialog"]')?.textContent ?? '';
    expect(text).toContain('How the score is worked out');
    for (const weight of ['Structure25%', 'Content25%', 'Authority20%', 'E-E-A-T20%', 'Trust10%']) {
      expect(text).toContain(weight);
    }
    expect(text).toContain('Strong evidence: Studies tie it to AI citations or crawling.');
    expect(text).toContain('Likely helps: ');
    expect(text).toContain('Hygiene / informational: ');
    expect(text).toContain("The level doesn't change its weight.");
    expect(text).toContain('Not in the scorellms.txt presence: shown for information only.');
  });
});

describe('AI bot access (SA-008)', () => {
  const row = (key: string, name: string, over: Record<string, unknown> = {}) => ({
    key,
    name,
    robots: 'allowed',
    http: 200,
    live: 'ok',
    ...over,
  });
  const bots = (over: Record<string, Record<string, unknown>> = {}) => [
    row('gptbot', 'GPTBot', over.gptbot),
    row('oai-searchbot', 'OAI-SearchBot', over['oai-searchbot']),
    row('chatgpt-user', 'ChatGPT-User', over['chatgpt-user']),
    row('perplexitybot', 'PerplexityBot', over.perplexitybot),
    row('claudebot', 'ClaudeBot', over.claudebot),
    row('google-extended', 'Google-Extended', {
      http: null,
      live: null,
      ...over['google-extended'],
    }),
  ];
  const access = (evidence: Record<string, unknown>, status: AuditSignal['status'] = 'fail') =>
    signal({
      key: 'ai-bot-access',
      category: 'trust',
      label: 'AI bot access',
      status,
      evidence,
      evidenceLevel: 'strong',
    });
  /** Opens the bot check's row, once a render. */
  const open = () =>
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-controls="signal-panel-ai-bot-access"]')
        ?.click(),
    );
  const panel = () => container.querySelector('[data-slot="bot-access"]');
  const cells = () =>
    [...(panel()?.querySelectorAll('li') ?? [])].map((li) => [
      li.textContent,
      li.className.includes('destructive'),
    ]);

  it('lists each bot with its answer, and names a CDN or firewall block', () => {
    render([], {
      signals: [
        access({
          liveTest: 'done',
          control: 200,
          wafBlockedBots: ['perplexitybot'],
          bots: bots({ perplexitybot: { http: 403, live: 'blocked' } }),
        }),
      ],
    });
    open();
    expect(panel()?.textContent).toContain(
      'Finding: PerplexityBot is blocked by your CDN or firewall, though robots.txt lets it in.',
    );
    expect(cells()).toEqual([
      ['GPTBot200', false],
      ['OAI-SearchBot200', false],
      ['ChatGPT-User200', false],
      ['PerplexityBot403', true],
      ['ClaudeBot200', false],
      ['Google-ExtendedAllowed', false],
    ]);
    expect(panel()?.textContent).toContain("Asked once as each bot, from Ansvisor's servers.");
  });

  it('names the bots robots.txt keeps out', () => {
    render([], {
      signals: [
        access({
          liveTest: 'done',
          control: 200,
          bots: bots({
            gptbot: { robots: 'blocked', http: 200 },
            'google-extended': { robots: 'blocked' },
          }),
        }),
      ],
    });
    open();
    expect(panel()?.textContent).toContain(
      'Finding: robots.txt keeps out GPTBot, Google-Extended.',
    );
    expect(cells()[0]).toEqual(['GPTBotrobots.txt', true]);
    expect(cells()[5]).toEqual(['Google-Extendedrobots.txt', true]);
  });

  it('says when every bot was let in', () => {
    render([], { signals: [access({ liveTest: 'done', control: 200, bots: bots() }, 'pass')] });
    open();
    expect(panel()?.textContent).toContain('Finding: Every AI bot tested was let in.');
  });

  it('says when its own request was turned away, and lists robots.txt’s answers alone', () => {
    const untested = bots().map((b) =>
      b.key === 'google-extended' ? b : { ...b, http: null, live: 'inconclusive' },
    );
    render([], {
      signals: [access({ liveTest: 'inconclusive', control: 403, bots: untested }, 'warn')],
    });
    open();
    expect(panel()?.textContent).toContain(
      "Finding: Your site turned away Ansvisor's own request (403), so the bots weren't tested.",
    );
    expect(cells().map(([text]) => text)).toContain('GPTBotAllowed');
  });

  it('shows an audit from before the live test as it was', () => {
    render([], {
      signals: [access({ aiBotsMentioned: ['gptbot'], blocked: true, blockedBots: ['gptbot'] })],
    });
    open();
    expect(panel()).toBeNull();
  });
});

describe('main text without JavaScript (SA-009)', () => {
  const noJs = (evidence: Record<string, unknown>, status: AuditSignal['status'] = 'fail') =>
    signal({
      key: 'no-js-content',
      category: 'structure',
      label: 'Main text without JavaScript',
      status,
      evidence,
      evidenceLevel: 'strong',
    });
  const opened = () => {
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-controls="signal-panel-no-js-content"]')
        ?.click(),
    );
    return container.querySelector('#signal-panel-no-js-content')?.textContent ?? '';
  };

  it('says how much of the main text only JavaScript writes, and the first passages', () => {
    render([], {
      signals: [
        noJs({
          hiddenPercent: 42,
          hiddenWords: 310,
          mainWords: 740,
          hiddenText: ['Step by step', 'Rinse the filter with hot water first…'],
          readAs: 'gptbot',
        }),
      ],
    });
    const text = opened();
    expect(text).toContain(
      "Finding: 42% of the main text (310 of 740 words) appears only after JavaScript runs, so AI crawlers don't see it.",
    );
    expect(text).toContain(
      'Not in the HTML GPTBot gets:“Step by step”“Rinse the filter with hot water first…”',
    );
  });

  it('says all of it is there on a page rendered on the server', () => {
    render([], {
      signals: [
        noJs(
          { hiddenPercent: 0, hiddenWords: 0, mainWords: 740, hiddenText: [], readAs: 'claudebot' },
          'pass',
        ),
      ],
    });
    const text = opened();
    expect(text).toContain(
      'Finding: All the main text is in the HTML ClaudeBot gets, before any JavaScript runs.',
    );
    expect(text).not.toContain('Not in the HTML');
  });

  it('shows no finding for a page it could not compare', () => {
    render([], { signals: [noJs({ compared: false }, 'na')] });
    expect(opened()).not.toContain('Finding');
  });
});
