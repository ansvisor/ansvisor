/**
 * The brand's own facts as a source the content writers read (content test
 * 2026-11-19): its approved brand facts (brand-facts.js, CE-047: prices,
 * plans, trial, claims read from its own site) and the AI engines it tracks
 * now. Without them a draft about the brand wrote "[AI engines Ansvisor
 * tracks]" and "see your pricing page", and kept old claims of engines the
 * brand had paused. Given to the brief, the writer and the agent beside
 * Your input, so a figure in them may be written as the brand's.
 */

import supabaseAdmin from '../config/supabase.js';
import { factsForPage, pageNames } from './fact-scope.js';
import { IMPROVE_PLATFORM_LABELS } from './prompt-improve.js';
import { logger } from './logger.js';

/** Facts given at most, and their words: a pricing page's plans fit. */
const MAX_FACTS = 30;
const MAX_DETAIL_CHARS = 4000;

/** The engines the brand's active prompts are tracked on, by name, in the labels' order. */
export async function trackedEngines(brandId) {
  const { data: sets, error } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  if (error) throw error;
  const ids = (sets ?? []).map((s) => s.id);
  if (ids.length === 0) return [];
  const { data: prompts, error: promptsError } = await supabaseAdmin
    .from('prompts')
    .select('platforms')
    .in('prompt_set_id', ids)
    .eq('is_active', true)
    .limit(1000);
  if (promptsError) throw promptsError;
  const platforms = new Set((prompts ?? []).flatMap((p) => p.platforms ?? []));
  return Object.entries(IMPROVE_PLATFORM_LABELS)
    .filter(([id]) => platforms.has(id))
    .map(([, name]) => name);
}

/**
 * The source's words, from the facts' quotes and the engines. Pure.
 *
 * @param {{ brandName?: string|null, facts: string[], engines: string[] }} input
 * @returns {{ kind: 'input', ref: 'brand-facts', label: string, detail: string } | null}
 */
export function brandFactsSource({ brandName, facts, engines }) {
  const name = brandName || 'The brand';
  const parts = [];
  const quotes = [...new Set(facts.map((f) => String(f ?? '').trim()).filter(Boolean))].slice(
    0,
    MAX_FACTS,
  );
  if (quotes.length) {
    parts.push(`${name}'s own facts, as its site states them: ${quotes.join(' | ')}`);
  }
  if (engines.length) {
    const others = Object.values(IMPROVE_PLATFORM_LABELS).filter((n) => !engines.includes(n));
    parts.push(
      `The AI engines ${name} tracks now: ${engines.join(', ')}.` +
        (others.length
          ? ` It doesn't track ${others.join(', ')}: never say it does, and correct a page that says so.`
          : ''),
    );
  }
  if (parts.length === 0) return null;
  return {
    kind: 'input',
    ref: 'brand-facts',
    label: 'Brand facts',
    detail:
      `${parts.join(' ')} Write these in the brand's own voice and never as a [bracket].`.slice(
        0,
        MAX_DETAIL_CHARS,
      ),
  };
}

/**
 * The brand facts source for a draft: its approved facts still on the site,
 * brand-wide or scoped to what the page names (00539), and its tracked
 * engines. Empty when there are none, or when they can't be read (logged:
 * a draft is written without them rather than not at all).
 */
export async function brandFactSources(brand, draft) {
  try {
    const [{ data, error }, engines] = await Promise.all([
      supabaseAdmin
        .from('brand_facts')
        .select('quote, scope')
        .eq('brand_id', brand.id)
        .eq('status', 'approved')
        .is('gone_at', null),
      trackedEngines(brand.id),
    ]);
    if (error) throw error;
    const names = pageNames({
      html: draft?.body_html ?? '',
      title: draft?.title ?? '',
      urls: [draft?.slug, draft?.published_url, draft?.source_url].filter(Boolean),
    });
    const facts = factsForPage(data ?? [], names).map((f) => f.quote);
    const source = brandFactsSource({ brandName: brand.name, facts, engines });
    return source ? [source] : [];
  } catch (err) {
    logger.warn({ err, brandId: brand?.id }, '[content] brand facts not read');
    return [];
  }
}
