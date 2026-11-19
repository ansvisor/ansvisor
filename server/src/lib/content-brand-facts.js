/**
 * The brand's own facts as a source the content writers read (content test
 * 2026-11-19): its approved brand facts (brand-facts.js, CE-047: prices,
 * plans, trial, claims read from its own site). Without them a draft about
 * the brand wrote "see your pricing page" in place of its prices. Given to
 * the brief, the writer and the agent beside Your input, so a figure in them
 * may be written as the brand's.
 */

import supabaseAdmin from '../config/supabase.js';
import { factsForPage, pageNames } from './fact-scope.js';
import { logger } from './logger.js';

/** Facts given at most, and their words: a pricing page's plans fit. */
const MAX_FACTS = 30;
const MAX_DETAIL_CHARS = 4000;

/**
 * The source's words, from the facts' quotes. Pure.
 *
 * @param {{ brandName?: string|null, facts: string[] }} input
 * @returns {{ kind: 'input', ref: 'brand-facts', label: string, detail: string } | null}
 */
export function brandFactsSource({ brandName, facts }) {
  const name = brandName || 'The brand';
  const quotes = [...new Set(facts.map((f) => String(f ?? '').trim()).filter(Boolean))].slice(
    0,
    MAX_FACTS,
  );
  if (quotes.length === 0) return null;
  return {
    kind: 'input',
    ref: 'brand-facts',
    label: 'Brand facts',
    detail:
      `${name}'s own facts, as its site states them: ${quotes.join(' | ')} Write these in the brand's own voice and never as a [bracket].`.slice(
        0,
        MAX_DETAIL_CHARS,
      ),
  };
}

/**
 * The brand facts source for a draft: its approved facts still on the site,
 * brand-wide or scoped to what the page names (00539). Empty when there are
 * none, or when they can't be read (logged: a draft is written without them
 * rather than not at all).
 */
export async function brandFactSources(brand, draft) {
  try {
    const { data, error } = await supabaseAdmin
      .from('brand_facts')
      .select('quote, scope')
      .eq('brand_id', brand.id)
      .eq('status', 'approved')
      .is('gone_at', null);
    if (error) throw error;
    const names = pageNames({
      html: draft?.body_html ?? '',
      title: draft?.title ?? '',
      urls: [draft?.slug, draft?.published_url, draft?.source_url].filter(Boolean),
    });
    const facts = factsForPage(data ?? [], names).map((f) => f.quote);
    const source = brandFactsSource({ brandName: brand.name, facts });
    return source ? [source] : [];
  } catch (err) {
    logger.warn({ err, brandId: brand?.id }, '[content] brand facts not read');
    return [];
  }
}
