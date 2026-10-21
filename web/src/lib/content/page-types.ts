import type { Industry } from '@/types';
import type { PageType } from './drafts';
import { jsonLdScripts } from './html-allowlist';

/**
 * Page types by kind of site, and a page's type found from the page itself
 * (Content Editor CE-023, spec §4). A B2B SaaS site writes feature,
 * comparison and pricing pages; a shop, product and category pages; a B2C
 * site, destination and help pages. The brand's site type is set in its
 * settings (brands.site_type, 00205), guessed until someone does.
 */

export const SITE_TYPES = ['b2b', 'ecommerce', 'b2c'] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export function isSiteType(value: unknown): value is SiteType {
  return typeof value === 'string' && (SITE_TYPES as readonly string[]).includes(value);
}

/** The page types each kind of site writes, in the order the editor offers them. */
export const SITE_PAGE_TYPES: Record<SiteType, readonly PageType[]> = {
  b2b: [
    'feature_page',
    'solution_page',
    'comparison',
    'integration',
    'pricing',
    'guide',
    'blog_post',
    'docs_faq',
  ],
  ecommerce: ['product_page', 'category_page', 'buying_guide', 'best_of', 'policy', 'blog_post'],
  b2c: ['destination_page', 'itinerary', 'guide', 'best_of', 'help_faq', 'blog_post'],
};

/**
 * Industries that point away from B2B. B2C's page types are a travel site's
 * (destinations, itineraries), so only travel guesses B2C; shops and makers
 * of things sold online guess e-commerce; the rest (software, finance,
 * education…) write feature, pricing and FAQ pages, and guess B2B.
 */
const INDUSTRY_SITE_TYPES: Partial<Record<Industry, SiteType>> = {
  'E-commerce & Retail': 'ecommerce',
  'Fashion & Apparel': 'ecommerce',
  'Consumer Goods': 'ecommerce',
  'Food & Beverage': 'ecommerce',
  Automotive: 'ecommerce',
  'Travel & Hospitality': 'b2c',
};

interface BrandSite {
  siteType?: string | null;
  industry?: string | null;
  shoppingModeEnabled?: boolean;
}

/**
 * A brand's site type before anyone picks one: a shop when Shopping mode is
 * on, else by industry, and B2B when nothing says otherwise.
 */
export function guessSiteType(brand: BrandSite): SiteType {
  if (brand.shoppingModeEnabled) return 'ecommerce';
  return INDUSTRY_SITE_TYPES[brand.industry as Industry] ?? 'b2b';
}

/** The site type the brand chose, or the guess. */
export function siteTypeOf(brand: BrandSite): SiteType {
  return isSiteType(brand.siteType) ? brand.siteType : guessSiteType(brand);
}

/** What a sign means on each kind of site; a site it leaves out skips the sign. */
type BySite = Partial<Record<SiteType, PageType>>;

const ANY_SITE = (type: PageType): BySite => ({ b2b: type, ecommerce: type, b2c: type });
const COMPARISON: BySite = { b2b: 'comparison', ecommerce: 'best_of', b2c: 'best_of' };
const HELP: BySite = { b2b: 'docs_faq', ecommerce: 'policy', b2c: 'help_faq' };
const GUIDE: BySite = { b2b: 'guide', ecommerce: 'buying_guide', b2c: 'guide' };

/**
 * URL paths, the most specific first: /blog/hubspot-vs-salesforce is a
 * comparison before it is a blog post. Matched on the lowercased path with
 * no trailing slash or file extension.
 */
