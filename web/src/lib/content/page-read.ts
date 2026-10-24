import { cleanHref } from './html-allowlist';
import { sentencesOf } from './readability';
import { squeeze, type TrustBlock } from './quality-checks';

/**
 * A page's read for proof (Content Editor Quality spec §4b, CE-049), as the
 * API's page read gives it (content-quality-page.js): visual proof spots —
 * one specific image the business can take itself, for a passage — and
 * proof asks — the page's own claims whose proof only the business has,
 * each with the kind of proof it needs. Each names its block by its words
 * as Trust's blocks have them.
 */

export const PROOF_KINDS = [
  'award',
  'certification',
  'research',
  'rating',
  'ranking',
  'number',
  'test',
  'customer_case',
  'unknown',
] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

export interface ProofSpot {
  /** The words the image supports, as the page has them. */
  passage: string;
  /** Its block's words (trustBlocks). */
  block: string;
  /** What the image shows. */
  image: string;
  /** Its alt text, drafted from the passage. */
  alt: string;
}

export interface ProofAsk {
  /** The claim's words, as the page has them. */
  claim: string;
  block: string;
  kind: ProofKind;
}

export interface PageRead {
  spots: ProofSpot[];
  proofs: ProofAsk[];
  regulated: 'health' | 'finance' | 'legal' | null;
}

/** The proof to-dos open at once at most: the page's first claims. */
export const MAX_PROOF_TODOS = 5;

/** A proof ask on the page as it is: its sentence, and whether its block links out. */
export interface PageProof extends ProofAsk {
  sentence: string;
  linked: boolean;
}

/**
 * The page's proof asks as the page is now, in its order (a block's by
 * where its claim is): each whose block is still there, with the sentence
 * that holds its claim and whether the block links out (an http(s) link,
 * as Trust reads it: its proof, on the brand's site or another). Blocks
 * and claims are matched by their words without spaces: a link put on a
 * claim adds one at its edge ("ISO 27001 -certified"). Its to-do's key
 * reads the block without spaces (proofKey), so it stays as the block's
 * spacing changes.
 */
export function proofsOnPage(blocks: TrustBlock[], proofs: readonly ProofAsk[]): PageProof[] {
  const seen = new Set<string>();
  return blocks.flatMap((block) => {
    const words = squeeze(block.text);
    return (
      proofs
        .filter((proof) => squeeze(proof.block) === words && words.includes(squeeze(proof.claim)))
        // A block the page has twice: its claims once.
        .filter((proof) => {
          const key = `${proof.claim}\n${proof.block}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => words.indexOf(squeeze(a.claim)) - words.indexOf(squeeze(b.claim)))
        .map((proof) => ({
          ...proof,
          sentence:
            sentencesOf(block.text).find((s) => squeeze(s).includes(squeeze(proof.claim))) ??
            proof.claim,
          linked: block.links.some((href) => /^https?:\/\//i.test(cleanHref(href) ?? '')),
        }))
    );
  });
}

/**
 * The page's images, in its order, each once by its address (an http(s)
 * one, as the page keeps it): what the person may confirm is their own.
 */
export function pageImages(html: string): { src: string; alt: string }[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Set<string>();
  return [...doc.querySelectorAll('img[src]')].flatMap((img) => {
    const src = img.getAttribute('src')!.trim();
    // As the database takes an own image's address (00270): http(s), 8–2048 characters.
    if (!/^https?:\/\//.test(src) || src.length < 8 || src.length > 2048 || seen.has(src)) {
      return [];
    }
    seen.add(src);
    return [{ src, alt: img.getAttribute('alt')?.trim() ?? '' }];
  });
}
