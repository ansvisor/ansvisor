import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HEADING_LIMITS } from './content-agent.js';
import { SYSTEM_PROMPT, briefKnown, buildBriefPrompt } from './content-brief.js';
import { NAME_PLACEHOLDER, QUOTE_PLACEHOLDER, peopleEdits } from './content-people.js';
import { NUMBER_PLACEHOLDER, addedNumbers } from './content-sources.js';

/**
 * The brief eval (CE-EVAL-001): how good the Content Editor's briefs are,
 * read against the brief rules for AI search (Google's May 2026 guide,
 * Bing's February 2026 guidelines, the GEO paper). Our own briefs only:
 * no competitor's.
 *
 * Each brief is read two ways:
 *   * checks anyone can repeat (briefChecks): its shape, the fan-outs it
 *     answers, and, as a gate, no figure, name, quote or address it wasn't
 *     given left in it after the guard;
 *   * a judge model's scores on the nine criteria (BRIEF_CRITERIA), 0 to 2,
 *     each with the brief's own words that earn it (readJudged drops a
 *     score whose words aren't in the brief).
 *
 * `node src/scripts/eval-brief.js` records both for the cases in
 * __fixtures__/brief-eval/cases.js (recorded.json), with a provider key: the
 * maintainer's run, never CI's. content-brief-eval.test.js reads the record
 * for free on every run, and skips it once the brief's prompt has changed
 * (promptVersion) until it is recorded again.
 */

/** The judge: another model family than the brief's, so it doesn't grade its own. */
export function briefEvalJudgeModelId() {
  return process.env.BRIEF_EVAL_JUDGE_MODEL || 'anthropic/claude-haiku-4-5';
}

/** The nine criteria, as the brief rules (2026) name them: 0 missing, 1 partly, 2 fully. */
export const BRIEF_CRITERIA = [
  {
    key: 'answerFirst',
    ask: 'Does each H2 say what its direct answer must state, so the section can open with a 40–75-word answer?',
  },
  {
    key: 'uniqueAngle',
    ask: "Does it name a unique angle or first-hand proof to gather (the brand's own data, cases, tests, experience), rather than commodity content?",
  },
  {
    key: 'sourcedFacts',
    ask: 'Does it name the facts to state, each with the kind of source it needs (a statistic, a study, a quote), about one per section, without a figure of its own?',
  },
  {
    key: 'entities',
    ask: 'Does it name the brand, its products and the competitors given consistently, exactly as given?',
  },
  {
    key: 'topEssentials',
    ask: 'Does it put the essentials at the top (a TL;DR or key takeaways) and keep the page to one topic?',
  },
  {
    key: 'freshness',
    ask: 'Does it plan freshness where the topic needs it: a dated data point, an updated date, the year?',
  },
  {
    key: 'format',
    ask: 'Does it say how each part is best shown (a table for a comparison, steps for a how-to, a question FAQ at the end), with short headings (H1 up to 60 characters, H2 about 8–15 words)?',
  },
  {
    key: 'naturalLanguage',
    ask: 'Is it free of keyword stuffing and of wording engineered to trigger citations?',
  },
  {
    key: 'links',
    ask: "Does it plan internal links and outbound sources, to the brand's own pages or the sources given only?",
  },
];

/** Sections a brief should plan, as its prompt asks: 3 to 10. */
const SECTIONS = { min: 3, max: 10 };
/** Keywords it should list, as its prompt asks: up to 10. */
const MAX_KEYWORDS = 10;

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;

/** A brief's words, every field, as one text: what the gate and the quotes are read in. */
export function briefText(brief) {
  return [
    brief.goal,
    brief.audience,
    ...brief.outline.flatMap((s) => [s.heading, ...s.keyPoints]),
    ...brief.keywords,
  ]
    .filter(Boolean)
    .join('\n');
}

const PLACEHOLDERS = [NUMBER_PLACEHOLDER, NAME_PLACEHOLDER, QUOTE_PLACEHOLDER];

/**
 * The checks anyone can repeat, for one case's brief (after shapeBrief):
 *   * sections, those without a key point, headings past the editor's limit,
 *     and keywords past the ten the prompt asks for;
 *   * fanoutCoverage: the share of the case's fan-outs an H2 answers;
 *   * placeholders: the figures, names and quotes the guard took out;
 *   * invented (the gate, all 0): figures and names or quotes the guard let
 *     through that the case didn't give, and addresses it didn't list.
 */
export function briefChecks(brief, c) {
  const text = briefText(brief);
  const { known, people } = briefKnown(c);
  const given = new Set([...c.sources.pages.map((p) => p.url), c.draft.source_url].filter(Boolean));
  const answered = new Set(brief.outline.map((s) => s.fanout).filter(Boolean));
  const pieces = text.split('\n');
  return {
    sections: brief.outline.length,
    sectionsInRange: brief.outline.length >= SECTIONS.min && brief.outline.length <= SECTIONS.max,
    emptySections: brief.outline.filter((s) => s.keyPoints.length === 0).length,
    longHeadings: brief.outline.filter((s) => s.heading.length > HEADING_LIMITS.other).length,
    extraKeywords: Math.max(0, brief.keywords.length - MAX_KEYWORDS),
    fanoutCoverage: c.sources.fanouts.length
      ? c.sources.fanouts.filter((f) => answered.has(f.query)).length / c.sources.fanouts.length
      : null,
    placeholders: PLACEHOLDERS.reduce((n, p) => n + text.split(p).length - 1, 0),
    invented: {
      figures: pieces.flatMap((piece) =>
        addedNumbers(piece, known).map((n) => piece.slice(n.start, n.end)),
      ),
      people: pieces.flatMap((piece) =>
        peopleEdits(piece, people).map((e) => piece.slice(e.start, e.end)),
      ),
      urls: [...text.matchAll(URL_RE)]
        .map((m) => m[0].replace(/[.,;:!?]+$/, ''))
        .filter((url) => !given.has(url)),
    },
  };
}

