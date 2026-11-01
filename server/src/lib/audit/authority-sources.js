/**
 * The sites a link to counts as an authority source (customer priorities
 * item 6): Site Audit's "Outbound authority links". One list, shown as it is
 * in the report's "What counts" (web audit-report), and as wide as the
 * Citations "Institutional" category (web lib/citations/classify.ts): a
 * government or academic site in any country's form, an international body,
 * a reference or research site, or major news.
 */

/**
 * Government, academic and military sites: .gov, .edu, .mil and their
 * country forms (.gov.tr, .edu.au, gov.uk itself), and .ac.xx (.ac.uk). A
 * country's form is two letters: example.gov.com is a company's.
 */
const OFFICIAL_PATTERNS = [/(^|\.)(edu|gov|mil)(\.[a-z]{2})?$/, /(^|\.)ac\.[a-z]{2}$/];

/** International bodies: any .int (who.int, wipo.int…) and these. */
const INTERNATIONAL_DOMAINS = [
  'europa.eu',
  'un.org',
  'unesco.org',
  'unicef.org',
  'undp.org',
  'unhcr.org',
  'fao.org',
  'ilo.org',
  'wto.org',
  'oecd.org',
  'worldbank.org',
  'imf.org',
];

/** Reference and research sites, as the Content Editor's primary sources read them. */
const RESEARCH_DOMAINS = [
  'wikipedia.org',
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

/** Major news. */
const NEWS_DOMAINS = [
  'reuters.com',
  'bloomberg.com',
  'ft.com',
  'bbc.com',
  'bbc.co.uk',
  'nytimes.com',
  'washingtonpost.com',
];

/** The kinds a host counts as, in the order the report lists them. */
export const AUTHORITY_KINDS = ['official', 'international', 'research', 'news'];

const onOrUnder = (host, domains) =>
  domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

/**
 * What a link's host counts as, or null when it doesn't count. The host is
 * read without its www. and in lower case.
 */
export function authorityKind(host) {
  const h = String(host ?? '')
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  if (!h) return null;
  if (OFFICIAL_PATTERNS.some((re) => re.test(h))) return 'official';
  if (h.endsWith('.int') || onOrUnder(h, INTERNATIONAL_DOMAINS)) return 'international';
  if (onOrUnder(h, RESEARCH_DOMAINS)) return 'research';
  if (onOrUnder(h, NEWS_DOMAINS)) return 'news';
  return null;
}
