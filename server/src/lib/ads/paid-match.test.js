import { describe, expect, it } from 'vitest';
import { matchSearchTerms, termWords } from './paid-match.js';

const CRM = {
  promptId: 'p-crm',
  text: 'What is the best CRM for a small business?',
  keywords: ['best crm', 'crm software', 'small business crm'],
};
const EMAIL = {
  promptId: 'p-email',
  text: 'Which email marketing tools work for startups?',
  keywords: ['email marketing tools', 'email marketing software'],
};

describe('termWords', () => {
  it('keeps telling words: lower case, no punctuation or small words, singular', () => {
    expect(termWords('What is the BEST CRM tools, for a small-business?')).toEqual([
      'best',
      'crm',
      'tool',
      'small',
      'business',
    ]);
  });

  it('keeps double s and short words as they are', () => {
    expect(termWords('glass bus')).toEqual(['glass', 'bus']);
  });
});

describe('matchSearchTerms', () => {
  it('matches a term that is one of a prompt’s keywords, plural or not', () => {
    const m = matchSearchTerms(['Email Marketing Tool'], [CRM, EMAIL]);
    expect(m.get('Email Marketing Tool')).toBe('p-email');
  });

  it('matches a term of two or more words all in the prompt’s question', () => {
    const m = matchSearchTerms(['crm small business'], [CRM, EMAIL]);
    expect(m.get('crm small business')).toBe('p-crm');
  });

  it('matches a term that holds a whole keyword of two words', () => {
    const m = matchSearchTerms(['cheap crm software uk'], [CRM, EMAIL]);
    expect(m.get('cheap crm software uk')).toBe('p-crm');
  });

  it('matches a one-word term only to a keyword it equals', () => {
    const withKeyword = { ...CRM, keywords: ['crm'] };
    expect(matchSearchTerms(['crm'], [CRM]).has('crm')).toBe(false);
    expect(matchSearchTerms(['crm'], [withKeyword]).get('crm')).toBe('p-crm');
  });

  it('leaves a term that fits no prompt unmatched', () => {
    const m = matchSearchTerms(['project management app', 'crm jobs london'], [CRM, EMAIL]);
    expect(m.size).toBe(0);
  });

  it('gives a term to one prompt only: a keyword beats words in the question', () => {
    const other = {
      promptId: 'p-other',
      text: 'Best CRM software for agencies',
      keywords: ['agency crm'],
    };
    // In other's question, but one of CRM's keywords: CRM's.
    expect(matchSearchTerms(['crm software'], [other, CRM]).get('crm software')).toBe('p-crm');
  });

  it('breaks a tie by shared words, then by prompt id, the same every time', () => {
    const a = { promptId: 'p-b', text: 'crm for startups', keywords: [] };
    const b = { promptId: 'p-a', text: 'crm for startups', keywords: [] };
    expect(matchSearchTerms(['startup crm'], [a, b]).get('startup crm')).toBe('p-a');
    expect(matchSearchTerms(['startup crm'], [b, a]).get('startup crm')).toBe('p-a');
    const closer = { promptId: 'p-z', text: 'crm for startups in europe', keywords: [] };
    expect(matchSearchTerms(['startup crm europe'], [a, closer]).get('startup crm europe')).toBe(
      'p-z',
    );
  });

  it('reads prompts without keywords or with odd ones', () => {
    const odd = { promptId: 'p-odd', text: 'crm for dentists', keywords: [null, 4, 'dental crm'] };
    expect(matchSearchTerms(['dental crm'], [odd]).get('dental crm')).toBe('p-odd');
    expect(
      matchSearchTerms(['crm dentist'], [{ promptId: 'x', text: 'crm for dentists' }]).size,
    ).toBe(1);
  });
});
