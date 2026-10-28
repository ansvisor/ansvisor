import { categoryWords } from '@/lib/shopping/categories';
import { matchScores, missingWords, queryTerms } from '@/lib/shopping/match-score';
import {
  FIRST_WORDS,
  readiness,
  type CatalogProductRow,
  type ReadinessCheck,
} from '@/lib/shopping/products';

/**
 * A product's page in Product Visibility (ECOM-011): the shopping questions
 * it belongs on, where it stands on each one's latest shelf, and, for the
 * one it's missing most, "Why not your product?": it beside the product AI
 * picked, row by row, from what the catalog and the answers hold.
 */

/** A card of a shopping answer, as the product's page reads it. */
export interface DetailCard {
  promptId: string;
  promptText: string;
  platform: string;
  promptResultId: string;
  at: string;
  position: number;
  title: string;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviews: number | null;
  merchant: string | null;
  image: string | null;
  role: string;
  productId: string | null;
  /** The searches AI ran for the answer (its fan-out). */
  searches: readonly string[];
}

export interface ShelfProduct {
  title: string;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviews: number | null;
  merchant: string | null;
  image: string | null;
}

/** The product on one question's shelf, on one channel. */
export interface ProductShelfLine {
  promptId: string;
  promptText: string;
  platform: string;
  /** Its place on the latest shelf, from 1, or null when it isn't on it. */
  rank: number | null;
  /** The shelf's first product, when it isn't this one. */
  winner: ShelfProduct | null;
  /** Its keyword match with the question and AI's searches, 0–100 (Ansvisor estimate). */
  score: number;
  winnerScore: number | null;
  /** The question's words the product's title and opening don't have. */
  missing: string[];
}

/** A question is the product's at this score or more, when nothing else ties it to it. */
export const RELEVANT_SCORE = 40;
/** Questions a product's page lists at most. */
export const MAX_LINES = 20;

/** What the product says first: its title and its description's opening (ECOM-024). */
export function productText(product: CatalogProductRow): string {
  const opening = String(product.description ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, FIRST_WORDS)
    .join(' ');
  return `${product.title} ${opening}`.trim();
}

/**
 * The product's shelves: the questions of its category (its name in them),
 * those it was on, and those its words match well enough, each channel's
 * latest shelf, most relevant first.
 */
export function productShelves(
  product: CatalogProductRow,
  cards: readonly DetailCard[],
): ProductShelfLine[] {
  const category = product.category ? categoryWords(product.category.split('>').at(-1)!) : [];
  const text = productText(product);
  const shelves = new Map<string, DetailCard[]>();
  for (const card of cards) {
    const key = `${card.promptId}:${card.platform}`;
    if (!shelves.has(key)) shelves.set(key, []);
    shelves.get(key)!.push(card);
  }
  const lines: ProductShelfLine[] = [];
  for (const shelf of shelves.values()) {
    const first = shelf[0];
    const latestRun = shelf.reduce((a, b) => (b.at > a.at ? b : a)).promptResultId;
    const latest = shelf
      .filter((card) => card.promptResultId === latestRun)
      .sort((a, b) => a.position - b.position);
    const terms = queryTerms(first.promptText, [...new Set(shelf.flatMap((c) => c.searches))]);
    const others = latest.filter((card) => card.productId !== product.id);
    const scores = matchScores(terms, [text, ...others.map((card) => card.title)]);
    const at = latest.findIndex((card) => card.productId === product.id);
    const appeared = shelf.some((card) => card.productId === product.id);
    const promptWords = new Set(categoryWords(first.promptText));
    const inCategory = category.length > 0 && category.every((word) => promptWords.has(word));
    if (!appeared && !inCategory && scores[0] < RELEVANT_SCORE) continue;
    const winnerCard = at === 0 ? null : latest[0];
    lines.push({
      promptId: first.promptId,
      promptText: first.promptText,
      platform: first.platform,
      rank: at >= 0 ? at + 1 : null,
      winner: winnerCard
        ? {
            title: winnerCard.title,
            price: winnerCard.price,
            currency: winnerCard.currency,
            rating: winnerCard.rating,
            reviews: winnerCard.reviews,
            merchant: winnerCard.merchant,
            image: winnerCard.image,
          }
        : null,
      score: scores[0],
      winnerScore: winnerCard ? (scores[1 + others.indexOf(winnerCard)] ?? null) : null,
      missing: missingWords(terms, text),
    });
  }
  return lines
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
        a.promptText.localeCompare(b.promptText),
    )
    .slice(0, MAX_LINES);
}

