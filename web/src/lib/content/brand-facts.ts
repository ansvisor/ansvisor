/**
 * A brand's facts (Content Editor Quality spec §10, CE-047): its prices and
 * plans, its trial, when it was founded and the claims it makes of itself,
 * read from its own pricing, About and product pages by the API
 * (brand-facts.js), each with its words on the page. A person approves each
 * one in Brand settings › Brand facts; Trust compares a page with the
 * approved ones that are still on the site.
 */

export const FACT_KINDS = ['price', 'trial', 'founded', 'claim'] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export const FACT_SOURCES = ['pricing', 'about', 'product'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];
export type FactStatus = 'pending' | 'approved' | 'rejected';
export type FactPageStatus = 'ok' | 'blocked' | 'not_found' | 'failed' | 'missed';

/** A price as the API reads it from its words. */
export interface PriceValue {
  plan: string;
  amount: number;
  currency: string;
  period: 'month' | 'year' | 'once' | null;
  billed: 'monthly' | 'annually' | null;
  per: 'seat' | null;
}

export type FactValue = PriceValue | { days: number } | { year: number } | Record<string, never>;

export interface BrandFact {
  id: string;
  kind: FactKind;
  value: FactValue;
  /** The page's own words, which hold it. */
  quote: string;
  sourceUrl: string;
  sourceKind: FactSource;
  status: FactStatus;
  reviewedAt: string | null;
  firstSeenAt: string;
  /** No longer on the site: left out of the check. */
  gone: boolean;
  /** The approved fact a pending one would replace ("Was $49"). */
  replaces: { id: string; value: FactValue } | null;
}

export interface BrandFactsRead {
  facts: BrandFact[];
  pages: { kind: FactSource; url: string | null; status: FactPageStatus; checkedAt: string }[];
  checkedAt: string | null;
  /** When the site may be read again. */
  recheckAt: string | null;
  /** The workspace's AI budget is spent: pages not read wait. */
  paused: boolean;
  /** The brand has no domain to read. */
  noDomain: boolean;
}

/** Where a brand's facts are approved: Brand settings › Brand facts. */
export const brandFactsPath = (brandId: string) =>
  `/dashboard/brands/${brandId}/settings?tab=facts`;

export const isPrice = (
  fact: Pick<BrandFact, 'kind' | 'value'>,
): fact is BrandFact & {
  value: PriceValue;
} => fact.kind === 'price';

/**
 * A fact's value as a person reads it: "$49", "€49.99", "14 days", "2015";
 * a claim is its words. Amounts in the currency's own format, the app's
 * English otherwise.
 */
export function factValueText(kind: FactKind, value: FactValue, quote = ''): string {
  if (kind === 'price') {
    const price = value as PriceValue;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: price.currency,
        maximumFractionDigits: Number.isInteger(price.amount) ? 0 : 2,
      }).format(price.amount);
    } catch {
      return `${price.amount} ${price.currency}`;
    }
  }
  if (kind === 'trial') return String((value as { days: number }).days);
  if (kind === 'founded') return String((value as { year: number }).year);
  return quote;
}
