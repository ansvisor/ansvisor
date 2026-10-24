import { NoObjectGeneratedError, generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './ai-provider.js';
import { siteTypeLine, pageTypeFormat } from './content-page-types.js';
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

// No counts or lengths enforced on the model: a miss would fail the whole
// call (charged all the same). They are asked for here and cut afterwards.
const outlineSchema = z.object({
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

const SYSTEM_PROMPT = `You are a senior content strategist for Answer Engine Optimization (AEO). You plan one web page so AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Google's AI Overviews) cite it.

Rules:
- Plan an outline of H2 sections. Each H2 should answer one of the AI searches (fan-outs) listed, the most searched first, and name it exactly in "fanout" with one of its platform keys in "platform". An H2 that answers none has null for both.
- Cover the prompts listed: they are the questions the page must answer.
- Use only the facts given. Never invent numbers, prices, dates, names or claims; a key point that needs a fact says what to find out.
- When the page exists, keep its useful headings and improve them rather than starting over.
- Cited pages show what AI quotes today; plan to answer better than them, never to copy them.
- Write every field in the language asked for.`;

const norm = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

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
  const prompts = (promptsRes.data ?? []).map((p) => p.text);

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
    const brief = await briefWithRun({ draft, draftId, brand, prompts, sources, run });
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
async function briefWithRun({ draft, draftId, brand, prompts, sources, run }) {
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
        schema: outlineSchema,
        system: SYSTEM_PROMPT,
        prompt: buildBriefPrompt({ brand, draft, prompts, sources }),
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
    goal: object.goal.trim().slice(0, BRIEF_LIMITS.goal),
    audience: object.audience.trim().slice(0, BRIEF_LIMITS.audience),
    outline: mapOutline(object.outline, sources.fanouts),
    keywords: [
      ...new Set(
        object.keywords.map((k) => k.trim().slice(0, BRIEF_LIMITS.keyword)).filter(Boolean),
      ),
    ].slice(0, BRIEF_LIMITS.keywords),
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
        heading: (section.heading ?? '').trim().slice(0, BRIEF_LIMITS.heading),
        keyPoints: (section.keyPoints ?? [])
          .map((p) => p.trim().slice(0, BRIEF_LIMITS.keyPoint))
          .filter(Boolean)
          .slice(0, BRIEF_LIMITS.keyPoints),
        fanout: fanout?.query ?? null,
        platform: fanout ? platform : null,
      };
    })
    .filter((section) => section.heading)
    .slice(0, BRIEF_LIMITS.sections);
}

/** What the model is told: the brand, the page, and the sources kept. */
export function buildBriefPrompt({ brand, draft, prompts, sources }) {
  const list = (items) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- none');
  return `Brand: ${brand?.name || 'Unknown'}
Industry: ${brand?.industry || 'Not specified'}
${siteTypeLine(brand)}Description: ${brand?.description || 'N/A'}

Page: ${draft.title || 'Untitled'}
Page type: ${pageTypeFormat(draft.page_type)}
${draft.method === 'optimize' && draft.source_url ? `Existing page to improve: ${draft.source_url}` : 'A new page.'}
Length: about ${sources.length} characters.

Prompts the page must answer:
${list(prompts)}

AI searches (fan-outs) run while answering them, with the platform keys that ran each and the most searched first:
${list(sources.fanouts.map((f) => `"${f.query}" (${f.platforms.join(', ') || 'unknown'})`))}

Google searches people use (Search Console):
${list(sources.queries)}

Pages AI cites for these prompts today:
${list(sources.pages.map((p) => `${p.url} (${p.kind})`))}

${sources.headings.length ? `The page's headings now:\n${list(sources.headings)}\n\n` : ''}Write the brief in ${getLanguageName(brand?.language)}.`;
}
