import supabaseAdmin from '../config/supabase.js';
import { ownDomainMatcher } from './response-parser.js';

/**
 * A brand's source rules (brands.content_rules): domains never suggested as
 * link sources or cited, and the allowed ones. The web app validates what it
 * saves; this reads it defensively.
 */

export const NO_RULES = { blockedDomains: [], allowedDomains: [], onlyAllowedDomains: false };

const list = (value) =>
  Array.isArray(value) ? value.filter((d) => typeof d === 'string' && d.trim()) : [];

/** The stored value as rules; anything unreadable is no rules. Pure. */
export function sourceRulesOf(value) {
  if (!value || typeof value !== 'object') return NO_RULES;
  return {
    blockedDomains: list(value.blockedDomains),
    allowedDomains: list(value.allowedDomains),
    onlyAllowedDomains: value.onlyAllowedDomains === true,
  };
}

/** The brand's source rules; no rules when unset or unreadable (a failed read never blocks a run). */
export async function readSourceRules(brandId) {
  try {
    const { data } = await supabaseAdmin
      .from('brands')
      .select('content_rules')
      .eq('id', brandId)
      .maybeSingle();
    return sourceRulesOf(data?.content_rules);
  } catch {
    return NO_RULES;
  }
}

/**
 * Whether a source may be suggested or cited: never a blocked domain (its
 * subdomains too); with "only these" on, only an allowed domain or the
 * brand's own. Same host rule as the own-domain match. Pure.
 */
export function sourceAllowed(rules, ownDomains = []) {
  const blocked = ownDomainMatcher(rules.blockedDomains);
  const only = rules.onlyAllowedDomains
    ? ownDomainMatcher([...rules.allowedDomains, ...ownDomains])
    : null;
  return (url) => !blocked(url) && (only ? only(url) : true);
}

/** In "prefer" mode (the switch off): the allowed domains to name to the agent; none when "only" is on. */
export const preferredDomains = (rules) => (rules.onlyAllowedDomains ? [] : rules.allowedDomains);
