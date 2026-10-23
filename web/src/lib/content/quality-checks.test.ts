import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import { EEAT_WEIGHTS, authorProfile, eeat, scoreGain } from './quality-checks';

const author = (over: Partial<ContentAuthor> = {}): ContentAuthor => ({
  id: 'a1',
  name: 'Ada Lovelace',
  title: 'Head of Content',
  bio: 'Writes about forecasting.',
  photoUrl: null,
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
  ...over,
});

describe('eeat (Phase 1: the author)', () => {
  it('gives a real author with a bio and profile links every live point', () => {
    const result = eeat({ author: author() });
    expect(result.score).toBe(100);
    // Schema waits for Before you publish's JSON-LD, dates for the live page.
    expect(result.checks).toEqual([
      { id: 'byline', points: EEAT_WEIGHTS.byline, max: EEAT_WEIGHTS.byline },
      { id: 'authorBio', points: EEAT_WEIGHTS.authorBio, max: EEAT_WEIGHTS.authorBio },
    ]);
  });

  it('gives the organization byline none: it is no person', () => {
    const result = eeat({ author: null });
    expect(result.score).toBe(0);
    expect(scoreGain(result, ['byline'])).toBe(60);
  });

  it('gives half the profile points for a bio or links alone', () => {
    // byline 15 + bio 5 of 25.
    expect(eeat({ author: author({ sameAs: [] }) }).score).toBe(80);
    const bare = eeat({ author: author({ bio: '  ', sameAs: [] }) });
    expect(bare.score).toBe(60);
    expect(scoreGain(bare, ['authorBio'])).toBe(40);
    expect(authorProfile(author({ bio: '  ' }))).toEqual({ bio: false, links: true });
  });
});
