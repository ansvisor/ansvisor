import type { ContentAuthor } from './authors';
import { authorProfile, scoreGain, type EeatCheckId, type Score } from './quality-checks';

/**
 * Your to-dos (Content Editor Quality spec §4, CE-040): what only the person
 * can do for the page, read from the check results (nothing entered by
 * hand). Everything else is a suggestion the agent can fix. Phase 1's are
 * the placeholders the agent left where it had no real name, quote or
 * number (CE-044), and the author's: the Content Agent can't add, pick or
 * edit authors.
 */

export type QualityTodoId = 'placeholders' | 'byline' | 'authorProfile';

/**
 * A to-do's one button: Show (the first placeholder, selected to type over),
 * the header's author menu, or Settings › Authors.
 */
export type QualityTodoAction = 'showPlaceholder' | 'pickAuthor' | 'addAuthor' | 'editAuthor';

export interface QualityTodo {
  id: QualityTodoId;
  done: boolean;
  /** What E-E-A-T gains once it is done; 0 when done, or when no score counts it. */
  gain: number;
  /** None while it waits on the one before it. */
  action: QualityTodoAction | null;
  /** How many it is about (placeholders). */
  count?: number;
}

/**
 * The page's to-dos, in the order to do them: fill the placeholders (an
 * export never ships one), pick its author (or add one when the workspace
 * has none), then complete their profile, listed from the start so the
 * count holds. Done ones stay on the list, checked; placeholders are listed
 * once the page has had some (`had`, this session). The author's wait for
 * E-E-A-T to be read.
 */
export function qualityTodos({
  eeat,
  author,
  hasAuthors,
  placeholders = { count: 0, had: false },
  canEdit = false,
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
}): QualityTodo[] {
  const fill: QualityTodo[] =
    placeholders.count || placeholders.had
      ? [
          {
            id: 'placeholders',
            done: placeholders.count === 0,
            gain: 0,
            action: 'showPlaceholder',
            count: placeholders.count,
          },
        ]
      : [];
  if (!eeat || eeat.score === null) return fill;
  const byline: QualityTodo = {
    id: 'byline',
    done: !!author,
    gain: scoreGain(eeat, ['byline']),
    action: author || hasAuthors ? 'pickAuthor' : 'addAuthor',
  };
  const { bio, links } = authorProfile(author);
  return [
    ...fill,
    byline,
    {
      id: 'authorProfile',
      done: !!author && bio && links,
      gain: scoreGain(eeat, ['authorBio']),
      action: author && canEdit ? 'editAuthor' : null,
    },
  ];
}
