import { classifyDomain, normalizeDomain } from '@/lib/citations/classify';

/**
 * What kind of source a page's link is (Quality spec CE-046, Trust §2.2):
 * primary (official, research, standards), secondary (news and magazines,
 * review sites), weak (forums and social posts), a competitor's page, or the
 * brand's own. Read from the address alone, by the citations' categories
 * (classifyDomain) and a short list of research and standards sites; an
 * address the rules can't place is left out (null), so it neither raises
 * nor lowers Trust.
 */

export type SourceClass = 'primary' | 'secondary' | 'weak' | 'competitor' | 'own';

/** Research, journals and standards bodies: primary wherever they're cited. */
const RESEARCH_DOMAINS = [
  'doi.org',
  'arxiv.org',
  'nature.com',
  'science.org',
  'sciencedirect.com',
  'springer.com',
  'wiley.com',
  'ieee.org',
  'acm.org',
  'jstor.org',
  'ssrn.com',
  'plos.org',
  'thelancet.com',
  'bmj.com',
  'nejm.org',
  'w3.org',
  'ietf.org',
  'rfc-editor.org',
  'iso.org',
  'whatwg.org',
];

/**
 * Sites the citations' categories call institutional whose pages anyone
 * writes or uploads: an encyclopedia anyone edits reads as secondary, a
 * site of uploaded papers as weak.
 */
const SECONDARY_DOMAINS = ['wikipedia.org'];
const WEAK_DOMAINS = ['academia.edu'];

/**
 * Pages that compare: a link to a competitor's own page (its pricing, its
 * docs) is where its facts come from (spec §11), so it counts as primary.
 */
const COMPARING = new Set(['comparison', 'alternatives', 'best_of']);

const onList = (host: string, list: string[]) =>
  list.some((entry) => host === entry || host.endsWith(`.${entry}`));

export function sourceClass(
  url: string,
  {
    brandDomains,
    competitorDomains,
    pageType,
  }: { brandDomains: string[]; competitorDomains: string[]; pageType: string | null },
): SourceClass | null {
  const host = normalizeDomain(url);
  if (!host) return null;
  if (onList(host, SECONDARY_DOMAINS)) return 'secondary';
  if (onList(host, WEAK_DOMAINS)) return 'weak';
  const kind = classifyDomain(host, {
    brandDomains: brandDomains.map(normalizeDomain).filter(Boolean),
    competitorDomains: competitorDomains.map(normalizeDomain).filter(Boolean),
  });
  switch (kind) {
    case 'you':
      return 'own';
    case 'competitor':
      return pageType && COMPARING.has(pageType) ? 'primary' : 'competitor';
    case 'institutional':
      return 'primary';
    case 'editorial':
    case 'review':
      return 'secondary';
    case 'forum':
    case 'social':
      return 'weak';
    default:
      return onList(host, RESEARCH_DOMAINS) ? 'primary' : null;
  }
}
