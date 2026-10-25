import type { ContentAuthor } from './authors';
import { MAX_PROOF_TODOS, type PageProof, type ProofKind } from './page-read';
import {
  authorProfile,
  scoreGain,
  sentenceGain,
  type EeatCheckId,
  type Score,
  type TrustCheckId,
  type TrustRead,
  squeeze,
} from './quality-checks';

/**
 * Your to-dos (Content Editor Quality spec §4, CE-040): what only the person
 * can do for the page, read from the check results (nothing entered by
 * hand). Everything else is a suggestion the agent can fix. Phase 1's are
 * the placeholders the agent left where it had no real name, quote or
 * number (CE-044), and the author's: the Content Agent can't add, pick or
 * edit authors. Phase 2 adds what only the person can give (Brief › Your
 * input, CE-048): their experience, their data and an expert's quote; and
 * the brand's facts read from its site, to approve (CE-047).
 */

export type QualityTodoId =
  | 'placeholders'
  | 'byline'
  | 'authorProfile'
  | 'experience'
  | 'originalData'
  | 'expertQuote'
  | 'proof'
  | 'brandFacts';

/**
 * A to-do's one button: Show (the first placeholder, selected to type over),
 * the header's author menu, Settings › Authors, Brief › Your input, or
 * Brand settings › Brand facts.
 */
export type QualityTodoAction =
  | 'showPlaceholder'
  | 'pickAuthor'
  | 'addAuthor'
  | 'editAuthor'
  | 'addInput'
  | 'addProof'
  | 'reviewBrandFacts';

export interface QualityTodo {
  id: QualityTodoId;
  done: boolean;
  /** What its score gains once it is done; 0 when done, or when no score counts it. */
  gain: number;
  /** The score it raises: E-E-A-T, or Trust for an expert's quote. */
  score: 'eeat' | 'trust';
  /** None while it waits on the one before it. */
  action: QualityTodoAction | null;
  /** Given in Brief › Your input, though the page doesn't use it yet (CE-048). */
  given?: boolean;
  /** Its own key when it has more than one row (each proof's). */
  key?: string;
  /** The claim a proof to-do asks proof for (CE-049). */
  proof?: { claim: string; block: string; kind: ProofKind; sentence: string };
  /** How many it is about (placeholders, brand facts to approve). */
  count?: number;
  /**
   * With no author picked: the person's own word for the author their site
   * names (00271), a tick box beside the to-do, and whether it's ticked.
   */
  confirm?: { what: 'real' | 'profile'; on: boolean };
}

/**
 * The page's to-dos, in the order to do them: fill the placeholders (an
 * export never ships one), pick its author (or add one when the workspace
 * has none), then complete their profile, listed from the start so the
 * count holds. Done ones stay on the list, checked; placeholders are listed
 * once the page has had some (`had`, this session), the brand facts to
 * approve likewise, last (Phase 2: the brand's, worth no points of the
 * page's). The proof of the page's own claims comes after the person's
 * input (Phase 2, CE-049). The author's wait for E-E-A-T to be read.
 */
