import { describe, expect, it } from 'vitest';
import { bannedPhrasesIn, bannedPhrasesIssue } from './banned-phrases';

describe('bannedPhrasesIn', () => {
  it('matches a word or a phrase in any case, once each', () => {
    expect(
      bannedPhrasesIn(
        ['The CHEAPEST fares. Cheapest!', '<p>Best  <b>price</b> yet</p>'],
        ['cheapest', 'best price', 'guaranteed'],
      ),
    ).toEqual(['cheapest', 'best price']);
  });

  it('ignores a phrase inside another word', () => {
    expect(
      bannedPhrasesIn(['A cheaper, uncheapest-ish deal; guaranteeds'], ['cheap', 'guaranteed']),
    ).toEqual([]);
    expect(bannedPhrasesIn(['Only cheap-ish'], ['cheap'])).toEqual(['cheap']);
  });

  it('treats regex characters in a phrase as text', () => {
    expect(bannedPhrasesIn(['Book now (limited)!'], ['now (limited)', '.*'])).toEqual([
      'now (limited)',
    ]);
  });

  it('finds nothing without phrases or text', () => {
    expect(bannedPhrasesIn([undefined, ''], ['x'])).toEqual([]);
    expect(bannedPhrasesIn(['x'], [])).toEqual([]);
  });
});

describe('bannedPhrasesIssue', () => {
  it('names the phrases found, or is null', () => {
    expect(bannedPhrasesIssue(['A guaranteed trip'], ['guaranteed'])).toContain('"guaranteed"');
    expect(bannedPhrasesIssue(['A trip'], ['guaranteed'])).toBeNull();
  });
});
