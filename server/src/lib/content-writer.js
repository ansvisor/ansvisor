import { randomUUID } from 'crypto';
import { NoObjectGeneratedError, generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './ai-provider.js';
import {
  FANOUT_RULE,
  HEADING_RULE,
  LINK_RULE,
  MAX_AGENT_SUGGESTIONS,
  draftPassages,
  hasOpenSuggestions,
  keepSuggestions,
  passageKey,
  promptPassages,
  readPrompts,
  suggestionsSchema,
  WRITING_STALE_MS,
} from './content-agent.js';
import { contentBriefModelId, rebuildSources } from './content-brief.js';
import { linkAllowList, linkTargetsPrompt, readLinkTargets } from './content-links.js';
import { siteTypeLine, pageTypeFormat } from './content-page-types.js';
import { authorWords, guardPeople, guardPeopleInHtml, knownPeople } from './content-people.js';
import {
  SOURCES_RULE,
  htmlText,
  knownNumbers,
  numberSources,
  placeholderNumbers,
  placeholderNumbersInHtml,
  sourceSuggestion,
  sourceWords,
  stripSourceIds,
  todayText,
} from './content-sources.js';
import {
  MAX_PAGE_HTML,
  MAX_REWRITE_CHARS,
  REWRITE_SYSTEM_PROMPT,
  cleanPageHtml,
  isPageHtml,
  keepBlocks,
  ownText,
  restoreKept,
  rewriteLinks,
  rewriteSchema,
  textLength,
} from './content-rewrite.js';
import { advanceRun, finishRun, isStop, runCall, startRun, stopIfStopped } from './content-runs.js';
import { getLanguageName } from './languages.js';
import { logger } from './logger.js';
import { reserveAiBudget } from './plan-guard.js';

/**
 * "Agent" in the Content Editor's Start (CE-015, spec §5): the Content Agent
 * does the page, and a person reviews it in Library › In review. A new page
 * is written whole, from its brief, prompts, the AI searches behind them and
 * its rules. An existing page is the person's live text: the agent leaves
 * suggestions on it (content_draft_suggestions, 00217), as Fix open rules
 * does, and never changes a passage AI answers quote today.
 *
 * Start doesn't wait for it. The draft says where the agent is
 * (content_drafts.agent_state, 00219): 'writing' while it runs here in the
 * background, then In review, or 'failed'. It is metered from the
 * organization's AI usage, as the brief and the agent's fixes are, and one
 * draft of an organization is written at a time: the budget is checked
 * before a run, so runs started together could all pass it.
 */

/** How long the model may take: nobody waits on the request. */
const CALL_TIMEOUT_MS = 180_000;

// A 'writing' older than WRITING_STALE_MS (content-agent.js, which Fix open
// rules checks too) was left by a server that stopped: it can start again.
export { WRITING_STALE_MS };

/**
 * The drafts the agent writes in: still being worked on, a draft or one in
 * review (Rewrite from brief, after its first run), never one marked ready
 * or published.
 */
const OPEN_STATUSES = ['draft', 'in_review'];

/** What the person's dashboard sends: the sources kept, the page's rules, its locked passages. */
export const writeDraftInput = z.object({
  sources: rebuildSources,
  rules: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        name: z.string().trim().min(1).max(200),
        /** What the rule asks: "aim 3,000 characters". */
        detail: z.string().trim().max(500).default(''),
      }),
    )
    .max(60)
    .default([]),
  textRules: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  /** The passages AI answers quote today, by passageKey (an existing page's). */
  locked: z.array(z.string().max(5000)).max(500).default([]),
});

export const pageSchema = z.object({
  title: z.string().describe('The page title, its H1.'),
  intro: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe('The opening paragraphs, the direct answer first.'),
  sections: z
    .array(
      z.object({
        heading: z.string().describe('The H2.'),
        paragraphs: z.array(z.string()).max(6),
        bullets: z.array(z.string()).max(10).describe('A list after the paragraphs, or none.'),
      }),
    )
    .min(2)
    .max(12),
  faqHeading: z.string().describe('The FAQ section heading, in the page language, or "".'),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })).max(8),
});

