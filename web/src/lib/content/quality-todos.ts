import type { ContentAuthor } from './authors';
import { authorProfile, scoreGain, type EeatCheckId, type Score } from './quality-checks';

/**
 * Your to-dos (Content Editor Quality spec §4, CE-040): what only the person
 * can do for the page, read from the check results (nothing entered by
 * hand). Everything else is a suggestion the agent can fix. Phase 1's are
 * the author's: the Content Agent can't add, pick or edit authors.
 */

export type QualityTodoId = 'byline' | 'authorProfile';

/** A to-do's one button: the header's author menu, or Settings › Authors. */
export type QualityTodoAction = 'pickAuthor' | 'addAuthor' | 'editAuthor';

export interface QualityTodo {
  id: QualityTodoId;
  done: boolean;
  /** What E-E-A-T gains once it is done; 0 when done. */
  gain: number;
  /** None while it waits on the one before it. */
  action: QualityTodoAction | null;
}

/**
 * The page's to-dos, in the order to do them: pick its author (or add one
 * when the workspace has none), then complete their profile, listed from the
 * start so the count holds. Done ones stay on the list, checked. None until
 * E-E-A-T is read.
 */
export function qualityTodos({
  eeat,
  author,
  hasAuthors,
  canEdit = false,
}: {
  eeat: Score<EeatCheckId> | null;
  author: ContentAuthor | null;
  hasAuthors: boolean;
  /**
   * Whether the member may edit the page's author (whoever added them, the
   * author themself or an admin): only they get Edit author; anyone else is
   * told who can.
   */
  canEdit?: boolean;
}): QualityTodo[] {
  if (!eeat || eeat.score === null) return [];
  const byline: QualityTodo = {
    id: 'byline',
    done: !!author,
    gain: scoreGain(eeat, ['byline']),
    action: author || hasAuthors ? 'pickAuthor' : 'addAuthor',
  };
  const { bio, links } = authorProfile(author);
  return [
    byline,
    {
      id: 'authorProfile',
      done: !!author && bio && links,
      gain: scoreGain(eeat, ['authorBio']),
      action: author && canEdit ? 'editAuthor' : null,
    },
  ];
}
