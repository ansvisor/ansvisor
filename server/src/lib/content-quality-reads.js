import * as cheerio from 'cheerio';
import { ChatBudgetError } from './chat-budget.js';
import { readBrandFacts } from './brand-facts.js';
import { pageReadContext } from './content-page-context.js';
import { qualityPhase } from './content-quality.js';
import { readDraftClaims } from './content-quality-claims.js';
import { readPage } from './content-quality-page.js';
import { linkedSites, readSourceClasses } from './content-source-class.js';
import { checkLinks, reserveReads } from './link-check.js';
import { PlanLimitError } from './plan-guard.js';
import { readSiteTrust } from './site-trust.js';
import logger from './logger.js';

/**
 * Content Quality's reads of a draft as saved, for the web's server-side
 * Quality (lib/content/go-live-gate.ts): an agent's go-live gate
 * (routes/internal-chat-go-live.js) and a page's version card in Chat
 * (routes/internal-chat-quality.js, CHAT-25 §6, W4-12b part 2). Its links
 * (link-check.js, the acting person's hourly reads), and with Quality's
 * phase 2 its claims, its page read and the kinds of `sites` (the sites the
 * rules can't place, among those the draft links). A read the draft has kept
 * costs nothing; a new one is held by `reserve` (the run's own step). With
 * them, the brand's facts (phase 2) and its site's trust, as the editor
 * reads them. Each read answers on its own, so one that fails leaves the
 * others: { links, claims, page, classes, facts, siteTrust }, each
 * { ok: true, value } or { ok: false, code } (run_cap, ai_budget,
 * not_kept, off, failed).
 */

/** A read that would need a model call while the caller spends nothing (`reserve: NO_SPEND`). */
export class NoSpendError extends Error {
  constructor() {
    super('A new read would spend AI usage');
    this.name = 'NoSpendError';
  }
}

/** A reserve that holds nothing: only the reads the draft has kept are given. */
export const NO_SPEND = async () => {
  throw new NoSpendError();
};

/** One read's answer: its value, or why it couldn't be read. */
export async function settle(read) {
  try {
    return { ok: true, value: await read() };
  } catch (err) {
    if (err instanceof ChatBudgetError && err.code === 'run_cap') {
      return { ok: false, code: 'run_cap' };
    }
    if (err instanceof NoSpendError) return { ok: false, code: 'not_kept' };
    if (err instanceof PlanLimitError) return { ok: false, code: 'ai_budget' };
    logger.warn(
      { err: { name: err?.name, message: err?.message } },
      '[quality-reads] a quality read failed',
    );
    return { ok: false, code: 'failed' };
  }
}

export const OFF = { ok: false, code: 'off' };

/**
 * The reads, for a draft already checked as the caller's to read: `draft`
 * holds its id, brand_id, body_html, page_type and kept_sources.
 *
 * @param {{ orgId: string, actingUserId: string, draft: object, sites: string[], reserve: Function, log?: object }} input
 */
export async function readQuality({ orgId, actingUserId, draft, sites: asked, reserve, log }) {
  const html = draft.body_html ?? '';
  const $ = cheerio.load(html);
  const hrefs = $('a[href]')
    .map((_, el) => $(el).attr('href'))
    .get();
  const phase2 = qualityPhase() >= 2;
  // Only sites the draft links, and not one whose every link the person kept.
  const linked = linkedSites(hrefs);
  const kept = new Set(draft.kept_sources ?? []);
  const sites = [...new Set(asked)].filter(
    (site) => linked.has(site) && !linked.get(site).every((href) => kept.has(href)),
  );
  const common = { orgId, draftId: draft.id };
  const [links, claims, page, classes, facts, siteTrust] = await Promise.all([
    settle(() =>
      checkLinks(hrefs, {
        reserve: (wanted) => reserveReads(actingUserId, wanted),
        log: log ?? logger,
      }).then(({ reads, skipped }) => ({
        links: [...reads].map(([href, read]) => ({ href, ...read })),
        skipped,
      })),
    ),
    phase2 ? settle(() => readDraftClaims({ ...common, html, reserve })) : OFF,
    phase2
      ? settle(async () =>
          readPage({
            ...common,
            html,
            pageType: draft.page_type,
            ...(await pageReadContext(draft.brand_id)),
            reserve,
          }),
        )
      : OFF,
    phase2
      ? sites.length
        ? settle(() => readSourceClasses({ ...common, sites, reserve }))
        : { ok: true, value: { classes: [], limited: false } }
      : OFF,
    phase2 ? settle(() => readBrandFacts(draft.brand_id, { orgId })) : OFF,
    settle(() => readSiteTrust(draft.brand_id, { refresh: false, keptOnly: false })),
  ]);
  return { links, claims, page, classes, facts, siteTrust };
}