const WRITE_SYSTEM_PROMPT = `You are the Content Agent for Answer Engine Optimization (AEO). You write one web page so AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Google's AI Overviews) understand it, trust it and cite it. A person reviews it before it is published.

How to write:
- Answer first: the opening paragraphs answer the page's main question directly.
- Follow the outline when there is one; each H2 answers one of the questions or AI searches given.
- Short paragraphs and plain sentences. Lists where a reader compares or follows steps.
- Follow every rule listed, and the writer's own rules.
- For each fan-out a rule names, use its words, not questions of your own: a section heading for fanoutH2, an FAQ question ending in "?" for fanoutFaq.
- Use only facts from the brand, the brief and your data. Never invent numbers, prices, dates, names, customers, sources or quotes. When the page needs a fact you don't have, write a placeholder in square brackets, e.g. [price], [figure, source, year]. A number that isn't in them becomes a placeholder.
- Plain text in every field: no HTML, no Markdown.
- Write in the language asked for.`;

const SUGGEST_SYSTEM_PROMPT = `You are the Content Agent for Answer Engine Optimization (AEO). You improve one existing web page so AI assistants cite it, by suggesting changes that a person reviews.

Rules for your suggestions:
- Make the page answer the questions and AI searches listed, follow the brief when there is one, and meet the rules listed.
- A replace changes words inside one passage: copy "before" exactly as that passage has it (a phrase or a sentence), and write "after" as plain text that fits in its place, with links only as the links rule below says.
- An insert adds new blocks after a passage, as simple HTML (h2, h3, p, ul, ol, li, strong, em, and a for links): a missing section, a direct answer, an FAQ.
${HEADING_RULE}
${LINK_RULE}
${FANOUT_RULE}
- Never change a passage marked LOCKED: AI assistants quote its wording today. You may insert after it.
- Put the keys of the rules a change meets in "rules" (none when it meets none).
- Use only facts from the page, the brand and your data. Never invent numbers, prices, dates, names, sources or quotes; write a placeholder in square brackets instead, e.g. [figure, source, year].
${SOURCES_RULE}
- Keep the page's voice. The most useful changes first, at most ${MAX_AGENT_SUGGESTIONS}.
- "reason" says in a few words what the change does, e.g. "answer the search 'x' (fan-out)".
- Write in the language asked for.`;

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
const clean = (value) => String(value ?? '').trim();

/**
 * The written page as the editor's HTML: an H1, the opening paragraphs, an
 * H2 per section with its paragraphs and list, and the FAQ as H3 questions.
 * Every text is escaped: the model writes text, never markup.
 */
export function renderPage(page) {
  const p = (text) => (clean(text) ? `<p>${escapeText(clean(text))}</p>` : '');
  const parts = [`<h1>${escapeText(clean(page.title))}</h1>`, ...page.intro.map(p)];
  for (const section of page.sections) {
    if (!clean(section.heading)) continue;
    parts.push(`<h2>${escapeText(clean(section.heading))}</h2>`, ...section.paragraphs.map(p));
    const bullets = section.bullets.filter((b) => clean(b));
    if (bullets.length) {
      parts.push(`<ul>${bullets.map((b) => `<li>${p(b)}</li>`).join('')}</ul>`);
    }
  }
  const faq = page.faq.filter((item) => clean(item.question) && clean(item.answer));
  if (faq.length && clean(page.faqHeading)) {
    parts.push(`<h2>${escapeText(clean(page.faqHeading))}</h2>`);
    for (const item of faq) {
      parts.push(`<h3>${escapeText(clean(item.question))}</h3>`, p(item.answer));
    }
  }
  return parts.filter(Boolean).join('');
}

const list = (items) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- none');

/**
 * A written page with each number its sources don't have (CE-033), and each
 * person's name or quote what it was given doesn't have (CE-044), put as a
 * placeholder.
 */