const PATH_SIGNS: [RegExp, BySite][] = [
  [/\/(pricing|plans|plans-and-pricing)(\/|$)/, { b2b: 'pricing' }],
  [
    /(^|[/-])(vs|versus)([/-]|$)|\/(compare|comparisons?)(\/|$)|[/-]alternatives?([/-]|$)/,
    COMPARISON,
  ],
  [
    /\/(shipping|delivery|returns?|refunds?|exchanges?|warranty|polic(y|ies)|terms|privacy|legal)([/-]|$)/,
    HELP,
  ],
  [/\/(docs|documentation|help|help-center|support|faqs?|knowledge-base|kb)(\/|$)/, HELP],
  [/\/(integrations?|apps|marketplace|connectors?)\//, { b2b: 'integration' }],
  [/\/(buying-guides?|buyers?-guides?|how-to-choose)([/-]|$)/, GUIDE],
  [/\/(the-)?(best(?!-(practices?|time|ways?)([/-]|$))|top-?\d+)([/-]|$)/, COMPARISON],
  [/\/(features?|capabilities|platform)(\/|$)/, { b2b: 'feature_page' }],
  [
    /\/(solutions?|industries|industry|use-cases?|teams)(\/|$)|\/for-[a-z]/,
    { b2b: 'solution_page' },
  ],
  [/\/(products?|p|dp|items?)\/[^/]+/, { b2b: 'feature_page', ecommerce: 'product_page' }],
  [
    /\/(collections?|categor(y|ies)|c|shop|catalog|departments?)(\/|$)/,
    { ecommerce: 'category_page' },
  ],
  [/\/(itinerar(y|ies)|trips?|tours?)(\/|$)|\/\d+-days?-/, { b2c: 'itinerary' }],
  [
    /\/(destinations?|places|cities|regions|countries|locations?|hotels?|resorts?)(\/|$)/,
    { b2c: 'destination_page' },
  ],
  [/\/services?(\/|$)/, { b2b: 'solution_page', b2c: 'destination_page' }],
  [/\/(guides?|how-to|learn|academy|resources|tutorials?)([/-]|$)/, GUIDE],
  [/\/(blog|news|articles?|posts?|insights|stories|magazine|journal)(\/|$)/, ANY_SITE('blog_post')],
];

/** Schema.org types in the page's JSON-LD, the most telling first. */
const SCHEMA_SIGNS: [readonly string[], BySite][] = [
  [
    ['Product', 'ProductGroup', 'IndividualProduct'],
    { b2b: 'feature_page', ecommerce: 'product_page' },
  ],
  [['SoftwareApplication', 'WebApplication', 'MobileApplication'], { b2b: 'feature_page' }],
  [['TouristTrip'], { b2c: 'itinerary' }],
  [
    [
      'TouristDestination',
      'TouristAttraction',
      'City',
      'Place',
      'LodgingBusiness',
      'Hotel',
      'Resort',
    ],
    { b2c: 'destination_page' },
  ],
  [['Service'], { b2b: 'solution_page', b2c: 'destination_page' }],
  [['CollectionPage', 'OfferCatalog'], { ecommerce: 'category_page' }],
  [['HowTo'], GUIDE],
  [['BlogPosting', 'Article', 'NewsArticle', 'TechArticle'], ANY_SITE('blog_post')],
  [['FAQPage'], HELP],
  [['ItemList'], COMPARISON],
];

/** Words in the title, for a page with no telling URL or schema. */
const TITLE_SIGNS: [RegExp, BySite][] = [
  [/\b(vs\.?|versus)\s|\balternatives?\b/i, COMPARISON],
  [/\bpricing\b/i, { b2b: 'pricing' }],
  [/\bpolic(y|ies)\b|\bfaqs?\b|\bfrequently asked\b/i, HELP],
  [/\bbuying guide\b|\bhow to choose\b/i, GUIDE],
  [/^(the\s+)?(\d+\s+)?best\b(?!\s+(time|way|practices?)\b)|\btop\s+\d+\b/i, COMPARISON],
  [/\b\d+[-\s]days?\b|\bitinerar(y|ies)\b/i, { b2c: 'itinerary' }],
  [/\bintegrations?\b|\bintegrates? with\b/i, { b2b: 'integration' }],
  [
    /\bfor\s+(\S+\s+){0,3}(teams|companies|businesses|agencies|startups|enterprises?)\b/i,
    { b2b: 'solution_page' },
  ],
  [/\bhow to\b|\bguide\b|\btutorial\b|\bstep[-\s]by[-\s]step\b/i, GUIDE],
];

export interface PageSigns {
  /** The page's address, or its path on the brand's site. */
  url?: string | null;
  /** Its title or first heading. */
  title?: string | null;
  /** Its HTML, read for JSON-LD. */
  html?: string | null;
}

/**
 * A page's type on this kind of site, from its URL first, then the schema in
 * its JSON-LD, then its title; null when nothing tells. Only types the site
 * writes come back: a shop's /vs/ page is a best-of, a SaaS site's a
 * comparison.
 */
export function detectPageType(page: PageSigns, siteType: SiteType): PageType | null {
  const path = page.url ? urlPath(page.url) : null;
  const types = page.html ? schemaTypes(page.html) : null;
  const title = page.title?.trim();
  return (
    (path ? firstSign(PATH_SIGNS, siteType, (pattern) => pattern.test(path)) : null) ??
    (types?.size
      ? firstSign(SCHEMA_SIGNS, siteType, (names) => names.some((name) => types.has(name)))
      : null) ??
    (title ? firstSign(TITLE_SIGNS, siteType, (pattern) => pattern.test(title)) : null)
  );
}

function firstSign<T>(
  signs: [T, BySite][],
  siteType: SiteType,
  matches: (sign: T) => boolean,
): PageType | null {
  for (const [sign, bySite] of signs) {
    const type = bySite[siteType];
    if (type && matches(sign)) return type;
  }
  return null;
}

/** "/Blog/Post.html?x=1" → "/blog/post"; null when it isn't a URL or path. */
function urlPath(url: string): string | null {
  try {
    const path = new URL(url.trim(), 'https://site.invalid').pathname
      .toLowerCase()
      .replace(/\.(html?|php|aspx?)$/, '')
      .replace(/\/+$/, '');
    return path || '/';
  } catch {
    return null;
  }
}

/** The @types in a page's JSON-LD, including @graph items and main entities. */
function schemaTypes(html: string): Set<string> {
  const types = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    const type = item['@type'];
    for (const name of Array.isArray(type) ? type : [type]) {
      if (typeof name === 'string') types.add(name.replace(/^https?:\/\/schema\.org\//, ''));
    }
    visit(item['@graph']);
    visit(item.mainEntity);
  };
  for (const { text } of jsonLdScripts(html)) {
    try {
      visit(JSON.parse(text));
    } catch {
      // Not JSON: nothing to read.
    }
  }
  return types;
}
