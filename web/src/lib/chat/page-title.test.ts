import { describe, expect, it } from 'vitest';
import { pageTitleIssue, refuseChatSentenceTitle } from './page-title';

describe('pageTitleIssue', () => {
  it.each([
    'Pricing FAQ',
    'How to apply for a Schengen visa',
    'Best CRM for small teams: a 2026 guide',
    'Finding the right accountant',
    'Creating a content calendar',
    'Okra recipes',
    // Real titles open with these too: never refused for it.
    'I Tested 10 CRMs for Small Teams',
    'Find Your Perfect Coffee Grinder',
    'Below the Fold: Where AI Answers Stop Reading',
  ])('accepts %s', (title) => {
    expect(pageTitleIssue(title)).toBeNull();
  });

  it.each([
    '',
    '   ',
    'Here are the opportunities from the last 30 …',
    'Here are the opportunities from the last 30 days',
    'Sure, here is a draft',
    'Let me draft the page for you',
    'Based on your prompts, a guide',
    'The opportunities are:',
    'Opportunities from the last 30 days...',
    'A'.repeat(121),
  ])('refuses %j', (title) => {
    expect(pageTitleIssue(title)).toMatch(/^Not saved: .*page title/);
  });

  it('has nothing to say when there is no title', () => {
    expect(pageTitleIssue(undefined)).toBeNull();
  });

  it('adds the issue on the title for a schema', () => {
    const issues: { message: string; path: string[] }[] = [];
    refuseChatSentenceTitle(
      { title: 'Here are the opportunities from the last 30 days' },
      { addIssue: (i) => issues.push(i) },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['title']);
  });
});
