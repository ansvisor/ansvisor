import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import { eeat } from './quality-checks';
import { qualityTodos } from './quality-todos';

/** Your to-dos (Quality spec §4, CE-040): only what the person can do, read from the checks. */

const author = (over: Partial<ContentAuthor> = {}): ContentAuthor => ({
  id: 'a1',
  name: 'Ada Lovelace',
  title: null,
  bio: 'Writes about forecasting.',
  photoUrl: null,
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
  ...over,
});
const todos = (a: ContentAuthor | null, hasAuthors = true, canEdit = true) =>
  qualityTodos({ eeat: eeat({ author: a }), author: a, hasAuthors, canEdit });

describe('qualityTodos', () => {
  it("asks to pick the page's author, with the byline's gain, and lists the profile after it", () => {
    expect(todos(null)).toEqual([
      { id: 'byline', done: false, gain: 60, action: 'pickAuthor' },
      { id: 'authorProfile', done: false, gain: 40, action: null },
    ]);
  });

  it('asks to add an author when the workspace has none', () => {
    expect(todos(null, false)[0]).toEqual({
      id: 'byline',
      done: false,
      gain: 60,
      action: 'addAuthor',
    });
  });

  it("keeps the byline done, then asks to complete the author's profile", () => {
    expect(todos(author({ bio: null, sameAs: [] }))).toEqual([
      { id: 'byline', done: true, gain: 0, action: 'pickAuthor' },
      { id: 'authorProfile', done: false, gain: 40, action: 'editAuthor' },
    ]);
    expect(todos(author({ sameAs: [] }))[1]).toEqual({
      id: 'authorProfile',
      done: false,
      gain: 20,
      action: 'editAuthor',
    });
  });

  it('checks both off for an author with a bio and profile links', () => {
    expect(todos(author()).map((t) => [t.id, t.done, t.gain])).toEqual([
      ['byline', true, 0],
      ['authorProfile', true, 0],
    ]);
  });

  it('offers Edit author only to who can edit the author', () => {
    expect(todos(author({ bio: null }), true, false)[1]).toMatchObject({
      id: 'authorProfile',
      action: null,
    });
  });

  it('has none before E-E-A-T is read', () => {
    expect(qualityTodos({ eeat: null, author: null, hasAuthors: true })).toEqual([]);
  });
});
