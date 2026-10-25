import type { ContentAuthor } from './authors';
import {
  authorProfile,
  scoreGain,
  type EeatCheckId,
  type Score,
  type TrustCheckId,
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
 * page's). The author's wait for E-E-A-T to be read.
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
  /** Trust, for an expert quote's gain. */
  trust?: Score<TrustCheckId> | null;
  /**
   * Phase 2 (CE-047): the brand's facts read from its site that no one has
   * approved or rejected yet, and whether there were some this session.
   */
  brandFacts?: { pending: number; had: boolean } | null;
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
  if (!eeat || eeat.score === null) return [...fill, ...facts];
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
    ...facts,
  ];
}