export function qualityTodos({
  eeat,
  author,
  hasAuthors,
  placeholders = { count: 0, had: false },
  canEdit = false,
  used = null,
  given = null,
  trust = null,
  brandFacts = null,
  proofs = null,
  confirmed = null,
}: {
  eeat: Score<EeatCheckId> | null;
  author: ContentAuthor | null;
  hasAuthors: boolean;
  placeholders?: { count: number; had: boolean };
  /**
   * Whether the member may edit the page's author (whoever added them, the
   * author themself or an admin): only they get Edit author; anyone else is
   * told who can.
   */
  canEdit?: boolean;
  /** Phase 2 (CE-048): what the page uses of Brief › Your input; left out before. */
  used?: { experience: boolean; data: boolean; quote: boolean } | null;
  /** What the person gave there (inputsGiven), used or not. */
  given?: { experience: boolean; data: boolean; quote: boolean } | null;
  /** Trust, for an expert quote's gain and a proof's (its unsourced sentences). */
  trust?: (Score<TrustCheckId> & Partial<Pick<TrustRead, 'unsourced' | 'figures'>>) | null;
  /**
   * Phase 2 (CE-047): the brand's facts read from its site that no one has
   * approved or rejected yet, and whether there were some this session.
   */
  brandFacts?: { pending: number; had: boolean } | null;
  /**
   * Phase 2 (CE-049): the page's own claims that need the brand's proof, as
   * the page is now (proofsOnPage), and the keys of the ones asked for this
   * session: done ones stay listed, checked.
   */
  proofs?: { asks: readonly PageProof[]; had: ReadonlySet<string> } | null;
  /** What the person confirmed of the author their site names (00271), or null where they can't. */
  confirmed?: { real: boolean; profile: boolean } | null;
}): QualityTodo[] {
  const fill: QualityTodo[] =
    placeholders.count || placeholders.had
      ? [
          {
            id: 'placeholders',
            done: placeholders.count === 0,
            gain: 0,
            score: 'eeat',
            action: 'showPlaceholder',
            count: placeholders.count,
          },
        ]
      : [];
  // The brand's, not the page's, and worth no points itself: last.
  const facts: QualityTodo[] =
    brandFacts && (brandFacts.pending || brandFacts.had)
      ? [
          {
            id: 'brandFacts',
            done: brandFacts.pending === 0,
            gain: 0,
            score: 'trust',
            action: 'reviewBrandFacts',
            count: brandFacts.pending,
          },
        ]
      : [];
  // The page's own claims, in its order: open while its paragraph has no
  // link, checked once it has; MAX_PROOF_TODOS open at once.
  let open = 0;
  const proofTodos: QualityTodo[] = (proofs?.asks ?? []).flatMap((ask) => {
    const key = proofKey(ask);
    if (ask.linked && !proofs?.had.has(key)) return [];
    if (!ask.linked && (open += 1) > MAX_PROOF_TODOS) return [];
    return [
      {
        id: 'proof',
        key,
        done: ask.linked,
        gain: ask.linked ? 0 : sentenceGain(trust, ask.sentence),
        score: 'trust',
        action: 'addProof',
        proof: { claim: ask.claim, block: ask.block, kind: ask.kind, sentence: ask.sentence },
      } satisfies QualityTodo,
    ];
  });
  if (!eeat || eeat.score === null) return [...fill, ...proofTodos, ...facts];
  // No author picked: the one the site names may be confirmed instead, the
  // profile once the author is.
  const byConfirm = !author && !!confirmed;
  const byline: QualityTodo = {
    id: 'byline',
    done: !!author || (byConfirm && confirmed.real),
    gain: scoreGain(eeat, ['byline']),
    score: 'eeat',
    action: author || hasAuthors ? 'pickAuthor' : 'addAuthor',
    ...(byConfirm ? { confirm: { what: 'real' as const, on: confirmed.real } } : {}),
  };
  const { bio, links } = authorProfile(author);
  return [
    ...fill,
    byline,
    {
      id: 'authorProfile',
      done: (!!author && bio && links) || (byConfirm && confirmed.real && confirmed.profile),
      gain: scoreGain(eeat, ['authorBio']),
      score: 'eeat',
      action: author && canEdit ? 'editAuthor' : null,
      ...(byConfirm && confirmed.real
        ? { confirm: { what: 'profile' as const, on: confirmed.profile } }
        : {}),
    },
    ...(used
      ? ([
          {
            id: 'experience',
            done: used.experience,
            given: !used.experience && !!given?.experience,
            gain: scoreGain(eeat, ['experience']),
            score: 'eeat',
            action: 'addInput',
          },
          {
            id: 'originalData',
            done: used.data,
            given: !used.data && !!given?.data,
            gain: scoreGain(eeat, ['originalData']),
            score: 'eeat',
            action: 'addInput',
          },
          {
            id: 'expertQuote',
            done: used.quote,
            given: !used.quote && !!given?.quote,
            gain:
              !used.quote && trust && trust.score !== null ? scoreGain(trust, ['expertQuote']) : 0,
            score: 'trust',
            action: 'addInput',
          },
        ] satisfies QualityTodo[])
      : []),
    ...proofTodos,
    ...facts,
  ];
}

/** A text's 32-bit FNV-1a hash, in base 36: a short, stable name for it. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * A proof to-do's key: its claim in its block, both by their words without
 * spaces, the block by a short hash (the nudge keeps the keys it showed). A
 * link put on the claim adds a space at its edge, and the API's next answer
 * carries the claim and its block as the page has them then: the key stays.
 */
export const proofKey = (ask: { claim: string; block: string }) =>
  `proof:${squeeze(ask.claim)}:${shortHash(squeeze(ask.block))}`;
