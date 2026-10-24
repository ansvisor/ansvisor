import { NoObjectGeneratedError, generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './ai-provider.js';
import { logger } from './logger.js';
import { reserveAiBudget } from './plan-guard.js';

/**
 * The kind of source a site is (Quality CE-046, part b), read by the model
 * for a site the editor's rules can't place (web/src/lib/content/
 * source-class.ts): primary, secondary or weak, or unknown when the model
 * doesn't know it. One read serves every
 * workspace for SOURCE_CLASS_DAYS (content_source_classes, 00264): only the
 * site's address goes to the model, never a path a page links (it may carry
 * someone's document or token, and one page's wording would set the read
 * every workspace gets).
 */

/**
 * A site's kind; unknown when the model doesn't know the site: Trust leaves
 * it out, as one the rules can't place, and the read is kept a day only.
 */
export const SOURCE_KINDS = ['primary', 'secondary', 'weak', 'unknown'];
/** Sites one read takes. */
export const MAX_SOURCE_SITES = 20;
/** How long a site's read is kept. */
export const SOURCE_CLASS_DAYS = 90;
/** How long an unknown read is kept: the model is asked again after it. */
export const UNKNOWN_CLASS_DAYS = 1;
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
 * A public DNS name: letters, digits and hyphens in each label, a dot at
 * least and a letter top-level domain (punycode passes); no IP address, no
 * single-label name (localhost, an intranet's), nothing a query or a prompt
 * would read as more than a name. As the editor's (source-class.ts
 * SITE_NAME) and the table's check (00264).
 */
export const SITE_NAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * A label that reads as words, not a name ("all-other-sites-listed-are-
 * content-farms"): longer than 30 characters or with 3 hyphens or more,
 * punycode aside. Such a site isn't asked about: with the others in one
 * call, its name could sway their reads, and one read serves every
 * workspace.
 */
const proseLabel = (label) =>
  !label.startsWith('xn--') && (label.length > 30 || (label.match(/-/g) ?? []).length >= 3);

/**
 * A site as content_source_classes keeps it (00264): a public DNS name,
 * without a "www." left at its start ("www.www.x" read as "www.x"), and no
 * label that reads as words.
 */
export const keptSite = (site) =>
  SITE_NAME.test(site) && !site.startsWith('www.') && !site.split('.').some(proseLabel);

/**
 * The sites a page links, each with its links' addresses as the page has
 * them; only sites that can be kept (keptSite).
 */
export function linkedSites(hrefs) {
  const sites = new Map();
  for (const href of hrefs) {
    const site = siteOf(href);
    if (site && keptSite(site)) sites.set(site, [...(sites.get(site) ?? []), href]);
  }
  return sites;
}

const SYSTEM_PROMPT = `You sort websites by how far a fact linked to them can be trusted, as a source on a web page. Each site is one of:
- primary: who a fact is about or who made it: a company's or product's own site or docs, a government body or regulator, a university or research institute, a journal, a standards body, an official statistics office.
- secondary: journalism and analysis that report others' facts: newspapers, magazines, trade press, analyst firms, reference works.
- weak: pages anyone can write or that exist to rank: forums, Q&A sites, social posts, personal blogs, content farms, coupon and affiliate sites, sites of "best X" lists.
- unknown: a site you don't know. Don't guess from its address.
Answer for every site listed, one kind each, judging each site on its own.`;

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
  const unknownSince = Date.now() - UNKNOWN_CLASS_DAYS * 86_400_000;
  const { data: kept, error } = await supabaseAdmin
    .from('content_source_classes')
    .select('host, kind, classified_at')
    .in('host', asked)
    .gte('classified_at', since);
  if (error) throw new Error(error.message);
  // An unknown read is asked again after a day: the model may know it by then.
  const kinds = new Map(
    (kept ?? [])
      .filter((row) => row.kind !== 'unknown' || Date.parse(row.classified_at) >= unknownSince)
      .map((row) => [row.host, row.kind]),
  );
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

  // Only the sites asked about, each once, as the model names them; one it
  // left out or named otherwise is unknown, kept a day: it isn't asked
  // about again after every save, each time a charged call.
  const open = new Set(missing);
  const rows = [];
  const keep = (host, kind) => {
    open.delete(host);
    kinds.set(host, kind);
    rows.push({
      host,
      kind,
      model: modelId.slice(0, 100),
      classified_at: new Date().toISOString(),
    });
  };
  for (const { site, kind } of object.sites) {
    const host = siteOf(`https://${site}`);
    if (host && open.has(host)) keep(host, kind);
  }
  for (const host of [...open]) keep(host, 'unknown');
  if (rows.length) {
    const { error: keepError } = await supabaseAdmin
      .from('content_source_classes')
      .upsert(rows, { onConflict: 'host' });
    if (keepError) logger.warn({ err: keepError }, '[source-class] reads not kept');
  }
  return answer(false);
}