export function sourcedPage(page, known, people = knownPeople()) {
  const fix = (text, heading = false) =>
    guardPeople(placeholderNumbers(stripSourceIds(text), known), people, { heading }).text;
  const heading = (text) => fix(text, true);
  return {
    ...page,
    title: heading(page.title),
    intro: page.intro.map((text) => fix(text)),
    sections: page.sections.map((section) => ({
      ...section,
      heading: heading(section.heading),
      paragraphs: section.paragraphs.map((text) => fix(text)),
      bullets: section.bullets.map((text) => fix(text)),
    })),
    faqHeading: heading(page.faqHeading),
    faq: page.faq.map((item) => ({ question: heading(item.question), answer: fix(item.answer) })),
  };
}

/** The brief as the model reads it: the draft's own, else its opportunity's. */
export function briefText(draftBrief, opportunityBrief) {
  if (draftBrief?.outline?.length || draftBrief?.goal) {
    const sections = draftBrief.outline.map(
      (s) =>
        `${s.heading}${s.keyPoints?.length ? `: ${s.keyPoints.join('; ')}` : ''}${s.fanout ? ` (answers the AI search "${s.fanout}")` : ''}`,
    );
    return `Goal: ${draftBrief.goal || '—'}
Audience: ${draftBrief.audience || '—'}
Outline:
${list(sections)}
Keywords: ${(draftBrief.keywords ?? []).join(', ') || '—'}`;
  }
  if (opportunityBrief?.outline?.length) {
    const sections = opportunityBrief.outline.map(
      (s) => `${s.heading}${s.keyPoints?.length ? `: ${s.keyPoints.join('; ')}` : ''}`,
    );
    return `Suggested title: ${opportunityBrief.suggestedTitle || '—'}
Outline:
${list(sections)}
Keywords: ${(opportunityBrief.targetKeywords ?? []).join(', ') || '—'}
Call to action: ${opportunityBrief.callToAction || '—'}`;
  }
  return 'No brief: plan the sections from the questions and AI searches below.';
}

/**
 * What the model is told, for a new page, an existing one (passage by
 * passage) or one it rewrites whole (`current`: keepBlocks' page).
 */
