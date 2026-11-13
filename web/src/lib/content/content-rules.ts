import { normalizeDomain } from '@/lib/citations/classify';

/**
 * A brand's content rules (brands.content_rules): words and phrases it never
 * uses, and the domains agents may and may not use as link sources. Plain
 * module: shared by the settings action, the card, Chat's instructions and
 * its draft check.
 */

export type ContentRules = {
  bannedPhrases: string[];
  blockedDomains: string[];
  allowedDomains: string[];
  onlyAllowedDomains: boolean;
};

export const NO_CONTENT_RULES: ContentRules = {
  bannedPhrases: [],
  blockedDomains: [],
  allowedDomains: [],
  onlyAllowedDomains: false,
};

export const MAX_RULE_ITEMS = 200;
export const MAX_PHRASE_LENGTH = 100;
const DOMAIN_RE =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export type RulesError = 'invalid' | 'too_many';

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null;

/** A list of domains as the app keeps them (no scheme, www or path), each once; null when one isn't a domain. */
function domainList(v: unknown): string[] | null {
  const list = strings(v);
  if (!list) return null;
  const out = new Set<string>();
  for (const raw of list) {
    if (!raw.trim()) continue;
    const domain = normalizeDomain(raw);
    if (!DOMAIN_RE.test(domain)) return null;
    out.add(domain);
  }
  return [...out];
}

/** The rules a person sent, cleaned and checked; an error otherwise. */
export function cleanContentRules(input: unknown): { rules: ContentRules } | { error: RulesError } {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const phrases = strings(v.bannedPhrases);
  const blocked = domainList(v.blockedDomains);
  const allowed = domainList(v.allowedDomains);
  if (!phrases || !blocked || !allowed || typeof v.onlyAllowedDomains !== 'boolean') {
    return { error: 'invalid' };
  }
  const seen = new Set<string>();
  const bannedPhrases: string[] = [];
  for (const p of phrases) {
    const phrase = p.trim().replace(/\s+/g, ' ');
    if (!phrase || seen.has(phrase.toLowerCase())) continue;
    if (phrase.length > MAX_PHRASE_LENGTH) return { error: 'invalid' };
    seen.add(phrase.toLowerCase());
    bannedPhrases.push(phrase);
  }
  if ([bannedPhrases, blocked, allowed].some((l) => l.length > MAX_RULE_ITEMS)) {
    return { error: 'too_many' };
  }
  return {
    rules: {
      bannedPhrases,
      blockedDomains: blocked,
      allowedDomains: allowed,
      onlyAllowedDomains: v.onlyAllowedDomains,
    },
  };
}

/** What is stored, as rules: anything unreadable is no rules. */
export function contentRulesOf(stored: unknown): ContentRules {
  const cleaned = cleanContentRules({ ...NO_CONTENT_RULES, ...(stored as object) });
  return 'rules' in cleaned ? cleaned.rules : NO_CONTENT_RULES;
}

/** The brand's rules as Chat's instructions say them; '' when it has none. */
export function contentRulesBlock(rules: ContentRules | undefined): string {
  if (!rules) return '';
  const lines: string[] = [];
  if (rules.bannedPhrases.length > 0) {
    lines.push(
      `Banned phrases: never write these in anything for this brand, in any case: ${rules.bannedPhrases.map((p) => `"${p}"`).join(', ')}. A draft that has one is not saved.`,
    );
  }
  if (rules.blockedDomains.length > 0) {
    lines.push(`Blocked sources: never suggest or cite: ${rules.blockedDomains.join(', ')}.`);
  }
  if (rules.allowedDomains.length > 0) {
    lines.push(
      rules.onlyAllowedDomains
        ? `Sources: cite and suggest only these domains and the brand's own site: ${rules.allowedDomains.join(', ')}.`
        : `Preferred sources: prefer these domains: ${rules.allowedDomains.join(', ')}.`,
    );
  }
  return lines.length > 0 ? `This brand's content rules:\n${lines.join('\n')}` : '';
}
