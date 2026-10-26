import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import { languageCodeOf } from './languages.js';

/**
 * A page's language, as the editor shows it and the CMS send reads it: its
 * Language rule's value while the rule is on — the draft's own rules, or the
 * workspace's My rules for its page type when no one has set rules on the
 * draft — else the brand's. The Content Agent reads a page's attributions in
 * it ("per E-Mail" is no source on a German page of an English brand).
 */

/** Whether a draft's rules are as the editor started them, so My rules stand in for them. */
export function untouchedRules(rules) {
  return (
    !rules ||
    (rules.source == null &&
      !Object.keys(rules.overrides ?? {}).length &&
      !(rules.textRules ?? []).length)
  );
}

/** The language a draft's rules (or a My rules set) name, else the brand's; null for none known. */
export function rulesLanguage(rules, brandLanguage) {
  const rule = rules?.overrides?.language;
  return (
    (rule?.on !== false && languageCodeOf(rule?.value)) || languageCodeOf(brandLanguage) || null
  );
}

/**
 * A draft's language, reading the workspace's My rules for its page type
 * when it has no rules of its own. A failed read leaves the brand's.
 */
export async function draftLanguage(draft, organizationId, brandLanguage) {
  let rules = draft.rules;
  const type = rules?.set ?? draft.page_type;
  if (untouchedRules(rules) && type && organizationId) {
    const { data, error } = await supabaseAdmin
      .from('content_rule_sets')
      .select('overrides')
      .eq('organization_id', organizationId)
      .eq('page_type', type)
      .maybeSingle();
    if (error) logger.warn({ err: error }, '[content-language] My rules not read');
    rules = error ? null : (data ?? null);
  }
  return rulesLanguage(rules, brandLanguage);
}
