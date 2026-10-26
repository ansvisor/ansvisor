import { NoObjectGeneratedError, generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './ai-provider.js';
import { PAGE_TYPE_SECTION_FORMATS, pageTypeFormat, siteTypeLine } from './content-page-types.js';
import { getLanguageName } from './languages.js';
import {
  RunStoppedError,
  advanceRun,
  finishRun,
  isStop,
  runCall,
  startRun,
  stopIfStopped,
} from './content-runs.js';
import { citedPagesLength } from './content-cited-length.js';
import { guardPeople, knownPeople, peopleEdits } from './content-people.js';
import {
  addedNumbers,
  knownNumbers,
  numberSources,
  placeholderNumbers,
  todayText,
} from './content-sources.js';
import { reserveAiBudget } from './plan-guard.js';

/**
 * The Content Editor's brief (CE-007, spec §10): Rebuild outline writes a
 * draft's goal, audience and outline from the sources the person kept in the
 * Sources tab (CE-008), each H2 answering one of the searches AI engines ran
 * (a fan-out) on a platform. It is metered from the organization's AI usage,
 * the monthly budget the Improve tab and the task writer draw from — not the
 * content brief quota, which stays with Opportunities' Generate Brief
 * (spec §3).
 */

/** The model, as the Improve tab's. */
export function contentBriefModelId() {
  return (
    process.env.IMPROVE_SUGGESTION_MODEL ||
    process.env.DEFAULT_SUGGESTION_MODEL ||
    'google/gemini-3-flash-preview'
  );
}

/** How long the model may take: the dashboard waits for it. */
const CALL_TIMEOUT_MS = 60_000;

/** A string cut to `max` characters after trimming: a long one is shortened, not refused. */
const cut = (max) =>
  z
    .string()
    .max(10_000)
    .transform((s) => s.trim().slice(0, max));

/** A list of strings, each cut to `max`; the ones left empty are dropped. */
const cutList = (max, count) =>
  z
    .array(cut(max))
    .max(count)
    .transform((items) => items.filter(Boolean));

/** The length a rebuild asks for, in characters. */
export const BRIEF_LENGTH_MIN = 100;
export const BRIEF_LENGTH_MAX = 50_000;

/**
 * What the Sources tab keeps, as the web sends it. Text is cut to fit, and
 * the length is brought into range, rather than refusing the whole rebuild
 * over one long heading or a Length rule out of range.
 */
export const rebuildSources = z.object({
  promptIds: z.array(z.guid()).max(100),
  fanouts: z
    .array(z.object({ query: cut(300), platforms: cutList(60, 12) }))
    .max(40)
    .transform((items) => items.filter((f) => f.query)),
  pages: z.array(z.object({ url: cut(2048), kind: cut(30) })).max(30),
  queries: cutList(300, 20),
  /** The page's headings as written now, for a draft optimizing a page. */
  headings: cutList(300, 30),
  /** The length the page type's rules ask for, in characters. */
  length: z
    .number()
    .int()
    .transform((n) => Math.min(BRIEF_LENGTH_MAX, Math.max(BRIEF_LENGTH_MIN, n))),
  /** The rules in effect, as Fix sends them, for a brief with the 2026 rules on; none before. */
  rules: z
    .array(z.object({ key: cut(60), name: cut(120), detail: cut(300) }))
    .max(80)
    .optional(),
});

/**
 * The limits the web reads a brief with (web/src/lib/content/brief.ts
 * draftBriefSchema): the model's output is cut to them, so a brief saved and
 * charged for is one the editor can show.
 */
export const BRIEF_LIMITS = {
  goal: 500,
  audience: 500,
  sections: 12,
  heading: 300,
  keyPoints: 8,
  keyPoint: 500,
  keywords: 15,
  keyword: 80,
};

/**
 * The brief rules (2026) on (CONTENT_BRIEF_RULES=true): the brief plans each
 * section's answer, format and facts, as version 2 (web brief.ts). Off until
 * the brief eval (content-brief-eval.js) passes them: then the brief is
 * version 1, as before.
 */
export function briefRulesOn() {
  return process.env.CONTENT_BRIEF_RULES === 'true';
}

/**
 * Version 2's limits, as the web reads them (web/src/lib/content/brief.ts
 * BRIEF_V2_LIMITS, which content-brief.test.js reads to compare).
 */
export const BRIEF_V2_LIMITS = { answer: 600, facts: 4, claim: 300, url: 2048 };
/** How a section is best shown; the kind of source a fact needs (web brief.ts). */
export const BRIEF_FORMATS = ['paragraphs', 'list', 'steps', 'table', 'faq'];
export const FACT_SOURCES = ['statistic', 'study', 'quote', 'example', 'official'];

// No counts or lengths enforced on the model: a miss would fail the whole
// call (charged all the same). They are asked for here and cut afterwards.
export const outlineSchema = z.object({
  goal: z.string().describe('What the page must achieve for the brand, in one sentence.'),
  audience: z.string().describe('Who the page is for, in one sentence.'),
  outline: z
    .array(
      z.object({
        heading: z.string().describe('The H2, worded as the answer a reader looks for.'),
        keyPoints: z.array(z.string()).describe('What the section must cover: up to 5 points.'),
        fanout: z
          .string()
          .nullable()
          .describe('The AI search this H2 answers, copied exactly from the list, or null.'),
        platform: z
          .string()
          .nullable()
          .describe('The platform key that ran that search, from its list, or null.'),
      }),
    )
    .describe('3 to 10 sections.'),
  keywords: z.array(z.string()).describe('Up to 10 keywords.'),
});

/** Version 2's: each section with its answer, format and facts. */
export const outlineSchemaV2 = outlineSchema.extend({
  outline: z
    .array(
      outlineSchema.shape.outline.element.extend({
        answer: z
          .string()
          .nullable()
          .describe(
            "What the section's first sentences must answer directly, in one line: a note to the writer, not the answer.",
          ),
        format: z
          .string()
          .nullable()
          .describe('How the section is best shown: paragraphs, list, steps, table or faq.'),
        facts: z
          .array(
            z.object({
              claim: z
                .string()
                .describe('A fact the section should state, as what to find out: never a figure.'),
              sourceType: z
                .string()
                .describe(
                  'The kind of source it needs: statistic, study, quote, example or official.',
                ),
              source: z
                .string()
                .nullable()
                .describe(
                  'The number (S1…) of the data listed that gives it, or null to find one.',
                ),
            }),
          )
          .describe('Up to 2 facts.'),
      }),
    )
    .describe('3 to 10 sections.'),
});

export const SYSTEM_PROMPT = `You are a senior content strategist for Answer Engine Optimization (AEO). You plan one web page so AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Google's AI Overviews) cite it.

Rules:
- Plan an outline of H2 sections. Each H2 should answer one of the AI searches (fan-outs) listed, the most searched first, and name it exactly in "fanout" with one of its platform keys in "platform". An H2 that answers none has null for both.
- Cover the prompts listed: they are the questions the page must answer.
- Use only the facts given. Never invent numbers, prices, dates, names or claims; a key point that needs a fact says what to find out.
- When the page exists, keep its useful headings and improve them rather than starting over.
- Cited pages show what AI quotes today; plan to answer better than them, never to copy them.
- Write every field in the language asked for.`;

/** Version 2's rules (the brief rules, 2026), after version 1's. */
export const SYSTEM_PROMPT_V2 = `${SYSTEM_PROMPT}
- Answer first: in "answer", say what each section's first sentences must answer directly, as a note to the writer.
- In "facts", name about one fact per section the page should state, with the kind of source it needs; give the number (S1…) of the data listed only when that source gives it, else null. Never write a figure of your own.
- In "format", say how each section is best shown: a table for a comparison, numbered steps for a how-to, a list for picks or criteria, paragraphs for an explanation, faq for questions (its key points are the questions).
- Headings: the page's title up to 60 characters; each H2 about 8 to 15 words.
- No keyword stuffing, and no wording made to trigger a citation: write for the reader.
- Follow the rules the page is written to, when listed.`;

/** The brief's rules and schema: version 2's with the brief rules on, else version 1's. */
export function briefSystemPrompt() {
  return briefRulesOn() ? SYSTEM_PROMPT_V2 : SYSTEM_PROMPT;
}
export function briefSchema() {
  return briefRulesOn() ? outlineSchemaV2 : outlineSchema;
}

const norm = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Text cut to `max` characters, never inside a placeholder: one the cut would
 * split ("[figure, so") goes whole.
 */
const clip = (text, max) => {
  const cut = text.trim().slice(0, max);
  const open = cut.lastIndexOf('[');
  return open > cut.lastIndexOf(']') ? cut.slice(0, open).trimEnd() : cut;
};

/** A question in quotes ("Which machine should I buy?"): one to answer, not a person's words. */
const QUOTED_QUESTION = /["“„«»]([^"“”„«»\n]{1,300}\?)["”“»«]/gu;

/**
 * Builds the brief: reads the draft and its brand, keeps the prompts that are
 * the brand's, charges the AI usage budget, asks the model, and saves the
 * brief on the draft. Throws with `.status` 404 for a draft outside the
 * brand, 422 with no sources to build from, PlanLimitError once the budget
 * is spent.
 */
export async function rebuildDraftBrief({ draftId, brandId, sources }) {
  const { data: draft, error: draftError } = await supabaseAdmin
    .from('content_drafts')
    .select('id, brand_id, title, page_type, method, source_url')
    .eq('id', draftId)
    .maybeSingle();
  if (draftError) throw draftError;
  if (!draft || draft.brand_id !== brandId) {
    throw Object.assign(new Error('Draft not found'), { status: 404 });
  }

  const [brandRes, promptsRes] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select(
        'name, industry, description, organization_id, language, site_type, shopping_mode_enabled',
      )
      .eq('id', brandId)
      .single(),
    sources.promptIds.length
      ? supabaseAdmin
          .from('prompts')
          .select('id, text, prompt_sets!inner(brand_id)')
          .in('id', sources.promptIds)
          .eq('prompt_sets.brand_id', brandId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (brandRes.error) throw brandRes.error;
  if (promptsRes.error) throw promptsRes.error;
  const brand = brandRes.data;
  const promptRows = (promptsRes.data ?? []).map((p) => ({ id: p.id, text: p.text }));
  const prompts = promptRows.map((p) => p.text);

  if (!prompts.length && !sources.fanouts.length && !sources.queries.length) {
    throw Object.assign(new Error('No prompts, fan-outs or queries to build from'), {
      status: 422,
      code: 'no_sources',
    });
  }

  // Its steps, named by the data it reads (CE-027/035); Stop aborts the call.
  const run = await startRun({
    draftId,
    kind: 'brief',
    counts: {
      sources:
        prompts.length + sources.fanouts.length + sources.pages.length + sources.queries.length,
    },
  });
  try {
    const brief = await briefWithRun({ draft, draftId, brand, prompts, promptRows, sources, run });
    await finishRun(run, 'done');
    return brief;
  } catch (err) {
    if (isStop(err, run)) {
      await finishRun(run, 'stopped');
      throw new RunStoppedError();
    }
    await finishRun(run, 'failed');
    throw err;
  }
}

/** The rebuild itself, step by step: nothing is saved once it is stopped. */
async function briefWithRun({ draft, draftId, brand, prompts, promptRows, sources, run }) {
  const modelId = contentBriefModelId();
  // Held on the budget before the call, so calls at once can't pass it.
  const budget = await reserveAiBudget(brand.organization_id, {
    feature: 'content',
    modelId,
    draftId,
  });
  // The cited pages' length, read beside the model call (CE-030); never fails it.
  const citedLength = citedPagesLength({
    brandId: draft.brand_id,
    pages: sources.pages,
    ownUrl: draft.source_url,
    signal: run.signal,
  });

  let generated;
  try {
    await advanceRun(run, 1);
    generated = await runCall(run, budget, CALL_TIMEOUT_MS, (abortSignal) =>
      generateObject({
        model: resolveModel(modelId),
        schema: briefSchema(),
        system: briefSystemPrompt(),
        prompt: buildBriefPrompt({ brand, draft, prompts, promptRows, sources }),
        abortSignal,
      }),
    );
    await budget.charge(generated.usage);
  } catch (err) {
    // An answer that didn't fit the schema was still paid for: charged as
    // Improve charges it, so retries don't run free.
    if (NoObjectGeneratedError.isInstance(err) && err.usage) await budget.charge(err.usage);
    throw err;
  } finally {
    // Nothing charged (a timeout, a refusal): the hold goes.
    await budget.release();
  }
  const { object } = generated;
  // Each H2 matched to the fan-out it answers (mapOutline).
  await advanceRun(run, 2);

  const brief = {
    ...shapeBrief(object, { brand, draft, prompts, promptRows, sources }),
    origin: 'rebuild',
    builtAt: new Date().toISOString(),
    builtFrom: {
      prompts: prompts.length,
      fanouts: sources.fanouts.length,
      pages: sources.pages.length,
      queries: sources.queries.length,
    },
    citedLength: await citedLength,
  };
  // Stopped meanwhile: the brief stays as it was.
  await stopIfStopped(run);
  const { error: saveError } = await supabaseAdmin
    .from('content_drafts')
    .update({ brief })
    .eq('id', draftId);
  if (saveError) throw saveError;
  return brief;
}

/**
 * The brief as saved, from the model's answer: what it adds beyond what it
 * was built from as a placeholder (briefGuard), before the cut; each H2
 * matched to the fan-out it answers (mapOutline); the keywords kept once.
 * The brief eval (content-brief-eval.js) reads the model's answers through
 * it too.
 */
export function shapeBrief(object, args) {
  return fitBrief(shapeWhole(object, args));
}

/**
 * Under content_drafts.brief's 64 KB (00212), with room for jsonb's spaces:
 * past it, the facts' sources go, then the facts (a fact's source is a whole
 * address, 2 KB at most), so a brief charged for is one that saves.
 */
const BRIEF_BYTES = 60_000;
function fitBrief(brief) {
  const size = (b) => Buffer.byteLength(JSON.stringify(b));
  if (brief.version !== 2 || size(brief) <= BRIEF_BYTES) return brief;
  const without = (strip) => ({
    ...brief,
    outline: brief.outline.map((section) => ({ ...section, facts: strip(section.facts ?? []) })),
  });
  const unsourced = without((facts) => facts.map((f) => ({ ...f, source: null })));
  return size(unsourced) <= BRIEF_BYTES ? unsourced : without(() => []);
}

function shapeWhole(object, { brand, draft, prompts, promptRows, sources }) {
  const guard = briefGuard({ brand, draft, prompts, sources });
  // Version 2's (a model answer with them): each section's answer, format and facts.
  const v2 = object.outline.some((section) => 'answer' in section || 'facts' in section);
  const byId = v2
    ? new Map(briefNumbered({ prompts, promptRows, sources }).map((n) => [n.id, n]))
    : null;
  return {
    goal: clip(guard.text(object.goal), BRIEF_LIMITS.goal),
    audience: clip(guard.text(object.audience), BRIEF_LIMITS.audience),
    outline: mapOutline(
      object.outline.map((section) => ({
        ...section,
        heading: guard.heading(section.heading),
        keyPoints: (section.keyPoints ?? []).map((point) => guard.text(point)),
        ...(v2 ? sectionPlan(section, guard, byId) : {}),
      })),
      sources.fanouts,
    ),
    keywords: [
      ...new Set(
        object.keywords
          .filter(guard.keeps)
          .map((k) => k.trim().slice(0, BRIEF_LIMITS.keyword))
          .filter(Boolean),
      ),
    ].slice(0, BRIEF_LIMITS.keywords),
    ...(v2 ? { version: 2 } : {}),
  };
}

/**
 * A section's plan of version 2, cut to the web's limits (BRIEF_V2_LIMITS)
 * and guarded as the rest: its answer, its format if one the web knows, its
 * facts (a kind of source the web knows, the source by kind and ref as a
 * suggestion keeps it, never its number in this run: S1 is another source
 * once the Sources tab changes).
 */
function sectionPlan(section, guard, byId) {
  const answer = clip(guard.text(section.answer ?? ''), BRIEF_V2_LIMITS.answer);
  const format = BRIEF_FORMATS.includes(section.format) ? section.format : null;
  const facts = (section.facts ?? [])
    .map((fact) => {
      const claim = clip(guard.text(fact?.claim ?? ''), BRIEF_V2_LIMITS.claim);
      const sourceType = String(fact?.sourceType ?? '')
        .trim()
        .toLowerCase();
      if (!claim || !FACT_SOURCES.includes(sourceType)) return null;
      const given = byId.get(
        String(fact?.source ?? '')
          .trim()
          .toUpperCase(),
      );
      return {
        claim,
        sourceType,
        source: given
          ? {
              kind: given.kind,
              ref: String(given.ref).slice(0, BRIEF_V2_LIMITS.url),
              label: clip(given.label, BRIEF_V2_LIMITS.claim),
            }
          : null,
      };
    })
    .filter(Boolean)
    .slice(0, BRIEF_V2_LIMITS.facts);
  return { answer: answer || null, format, facts };
}

/**
 * The data a brief is built from, numbered as the writer numbers it (S1…,
 * numberSources): the prompts (by id; the eval's by their place), the
 * fan-outs, the cited pages, the Search Console queries. Version 2's facts
 * name their source by it.
 */
export function briefNumbered({ prompts, promptRows, sources }) {
  return numberSources({
    prompts: promptRows ?? prompts.map((text, i) => ({ id: `prompt-${i + 1}`, text })),
    fanouts: sources.fanouts,
    pages: sources.pages,
    queries: sources.queries,
  });
}

/**
 * What a brief may say without a placeholder: the numbers (CE-033), names
 * and quotes (CE-044) of what it was built from — the brand, the page, the
 * prompts, searches, queries and headings kept, the length asked for — and
 * today's year. The writer reads a brief as something it was given, so a
 * figure or a person made up in one would pass the writer's own guard.
 * `text` and `heading` put each one added as a placeholder, as a written
 * page's are, a question in quotes aside; `keeps` drops a keyword that adds
 * one, as a placeholder can't be searched for; `found` lists what a text
 * adds, read the same way (the brief eval's gate).
 */
export function briefGuard({ brand, draft, prompts, sources }) {
  const { given, known, people } = briefKnown({ brand, draft, prompts, sources });
  // The names and quotes a text may have: a question in quotes in it too.
  const askedIn = (words) => {
    const questions = [...words.matchAll(QUOTED_QUESTION)].map((m) => m[1]);
    return questions.length ? knownPeople(...given, ...questions) : people;
  };
  const text = (words, heading = false) => {
    const numbered = placeholderNumbers(words ?? '', known);
    return guardPeople(numbered, askedIn(numbered), { heading }).text;
  };
  return {
    text,
    heading: (words) => text(words, true),
    keeps: (keyword) => text(keyword) === String(keyword ?? ''),
    /** What a text says that it wasn't given, as the guard reads it: what it would take out. */
    found: (words, heading = false) => {
      const read = String(words ?? '');
      return {
        figures: addedNumbers(read, known).map((n) => read.slice(n.start, n.end)),
        people: peopleEdits(read, askedIn(read), { heading }).map((e) =>
          read.slice(e.start, e.end),
        ),
      };
    },
  };
}

/**
 * What a brief is built from (`given`), and the numbers (`known`) and the
 * names and quotes (`people`) it may say: briefGuard's, and the brief eval's.
 */
export function briefKnown({ brand, draft, prompts, sources }) {
  const given = [
    brand?.name,
    brand?.industry,
    brand?.description,
    draft.title,
    ...prompts,
    ...sources.fanouts.map((f) => f.query),
    ...sources.queries,
    ...sources.headings,
    String(sources.length),
  ];
  return { given, known: knownNumbers(...given, todayText()), people: knownPeople(...given) };
}

/**
 * Keeps an H2's fan-out only when it is one the person kept, written as
 * listed, and its platform only when that search ran there. Cut to the
 * limits the web reads a brief with (BRIEF_LIMITS): a heading or key point
 * left empty goes, long text is shortened, and the lists are capped.
 */
export function mapOutline(outline, fanouts) {
  const byQuery = new Map(fanouts.map((f) => [norm(f.query), f]));
  return outline
    .map((section) => {
      const fanout = section.fanout ? byQuery.get(norm(section.fanout)) : undefined;
      const platform =
        fanout && fanout.platforms.includes(section.platform)
          ? section.platform
          : (fanout?.platforms[0] ?? null);
      return {
        heading: clip(section.heading ?? '', BRIEF_LIMITS.heading),
        keyPoints: (section.keyPoints ?? [])
          .map((p) => clip(p, BRIEF_LIMITS.keyPoint))
          .filter(Boolean)
          .slice(0, BRIEF_LIMITS.keyPoints),
        fanout: fanout?.query ?? null,
        platform: fanout ? platform : null,
        // Version 2's plan (shapeBrief), as shaped.
        ...('answer' in section
          ? { answer: section.answer, format: section.format, facts: section.facts }
          : {}),
      };
    })
    .filter((section) => section.heading)
    .slice(0, BRIEF_LIMITS.sections);
}

/** What the model is told: the brand, the page, and the sources kept. */
export function buildBriefPrompt({ brand, draft, prompts, promptRows, sources }) {
  const list = (items) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- none');
  // With the brief rules on, each piece of data by its number (S1…), for the facts' sources.
  const v2 = briefRulesOn();
  const numbered = v2 ? briefNumbered({ prompts, promptRows, sources }) : [];
  const id = (kind, i) => {
    const of = numbered.filter((n) => n.kind === kind);
    return v2 && of[i] ? `${of[i].id}: ` : '';
  };
  const leans = v2 ? PAGE_TYPE_SECTION_FORMATS[draft.page_type] : null;
  const rules = v2 ? (sources.rules ?? []).filter((r) => r.name) : [];
  return `Brand: ${brand?.name || 'Unknown'}
Industry: ${brand?.industry || 'Not specified'}
${siteTypeLine(brand)}Description: ${brand?.description || 'N/A'}

Page: ${draft.title || 'Untitled'}
Page type: ${pageTypeFormat(draft.page_type)}
${leans ? `Its sections lean to: ${leans}.\n` : ''}${draft.method === 'optimize' && draft.source_url ? `Existing page to improve: ${draft.source_url}` : 'A new page.'}
Length: about ${sources.length} characters.
${rules.length ? `\nRules the page is written to:\n${list(rules.map((r) => (r.detail ? `${r.name}: ${r.detail}` : r.name)))}\n` : ''}
Prompts the page must answer:
${list(prompts.map((p, i) => `${id('prompt', i)}${p}`))}

AI searches (fan-outs) run while answering them, with the platform keys that ran each and the most searched first:
${list(sources.fanouts.map((f, i) => `${id('fanout', i)}"${f.query}" (${f.platforms.join(', ') || 'unknown'})`))}

Google searches people use (Search Console):
${list(sources.queries.map((q, i) => `${id('gsc_query', i)}${q}`))}

Pages AI cites for these prompts today:
${list(sources.pages.map((p, i) => `${id('cited_page', i)}${p.url} (${p.kind})`))}

${sources.headings.length ? `The page's headings now:\n${list(sources.headings)}\n\n` : ''}Write the brief in ${getLanguageName(brand?.language)}.`;
}