/** The shelf to explain: the most relevant one it's missing, else the one it ranks lowest on. */
export function focusShelf(lines: readonly ProductShelfLine[]): ProductShelfLine | null {
  const missing = lines.filter((line) => line.rank === null && line.winner);
  if (missing.length) return missing[0];
  const behind = lines
    .filter((line) => line.rank !== null && line.rank > 1 && line.winner)
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  return behind[0] ?? null;
}

/** ✓ the product matches, ✕ it's missing it, ↓ it's weaker, or just what each has. */
export type ComparisonState = 'match' | 'missing' | 'weaker' | 'info';

export interface ComparisonRow {
  key: 'score' | 'price' | 'rating' | 'firstWords' | 'gtin' | 'photo' | 'stock' | 'merchant';
  you: string | null;
  winner: string | null;
  state: ComparisonState;
  /** Values for the row's note (en.json shopping.detail.notes). */
  note?: { key: string; values?: Record<string, string | number> };
}

/** Prices this close are "close" (ECOM-011's "Close"). */
const CLOSE_PRICE = 0.1;

/**
 * "Why not your product?": the product beside the shelf's winner, row by
 * row. `own` is how the answers showed the product, for its rating; `price`
 * formats a price as the page does.
 */
export function comparison(
  product: CatalogProductRow,
  line: ProductShelfLine,
  {
    own,
    price,
    storeDomain,
  }: {
    own: { rating: number | null; reviews: number | null } | null;
    price: (value: number, currency: string | null) => string;
    storeDomain: string | null;
  },
): ComparisonRow[] {
  const winner = line.winner;
  const rows: ComparisonRow[] = [];
  rows.push({
    key: 'score',
    you: String(line.score),
    winner: line.winnerScore === null ? null : String(line.winnerScore),
    state:
      line.winnerScore !== null && line.score < line.winnerScore
        ? line.score < line.winnerScore / 2
          ? 'missing'
          : 'weaker'
        : 'match',
    note: line.missing.length
      ? { key: 'missingWords', values: { words: line.missing.slice(0, 6).join(', ') } }
      : undefined,
  });
  if (product.price !== null || winner?.price !== null) {
    const you = product.price;
    const them = winner?.price ?? null;
    const gap = you !== null && them !== null && them > 0 ? (you - them) / them : null;
    rows.push({
      key: 'price',
      you: you === null ? null : price(you, product.currency),
      winner: them === null ? null : price(them, winner?.currency ?? null),
      state: gap === null ? 'info' : gap > CLOSE_PRICE ? 'weaker' : 'match',
      note:
        gap === null
          ? undefined
          : Math.abs(gap) <= CLOSE_PRICE
            ? { key: 'close' }
            : gap > 0
              ? { key: 'higher', values: { percent: Math.round(gap * 100) } }
              : { key: 'lower', values: { percent: Math.round(-gap * 100) } },
    });
  }
  const rating = (r: number | null, n: number | null) =>
    r === null ? null : n ? `${r.toFixed(1)} · ${n.toLocaleString('en-US')}` : r.toFixed(1);
  rows.push({
    key: 'rating',
    you: rating(own?.rating ?? null, own?.reviews ?? null),
    winner: rating(winner?.rating ?? null, winner?.reviews ?? null),
    state:
      own?.rating === null || own?.rating === undefined
        ? winner?.rating
          ? 'missing'
          : 'info'
        : winner?.rating && own.rating < winner.rating
          ? 'weaker'
          : 'match',
  });
  const ready = readiness(product);
  const has = (check: ReadinessCheck) => !ready.missing.includes(check);
  rows.push({
    key: 'firstWords',
    you: null,
    winner: null,
    state: has('typeFirst') ? 'match' : 'missing',
    note: { key: 'firstWords' },
  });
  rows.push({ key: 'gtin', you: null, winner: null, state: has('gtin') ? 'match' : 'missing' });
  rows.push({ key: 'photo', you: null, winner: null, state: has('image') ? 'match' : 'missing' });
  rows.push({ key: 'stock', you: null, winner: null, state: has('inStock') ? 'match' : 'missing' });
  if (winner?.merchant) {
    rows.push({
      key: 'merchant',
      you: storeDomain,
      winner: winner.merchant,
      state: 'info',
    });
  }
  return rows;
}