export function buildWritePrompt({
  brand,
  draft,
  numbered = [],
  brief,
  input,
  passages,
  more = false,
  lockedKeys,
  linkTargets = '',
  current = null,
}) {
  const { sources } = input;
  // The data, numbered (S1, S2…) as the agent cites it (CE-033).
  const of = (kind) => numbered.filter((s) => s.kind === kind);
  const rules = input.rules.map((r) => `${r.key}: ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  const own = input.textRules.map((text) => `- ${text}`);
  const page = current
    ? rewritePagePrompt(current)
    : passages
      ? `The page, passage by passage:\n${passages
          .map((p, i) => {
            const locked = lockedKeys.has(passageKey(p.text)) ? ', LOCKED' : '';
            return `[${i + 1}] (${p.tag}${locked}) ${p.text}`;
          })
          .join(
            '\n',
          )}${more ? '\n(The page goes on; suggest changes only to the passages above.)' : ''}`
      : `Write a new page titled about: ${draft.title || 'the questions below'}.`;
  return `Brand: ${brand?.name || 'Unknown'}
Industry: ${brand?.industry || 'Not specified'}
${siteTypeLine(brand)}Description: ${brand?.description || 'N/A'}

Page type: ${pageTypeFormat(draft.page_type)}
Length: about ${sources.length} characters.

Brief:
${brief}

Your data is numbered below (S1, S2…), by its words only. Name the ones you use where asked; never write these numbers in the page's words.

Questions the page must answer (tracked prompts):
${list(of('prompt').map((s) => `${s.id} ${s.label}`))}

AI searches (fan-outs) run while answering them, the most searched first:
${list(of('fanout').map((s) => `${s.id} "${s.label}"`))}

Google searches people use (Search Console):
${list(of('gsc_query').map((s) => `${s.id} "${s.label}"`))}

Pages AI cites for these questions today (answer better than them, never copy them):
${list(of('cited_page').map((s) => `${s.id} ${s.label}`))}

Rules (key: rule — what it asks):
${list(rules)}
${own.length ? `\nThe writer's own rules:\n${own.join('\n')}\n` : ''}${linkTargets ? `\n${linkTargets}\n` : ''}
${page}

Write in ${current ? "the page's own language" : getLanguageName(brand?.language)}.`;
}

/** The page a rewrite starts from: its HTML with kept lines, and what each holds. */
function rewritePagePrompt(current) {
  const total = ownText(current) + current.keptChars;
  const legend = [...current.legend].map(([n, what]) => `- [[${current.word} ${n}]]: ${what}`);
  const h1 =
    current.h1Token !== null
      ? `The page's H1 is [[${current.word} ${current.h1Token}]]: keep it first, and write no other H1.\n`
      : '';
  return `The page now, as HTML: about ${total} characters of text, ${current.keptChars} of them in its kept blocks, which count toward Length.
${current.html}
${legend.length ? `\nWhat each kept line holds (kept as it is):\n${legend.join('\n')}\n` : ''}${h1}`;
}

/**
 * Whether the agent is writing another of the organization's drafts now (a
 * 'writing' left by a stopped server doesn't count).
 */
async function organizationWriting(organizationId, draftId, staleBefore) {
  const { data, error } = await supabaseAdmin
    .from('content_drafts')
    .select('id, brands!inner(organization_id)')
    .eq('brands.organization_id', organizationId)
    .eq('agent_state', 'writing')
    .gt('agent_state_at', staleBefore)
    .neq('id', draftId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Starts the agent on a draft: checks it is the brand's and still open to it,
 * that the agent isn't already on it or on another of the organization's
 * drafts, the AI usage budget and the model; marks it 'writing' and runs the
 * model in the background. Throws with `.status` 404 for a draft outside the
 * brand, 409 (code 'not_draft', 'writing' or 'org_writing'), PlanLimitError
 * once the budget is spent, and the provider's error when the model isn't
 * set up — all before anything runs.
 */
export async function startDraftWriting({ draftId, brandId, input, rewrite = false }) {
  const { data: draft, error: draftError } = await supabaseAdmin
    .from('content_drafts')
    .select(
      'id, brand_id, title, page_type, method, source_url, body_html, status, agent_state, agent_state_at, opportunity_id, brief, action_id',
    )
    .eq('id', draftId)
    .maybeSingle();
  if (draftError) throw draftError;
  if (!draft || draft.brand_id !== brandId) {
    throw Object.assign(new Error('Draft not found'), { status: 404 });
  }
  if (!OPEN_STATUSES.includes(draft.status)) {
    throw Object.assign(new Error('Only a draft or one in review can be written'), {
      status: 409,
      code: 'not_draft',
    });
  }
  const staleBefore = new Date(Date.now() - WRITING_STALE_MS).toISOString();
  if (
    draft.agent_state === 'writing' &&
    new Date(draft.agent_state_at).getTime() > Date.now() - WRITING_STALE_MS
  ) {
    throw Object.assign(new Error('The agent is already writing it'), {
      status: 409,
      code: 'writing',
    });
  }
  // An existing page's run, and a rewrite, leave a new batch, which would
  // hide the open one (the editor shows the latest), as Fix open rules and
  // the API refuse.
  if ((rewrite || draft.method === 'optimize') && (await hasOpenSuggestions(draftId))) {
    throw Object.assign(new Error('Decide the open suggestions first'), {
      status: 409,
      code: 'open_suggestions',
    });
  }
  if (rewrite) {
    // A page to rewrite, small enough to send whole.
    if (!draftPassages(draft.body_html).length) {
      throw Object.assign(new Error('The page has no text to rewrite'), {
        status: 422,
        code: 'empty',
      });
    }
    const page = keepBlocks(draft.body_html, new Set(input.locked.map(passageKey)));
    // Kept blocks aren't rewritten: a page that is only those has nothing to rewrite.
    if (!ownText(page)) {
      throw Object.assign(new Error('The page has no text to rewrite'), {
        status: 422,
        code: 'empty',
      });
    }
    if (ownText(page) > MAX_REWRITE_CHARS) {
      throw Object.assign(new Error('The page is too long to rewrite whole'), {
        status: 422,
        code: 'too_long',
      });
    }
  }

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select(
      'name, industry, description, organization_id, language, site_type, shopping_mode_enabled',
    )
    .eq('id', brandId)
    .single();
  if (brandError) throw brandError;
  const modelId = contentBriefModelId();
  // Held on the budget now, for the run below: starts at once can't pass it.
  const budget = await reserveAiBudget(brand.organization_id, {
    feature: 'content',
    modelId,
    draftId,
  });
  try {
    if (await organizationWriting(brand.organization_id, draftId, staleBefore)) {
      throw Object.assign(new Error('The agent is writing another draft'), {
        status: 409,
        code: 'org_writing',
      });
    }
    // A provider that isn't set up fails here, before anything is claimed.
    const model = resolveModel(modelId);

    // Claimed once: a second start meanwhile finds it writing. The claim's
    // time is the run's own: it ends only a claim it still holds (finish).
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('content_drafts')
      .update({
        agent_state: 'writing',
        agent_state_at: claimedAt,
        // Which run, for every device: a failed rewrite is tried again as one.
        agent_run: rewrite ? 'rewrite' : 'write',
      })
      .eq('id', draftId)
      .in('status', OPEN_STATUSES)
      .or(`agent_state.is.null,agent_state.eq.failed,agent_state_at.lt."${staleBefore}"`)
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      throw Object.assign(new Error('The agent is already writing it'), {
        status: 409,
        code: 'writing',
      });
    }

    // Written before the answer, so the editor reads its steps, and Stop finds
    // it, at once; with its claim, the one a Stop on it lets go of.
    const held = { ...draft, agent_state: 'writing', agent_state_at: claimedAt };
    const run = await startWritingRun(held, input, rewrite);
    runDraftWriting({ draft: held, brand, model, input, budget, rewrite, run }).catch((err) =>
      logger.error({ err, draftId }, '[content-writer] run failed'),
    );
  } catch (err) {
    // Not started: the hold goes.
    await budget.release();
    throw err;
  }
  return { started: true };
}

/**
 * The agent's state as it ends, only while it is still the run's to end: the
 * draft still held by this run's own claim (its agent_state_at), never a
 * newer run's after a Stop let the draft go. With `openOnly`, only while the
 * draft is still open to it (not marked ready meanwhile). Answers whether it
 * ended it.
 */
async function finish(draft, values, { openOnly = false } = {}) {
  let query = supabaseAdmin
    .from('content_drafts')
    .update({ ...values, agent_state_at: new Date().toISOString() })
    .eq('id', draft.id)
    .eq('agent_state', 'writing');
  if (draft.agent_state_at) query = query.eq('agent_state_at', draft.agent_state_at);
  if (openOnly) query = query.in('status', OPEN_STATUSES);
  const { data, error } = await query.select('id').maybeSingle();
  if (error) throw error;
  return !!data;
}

/** A draft marked ready or published during the run keeps its page; the agent lets go of it. */
async function letGo(draft) {
  await finish(draft, { agent_state: null });
  logger.info({ draftId: draft.id }, '[content-writer] the draft was closed during the run');
  return { skipped: true };
}

/**
 * A whole page rewritten to the rules, left as ONE suggestion (kind 'page',
 * 00247) beside the page as it was: the person compares them and accepts or
 * rejects it. What the page keeps word for word goes as [[KEEP n]] lines and
 * is put back as it was (content-rewrite.js); a rewrite that drops one, or
 * leaves no page, fails the run. The draft's status doesn't change.
 */
async function rewritePage({
  draft,
  brand,
  model,
  input,
  budget,
  numbered,
  known,
  people,
  brief,
  run,
}) {
  const page = keepBlocks(draft.body_html, new Set(input.locked.map(passageKey)));
  const ruleKeys = new Set(input.rules.map((r) => r.key));
  // The Length rule's target; with Length off, the page keeps its length.
  const length = ruleKeys.has('length') ? input.sources.length : textLength(draft.body_html);
  // Where it may link: the brand's pages and the draft's sources (A).
  const targets = await readLinkTargets({
    brandId: draft.brand_id,
    draftId: draft.id,
    sourceUrl: draft.source_url,
    ruleKeys,
  });
  await advanceRun(run, 2);
  const { object, usage } = await runCall(run, budget, CALL_TIMEOUT_MS, (abortSignal) =>
    generateObject({
      model,
      schema: rewriteSchema,
      system: REWRITE_SYSTEM_PROMPT,
      prompt: buildWritePrompt({
        brand,
        draft,
        numbered,
        brief,
        input: { ...input, sources: { ...input.sources, length } },
        linkTargets: linkTargetsPrompt(targets, ruleKeys),
        current: page,
      }),
      abortSignal,
    }),
  );
  await budget.charge(usage);
  await advanceRun(run, 3);

  if (!isPageHtml(object.html)) throw new Error('The agent answered with no page in HTML');
  // No invented person or quote (CE-044): read in its words as written,
  // blockquotes too, before what it kept goes back, so the page's own
  // passages are never touched.
  const cleaned = cleanPageHtml(
    guardPeopleInHtml(object.html, people).html,
    rewriteLinks(draft.body_html, linkAllowList(targets)),
    { h1Kept: page.h1Token !== null, originalH1: page.h1 },
  );
  const { html: restored, missing } = restoreKept(cleaned, page.kept, {
    word: page.word,
    h1Token: page.h1Token,
  });
  if (missing.length) {
    throw new Error(`The rewrite left out ${missing.length} kept block(s)`);
  }
  // No number without a source: one the page, the brand, the brief or the
  // data doesn't have becomes a placeholder (CE-033).
  const html = placeholderNumbersInHtml(restored, known);
  if (!textLength(html)) throw new Error('The agent left no page to review');
  if (html.length > MAX_PAGE_HTML) throw new Error('The rewritten page is too long to keep');
  // A batch that landed during the run stays the one to decide.
  if (await hasOpenSuggestions(draft.id)) {
    logger.info({ draftId: draft.id }, '[content-writer] open suggestions came in during the run');
    return await letGo(draft);
  }
  // Stopped meanwhile: nothing it wrote is kept.
  await stopIfStopped(run);
  // The data it says it wrote from (CE-033).
  const { sources } = sourceSuggestion({
    named: object.sources,
    marks: [],
    pieces: [],
    numbered,
    known,
  });
  const batchId = randomUUID();
  const { error: insertError } = await supabaseAdmin.from('content_draft_suggestions').insert({
    draft_id: draft.id,
    batch_id: batchId,
    action_id: draft.action_id ?? null,
    position: 0,
    kind: 'page',
    // The passage it stands at: the page's first.
    block_text:
      clean(draftPassages(draft.body_html)[0]?.text).slice(0, 5000) || clean(draft.title) || 'Page',
    before_text: '',
    before_html: draft.body_html,
    after_text: html,
    reason: clean(stripSourceIds(object.reason)).slice(0, 300) || 'Rewrote the page to the rules',
    rule_keys: [...ruleKeys],
    ...(sources.length ? { sources } : {}),
  });
  if (insertError) throw insertError;
  if (!(await finish(draft, { agent_state: null }, { openOnly: true }))) {
    // Nobody reviews a rewrite of a page already marked ready.
    const { error: dropError } = await supabaseAdmin
      .from('content_draft_suggestions')
      .delete()
      .eq('batch_id', batchId);
    if (dropError) throw dropError;
    return await letGo(draft);
  }
  return { rewritten: true };
}

/**
 * The run itself: the page written, or the suggestions left, and the draft
 * In review; 'failed' when the model fails or leaves nothing to review. The
 * model's answer is charged to the hold Start took on the budget
 * (reserveAiBudget); a run that ends before one lets the hold go.
 */
export async function runDraftWriting({
  draft,
  brand,
  model,
  input,
  budget,
  rewrite = false,
  run: started = null,
}) {
  // Its steps, named by the data it reads (CE-027/035): Start writes the run
  // before it answers, so Stop finds it at once; Stop aborts the call.
  const run = started ?? (await startWritingRun(draft, input, rewrite));
  try {
    const result = await writeWithRun({ draft, brand, model, input, budget, rewrite, run });
    await finishRun(
      run,
      'done',
      Number.isInteger(result.suggestions) ? { 2: result.suggestions } : {},
    );
    return result;
  } catch (err) {
    // An answer the provider billed but that missed the schema is charged,
    // as Improve's is: else the costliest call, a whole page, would run free.
    if (NoObjectGeneratedError.isInstance(err) && err.usage) await budget.charge(err.usage);
    if (isStop(err, run)) {
      // Stopped: the page as it was, and the agent lets go of it.
      await finishRun(run, 'stopped');
      await finish(draft, { agent_state: null }).catch((finishErr) =>
        logger.error({ err: finishErr, draftId: draft.id }, '[content-writer] state not saved'),
      );
      return { stopped: true };
    }
    await finishRun(run, 'failed');
    logger.error({ err, draftId: draft.id }, '[content-writer] the agent could not finish');
    await finish(draft, { agent_state: 'failed' }).catch((finishErr) =>
      logger.error({ err: finishErr, draftId: draft.id }, '[content-writer] state not saved'),
    );
    return { failed: true };
  } finally {
    // Nothing charged (it failed before an answer): the hold goes.
    await budget.release();
  }
}

/**
 * A writing run's steps by what it does: a rewrite, a new page, or
 * suggestions on a live one, with the claim it holds on the draft: a Start
 * on a live page runs as 'fix', so its kind alone can't tell a Stop that it
 * holds one.
 */
function startWritingRun(draft, input, rewrite) {
  const { promptIds, fanouts, pages, queries } = input.sources;
  return startRun({
    draftId: draft.id,
    claimedAt: draft.agent_state === 'writing' ? (draft.agent_state_at ?? null) : null,
    kind: rewrite ? 'rewrite' : draft.method === 'create' ? 'write' : 'fix',
    counts: {
      rules: input.rules.length,
      sources: promptIds.length + fanouts.length + pages.length + queries.length,
    },
  });
}

/** The run itself, step by step: nothing is kept once it is stopped. */
async function writeWithRun({ draft, brand, model, input, budget, rewrite, run }) {
  await advanceRun(run, 1);
  const [prompts, opportunityRes] = await Promise.all([
    readPrompts(draft.brand_id, input.sources.promptIds),
    draft.opportunity_id && !draft.brief
      ? supabaseAdmin
          .from('content_opportunities')
          .select('brief')
          .eq('id', draft.opportunity_id)
          .eq('brand_id', draft.brand_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (opportunityRes.error) throw opportunityRes.error;
  const brief = briefText(draft.brief, opportunityRes.data?.brief);
  // The data it writes from, numbered (CE-033); the numbers a suggestion
  // may write unmarked (the page's, the brand's, the brief's, the rules',
  // today's), and those a page written whole may (the sources' words too).
  const numbered = numberSources({
    prompts,
    fanouts: input.sources.fanouts,
    pages: input.sources.pages,
    queries: input.sources.queries,
  });
  const known = knownNumbers(
    htmlText(draft.body_html),
    draft.title,
    brand.name,
    brand.industry,
    brand.description,
    brief,
    ...input.rules.flatMap((r) => [r.name, r.detail]),
    ...input.textRules,
    todayText(),
  );
  const knownInPage = new Set([...known, ...knownNumbers(...numbered.map(sourceWords))]);
  // The people and quotes it may name: the same words, its data's and the authors' (CE-044).
  const people = knownPeople(
    htmlText(draft.body_html),
    draft.title,
    brand.name,
    brand.industry,
    brand.description,
    brief,
    ...input.rules.flatMap((r) => [r.name, r.detail]),
    ...input.textRules,
    ...numbered.map(sourceWords),
    ...(await authorWords(supabaseAdmin, brand.organization_id)),
  );

  if (rewrite) {
    return await rewritePage({
      draft,
      brand,
      model,
      input,
      budget,
      numbered,
      known: knownInPage,
      people,
      brief,
      run,
    });
  }

  if (draft.method === 'create') {
    await advanceRun(run, 2);
    const { object, usage } = await runCall(run, budget, CALL_TIMEOUT_MS, (abortSignal) =>
      generateObject({
        model,
        schema: pageSchema,
        system: WRITE_SYSTEM_PROMPT,
        prompt: buildWritePrompt({ brand, draft, numbered, brief, input }),
        abortSignal,
      }),
    );
    await budget.charge(usage);
    await advanceRun(run, 3);
    // No number without a source: a placeholder where one had none.
    const written = sourcedPage(object, knownInPage, people);
    const title = clean(written.title).slice(0, 300) || draft.title;
    // Stopped meanwhile: the page stays as it was, and History with it.
    await stopIfStopped(run);
    // Try again over a page the person has written in: History keeps it
    // first. Their saves wait while the agent writes (saveContentDraft).
    if (draftPassages(draft.body_html).some((p) => p.tag !== 'h1')) {
      const { error: keepError } = await supabaseAdmin.rpc('content_draft_snapshot', {
        p_draft_id: draft.id,
        p_origin: 'agent_before',
      });
      if (keepError) throw keepError;
    }
    const saved = await finish(
      draft,
      {
        title,
        body_html: renderPage({ ...written, title }),
        status: 'in_review',
        author: 'agent',
        agent_state: null,
      },
      { openOnly: true },
    );
    // Awaited here, so a failure to let go is caught below.
    return saved ? { written: true } : await letGo(draft);
  }

  const { passages, more } = promptPassages(draftPassages(draft.body_html));
  if (!passages.length) throw new Error('The page has no text to improve');
  const lockedKeys = new Set(input.locked.map(passageKey));
  const ruleKeys = new Set(input.rules.map((r) => r.key));
  // Where it may link: the brand's pages and the draft's sources (A).
  const targets = await readLinkTargets({
    brandId: draft.brand_id,
    draftId: draft.id,
    sourceUrl: draft.source_url,
    ruleKeys,
  });
  await advanceRun(run, 2);
  const { object, usage } = await runCall(run, budget, CALL_TIMEOUT_MS, (abortSignal) =>
    generateObject({
      model,
      schema: suggestionsSchema,
      system: SUGGEST_SYSTEM_PROMPT,
      prompt: buildWritePrompt({
        brand,
        draft,
        numbered,
        brief,
        input,
        passages,
        more,
        lockedKeys,
        linkTargets: linkTargetsPrompt(targets, ruleKeys),
      }),
      abortSignal,
    }),
  );
  await budget.charge(usage);
  await advanceRun(run, 3);
  const rows = keepSuggestions(
    object.suggestions,
    passages,
    lockedKeys,
    ruleKeys,
    linkAllowList(targets),
    { numbered, known, people },
  );
  // Stopped meanwhile: nothing it wrote is kept.
  await stopIfStopped(run);
  if (!rows.length) throw new Error('The agent left no suggestion it could place');
  // A batch that landed during the run (Fix open rules, the API) stays the
  // one to decide: this one isn't added over it.
  if (await hasOpenSuggestions(draft.id)) {
    logger.info({ draftId: draft.id }, '[content-writer] open suggestions came in during the run');
    return await letGo(draft);
  }
  const batchId = randomUUID();
  const { error: insertError } = await supabaseAdmin.from('content_draft_suggestions').insert(
    rows.map((row, position) => ({
      ...row,
      draft_id: draft.id,
      batch_id: batchId,
      action_id: draft.action_id ?? null,
      position,
    })),
  );
  if (insertError) throw insertError;
  if (!(await finish(draft, { status: 'in_review', agent_state: null }, { openOnly: true }))) {
    // Nobody reviews suggestions on a page already marked ready.
    const { error: dropError } = await supabaseAdmin
      .from('content_draft_suggestions')
      .delete()
      .eq('batch_id', batchId);
    if (dropError) throw dropError;
    return await letGo(draft);
  }
  return { suggestions: rows.length };
}
