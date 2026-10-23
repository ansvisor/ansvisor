import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import { eeat, scoreGain, trust } from './quality-checks';
import type { DraftSuggestion } from './suggestions';

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
    expect(result.checks.map((c) => c.id)).toEqual(['byline', 'authorBio', 'authorSchema']);
  });

  it('gives the organization byline none: no person, no Person schema', () => {
    const result = eeat({ author: null });
    expect(result.score).toBe(0);
    // Picking a complete author raises all three.
    expect(scoreGain(result, ['byline', 'authorBio', 'authorSchema'])).toBe(100);
  });

  it('gives half for a bio without links, and Person schema without sameAs', () => {
    // byline 15 + bio 5 + schema 5 of 35.
    expect(eeat({ author: author({ sameAs: [] }) }).score).toBe(71);
    // byline 15 + bio 0 + schema 5 of 35.
    const bare = eeat({ author: author({ bio: '  ', sameAs: [] }) });
    expect(bare.score).toBe(57);
    expect(scoreGain(bare, ['authorBio', 'authorSchema'])).toBe(43);
  });
});

describe('trust (Phase 1: the agent’s sourced claims)', () => {
  const suggestion = (over: Partial<DraftSuggestion>): DraftSuggestion => ({
    id: 's1',
    batchId: 'b1',
    actionId: null,
    actionNo: null,
    kind: 'replace',
    blockText: 'Teams forecast.',
    beforeText: 'Teams',
    afterText: 'Teams (42% of them)',
    reason: 'add a dated data point',
    ruleKeys: [],
    status: 'accepted',
    sources: [{ kind: 'cited_page', ref: 'https://example.com', label: 'Example' }],
    sourceMarks: [{ start: 7, end: 10, source: 0 }],
    ...over,
  });

  it("isn't scored while the page has no agent claim to count", () => {
    expect(trust({ suggestions: [] }).score).toBeNull();
    expect(trust({ suggestions: [suggestion({ status: 'open' })] }).score).toBeNull();
    expect(trust({ suggestions: [suggestion({ sourceMarks: null })] }).score).toBeNull();
  });

  it('counts the sourced claims of the changes the person accepted', () => {
    const result = trust({ suggestions: [suggestion({})] });
    expect(result.score).toBe(100);
    expect(result.checks).toEqual([{ id: 'claimsSourced', points: 30, max: 30 }]);
  });
});