/** Whether a brief passes the gate: nothing it wasn't given left in it. */
export function passesGate(checks) {
  const { figures, people, urls } = checks.invented;
  return figures.length === 0 && people.length === 0 && urls.length === 0;
}

/** What the judge answers: per criterion, its score, the brief's words for it, and why. */
export const judgeSchema = z.object({
  scores: z.array(
    z.object({
      key: z.string(),
      score: z.number(),
      quote: z.string(),
      why: z.string(),
    }),
  ),
});

export const JUDGE_SYSTEM_PROMPT = `You grade one content brief: the plan a writer follows to write a web page that AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Google's AI Overviews) cite.

Rules:
- Score each criterion listed 0 (missing), 1 (partly) or 2 (fully), from what the brief says only. Don't reward length or fill in what it leaves out.
- For a score above 0, put in "quote" the brief's own words that earn it, copied exactly, at most 30 words. For 0, leave "quote" empty.
- A placeholder in square brackets, e.g. [figure, source], marks a fact for the writer to find: that is correct, not a missing fact.
- In "why", one short sentence.
- Score every criterion listed, once each, by its key.`;

/** What the judge is told: the case the brief was built for, the brief, the criteria. */
export function buildJudgePrompt(c, brief) {
  const list = (items) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- none');
  return `The page: ${c.draft.title} (${c.draft.page_type}, ${c.draft.method === 'optimize' ? 'an existing page' : 'a new page'}), for ${c.brand.name}: ${c.brand.description}
Written in: ${c.language}

Prompts it must answer:
${list(c.prompts)}

AI searches (fan-outs) it was given:
${list(c.sources.fanouts.map((f) => f.query))}

The brief:
${JSON.stringify({ goal: brief.goal, audience: brief.audience, outline: brief.outline, keywords: brief.keywords }, null, 2)}

Criteria:
${BRIEF_CRITERIA.map((k) => `- ${k.key}: ${k.ask}`).join('\n')}`;
}

const words = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The judge's answer as kept: one score per criterion, a whole number 0 to
 * 2 (a criterion it left out is 0); a score above 0 whose quote isn't the
 * brief's own words is 0, marked `unquoted`, so a judge can't vouch for what
 * the brief doesn't say.
 */
export function readJudged(answer, brief) {
  const text = words(briefText(brief));
  const byKey = new Map((answer?.scores ?? []).map((s) => [s.key, s]));
  return Object.fromEntries(
    BRIEF_CRITERIA.map(({ key }) => {
      const s = byKey.get(key);
      const score = Math.max(0, Math.min(2, Math.round(Number(s?.score) || 0)));
      const quote = words(s?.quote);
      const unquoted = score > 0 && (!quote || !text.includes(quote));
      return [
        key,
        {
          score: unquoted ? 0 : score,
          quote: s?.quote ?? '',
          why: s?.why ?? '',
          ...(unquoted ? { unquoted: true } : {}),
        },
      ];
    }),
  );
}

/**
 * The brief's prompt as recorded: a hash of its rules and of the prompt the
 * first case gets. A record made under another one is stale.
 */
export function promptVersion(firstCase) {
  return createHash('sha256')
    .update(`${SYSTEM_PROMPT}\n${buildBriefPrompt(firstCase)}`)
    .digest('hex')
    .slice(0, 12);
}

/** A record's sums: per criterion its mean score, the gate, the checks, the tokens. */
export function summarize(cases) {
  const results = Object.values(cases);
  const mean = (values) =>
    values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : 0;
  const coverage = results.map((r) => r.checks.fanoutCoverage).filter((v) => v !== null);
  return {
    cases: results.length,
    criteria: Object.fromEntries(
      BRIEF_CRITERIA.map(({ key }) => [key, mean(results.map((r) => r.judged[key].score))]),
    ),
    total: mean(
      results.map((r) => BRIEF_CRITERIA.reduce((n, { key }) => n + r.judged[key].score, 0)),
    ),
    gateFailures: results.filter((r) => !passesGate(r.checks)).length,
    sectionsInRange: results.filter((r) => r.checks.sectionsInRange).length,
    fanoutCoverage: mean(coverage),
    placeholders: results.reduce((n, r) => n + r.checks.placeholders, 0),
    unquoted: results.reduce(
      (n, r) => n + Object.values(r.judged).filter((j) => j.unquoted).length,
      0,
    ),
    tokens: results.reduce(
      (n, r) => ({
        input: n.input + (r.usage?.inputTokens ?? 0),
        output: n.output + (r.usage?.outputTokens ?? 0),
      }),
      { input: 0, output: 0 },
    ),
  };
}
