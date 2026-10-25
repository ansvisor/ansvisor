import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import { eeat, trust } from './quality-checks';
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
      { id: 'byline', done: false, gain: 60, score: 'eeat', action: 'pickAuthor' },
      { id: 'authorProfile', done: false, gain: 40, score: 'eeat', action: null },
    ]);
  });

  it('asks to add an author when the workspace has none', () => {
    expect(todos(null, false)[0]).toEqual({
      id: 'byline',
      done: false,
      gain: 60,
      score: 'eeat',
      action: 'addAuthor',
    });
  });

  it("keeps the byline done, then asks to complete the author's profile", () => {
    expect(todos(author({ bio: null, sameAs: [] }))).toEqual([
      { id: 'byline', done: true, gain: 0, score: 'eeat', action: 'pickAuthor' },
      { id: 'authorProfile', done: false, gain: 40, score: 'eeat', action: 'editAuthor' },
    ]);
    expect(todos(author({ sameAs: [] }))[1]).toEqual({
      id: 'authorProfile',
      done: false,
      gain: 20,
      score: 'eeat',
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

  it('asks to fill the placeholders first, and keeps it checked once filled (CE-044)', () => {
    const fill = (count: number) => ({
      id: 'placeholders',
      done: count === 0,
      gain: 0,
      score: 'eeat',
      action: 'showPlaceholder',
      count,
    });
    expect(
      qualityTodos({
        eeat: eeat({ author: null }),
        author: null,
        hasAuthors: true,
        placeholders: { count: 2, had: true },
      }),
    ).toEqual([
      fill(2),
      expect.objectContaining({ id: 'byline' }),
      expect.objectContaining({ id: 'authorProfile' }),
    ]);
    // Before the authors are read, the placeholders still are.
    expect(
      qualityTodos({
        eeat: null,
        author: null,
        hasAuthors: true,
        placeholders: { count: 2, had: true },
      }),
    ).toEqual([fill(2)]);
    expect(
      qualityTodos({
        eeat: null,
        author: null,
        hasAuthors: true,
        placeholders: { count: 0, had: true },
      }),
    ).toEqual([fill(0)]);
    // A page that never had any: no row.
    expect(
      qualityTodos({
        eeat: null,
        author: null,
        hasAuthors: true,
        placeholders: { count: 0, had: false },
      }),
    ).toEqual([]);
  });

  it('asks for what only the person can give, once Your input is read (CE-048)', () => {
    const none = { experience: false, data: false, quote: false };
    const quoted = trust({
      blocks: [{ tag: 'p', text: 'Sales grew 40% in 2025.', links: [] }],
      links: new Map(),
      brandDomains: [],
      quote: false,
      now: Date.parse('2026-10-24'),
    });
    const read = (
      used: typeof none,
      given: typeof none | null = null,
      trustScore: typeof quoted | null = quoted,
    ) =>
      qualityTodos({
        eeat: eeat({ author: author(), used }),
        author: author(),
        hasAuthors: true,
        used,
        given,
        trust: trustScore,
      }).slice(2);
    expect(read(none)).toEqual([
      { id: 'experience', done: false, given: false, gain: 33, score: 'eeat', action: 'addInput' },
      {
        id: 'originalData',
        done: false,
        given: false,
        gain: 25,
        score: 'eeat',
        action: 'addInput',
      },
      {
        id: 'expertQuote',
        done: false,
        given: false,
        gain: 21,
        score: 'trust',
        action: 'addInput',
      },
    ]);
    // Given in Your input, the page not using it yet: still to do, said so.
    expect(read(none, { experience: true, data: false, quote: true }).map((t) => t.given)).toEqual([
      true,
      false,
      true,
    ]);
    // Used: checked off, with no gain left.
    expect(
      read(
        { experience: true, data: true, quote: true },
        { experience: true, data: true, quote: true },
      ),
    ).toEqual([
      expect.objectContaining({ id: 'experience', done: true, given: false, gain: 0 }),
      expect.objectContaining({ id: 'originalData', done: true, given: false, gain: 0 }),
      expect.objectContaining({ id: 'expertQuote', done: true, given: false, gain: 0 }),
    ]);
    // Trust not scored yet: a quote's gain isn't made up.
    expect(read(none, null, null)[2]).toMatchObject({ id: 'expertQuote', gain: 0 });
  });

  it('has no input to-dos before Your input is read', () => {
    expect(todos(author()).map((t) => t.id)).toEqual(['byline', 'authorProfile']);
  });

  it('offers to confirm the author the site names instead of picking one, the profile once they are', () => {
    const read = (real: boolean, profile: boolean) =>
      qualityTodos({
        eeat: eeat({ author: null, confirmed: { real, profile } }),
        author: null,
        hasAuthors: true,
        confirmed: { real, profile },
      }).map(({ id, done, confirm }) => ({ id, done, confirm }));
    expect(read(false, false)).toEqual([
      { id: 'byline', done: false, confirm: { what: 'real', on: false } },
      { id: 'authorProfile', done: false, confirm: undefined },
    ]);
    expect(read(true, false)).toEqual([
      { id: 'byline', done: true, confirm: { what: 'real', on: true } },
      { id: 'authorProfile', done: false, confirm: { what: 'profile', on: false } },
    ]);
    expect(read(true, true)[1]).toEqual({
      id: 'authorProfile',
      done: true,
      confirm: { what: 'profile', on: true },
    });
    // A picked author: nothing to confirm.
    expect(
      qualityTodos({
        eeat: eeat({ author: author() }),
        author: author(),
        hasAuthors: true,
        confirmed: { real: false, profile: false },
      }).map((t) => t.confirm),
    ).toEqual([undefined, undefined]);
  });
});
