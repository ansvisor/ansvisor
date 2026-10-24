import { NoObjectGeneratedError, generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './ai-provider.js';
import { logger } from './logger.js';
import { reserveAiBudget } from './plan-guard.js';

/**
 * The kind of source a site is (Quality CE-046, part b), read by the model
 * for a site the editor's rules can't place (web/src/lib/content/
 * source-class.ts): primary, secondary or weak. One read serves every
 * workspace for SOURCE_CLASS_DAYS (content_source_classes, 00264): only the
 * site's address goes to the model, never a path a page links (it may carry
 * someone's document or token, and one page's wording would set the read
 * every workspace gets).
 */

export const SOURCE_KINDS = ['primary', 'secondary', 'weak'];
/** Sites one read takes. */
export const MAX_SOURCE_SITES = 20;
/** How long a site's read is kept. */
export const SOURCE_CLASS_DAYS = 90;
/** A read's hold on the AI budget: up to 20 addresses in, a word each out. */
export const SOURCE_CLASS_HOLD_USD = 0.002;
/** The model reads one draft may cause in a day: the editor asks after saves. */
export const SOURCE_READS_PER_DAY = 30;
const CALL_TIMEOUT_MS = 30_000;

export function sourceClassModelId() {
  return (
    process.env.QUALITY_CHECK_MODEL ||
    process.env.DEFAULT_SUGGESTION_MODEL ||
    'google/gemini-3-flash-preview'
  );
}

/** A link's site as the citations name it (lower case, without "www."), or null. */
export function siteOf(href) {
  try {
    const url = new URL(String(href ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * A site as content_source_classes keeps it (00264): within its length, and
 * without a "www." left at its start ("www.www.x" read as "www.x").
 */
export const keptSite = (site) => site.length <= 253 && !site.startsWith('www.');

/** The sites a page links, from its links' addresses. */
export function linkedSites(hrefs) {
  const sites = new Set();
  for (const href of hrefs) {
    const site = siteOf(href);
    if (site) sites.add(site);
  }
  return sites;
}

const SYSTEM_PROMPT = `You sort websites by how far a fact linked to them can be trusted, as a source on a web page. Each site is one of:
- primary: who a fact is about or who made it: a company's or product's own site or docs, a government body or regulator, a university or research institute, a journal, a standards body, an official statistics office.
- secondary: journalism and analysis that report others' facts: newspapers, magazines, trade press, analyst firms, reference works.
- weak: pages anyone can write or that exist to rank: forums, Q&A sites, social posts, personal blogs, content farms, coupon and affiliate sites, sites of "best X" lists.
Answer for every site listed, one kind each. A site you don't know, judge by its address.`;

const answerSchema = z.object({
  sites: z.array(z.object({ site: z.string(), kind: z.enum(SOURCE_KINDS) })),
});

/** What the model is told: the sites, and nothing of the page. */
export function buildSourceClassPrompt(sites) {
  return `Sites:\n${sites.map((site) => `- ${site}`).join('\n')}`;
}

/**
 * The kinds of these sites (the ones a draft links), read where kept and by
 * the model for the rest, MAX_SOURCE_SITES at most: { classes: [{ site, kind
 * }], limited }. `limited` when the draft has made SOURCE_READS_PER_DAY reads
 * today: the sites not kept are left out. A read draws on the workspace's AI
 * budget as "quality"; a spent budget throws PlanLimitError (429).
 *
 * @param {{ orgId: string, draftId: string, sites: string[] }} input
 */
export async function readSourceClasses({ orgId, draftId, sites }) {
  const asked = sites.filter(keptSite).slice(0, MAX_SOURCE_SITES);
  if (!asked.length) return { classes: [], limited: false };
  const since = new Date(Date.now() - SOURCE_CLASS_DAYS * 86_400_000).toISOString();
  const { data: kept, error } = await supabaseAdmin
    .from('content_source_classes')
    .select('host, kind')
    .in('host', asked)
    .gte('classified_at', since);
  if (error) throw new Error(error.message);
  const kinds = new Map((kept ?? []).map((row) => [row.host, row.kind]));
  const answer = (limited) => ({
    classes: asked.flatMap((site) => (kinds.has(site) ? [{ site, kind: kinds.get(site) }] : [])),
    limited,
  });
  const missing = asked.filter((site) => !kinds.has(site));
  if (!missing.length) return answer(false);

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { count, error: countError } = await supabaseAdmin
    .from('prompt_improve_usage')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('content_draft_id', draftId)
    .eq('feature', 'quality')
    .gte('used_at', dayAgo);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) >= SOURCE_READS_PER_DAY) return answer(true);

  const modelId = sourceClassModelId();
  const budget = await reserveAiBudget(orgId, {
    feature: 'quality',
    modelId,
    draftId,
    holdUsd: SOURCE_CLASS_HOLD_USD,
  });
  let object;
  try {
    const generated = await generateObject({
      model: resolveModel(modelId),
      schema: answerSchema,
      system: SYSTEM_PROMPT,
      prompt: buildSourceClassPrompt(missing),
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    await budget.charge(generated.usage);
    object = generated.object;
  } catch (err) {
    // An answer billed that missed the schema is charged, as the agent's is;
    // one cut off by the timeout is billed all the same: its hold is kept,
    // so it counts in the day's reads too.
    if (NoObjectGeneratedError.isInstance(err) && err.usage) await budget.charge(err.usage);
    else if (err?.name === 'TimeoutError' || err?.name === 'AbortError') await budget.keep();
    throw err;
  } finally {
    await budget.release();
  }

  // Only the sites asked about, each once, as the model names them.
  const open = new Set(missing);
  const rows = [];
  for (const { site, kind } of object.sites) {
    const host = siteOf(`https://${site}`);
    if (!host || !open.has(host)) continue;
    open.delete(host);
    kinds.set(host, kind);
    rows.push({
      host,
      kind,
      model: modelId.slice(0, 100),
      classified_at: new Date().toISOString(),
    });
  }
  if (rows.length) {
    const { error: keepError } = await supabaseAdmin
      .from('content_source_classes')
      .upsert(rows, { onConflict: 'host' });
    if (keepError) logger.warn({ err: keepError }, '[source-class] reads not kept');
  }
  return answer(false);
}
