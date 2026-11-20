import { describe, expect, it } from 'vitest';
import { caseRepeats, listPrompts, promptCategories } from './prompt-list';

const prompt = (
  promptId: string,
  promptText: string,
  avgDiff: number,
  day: number,
  promptCategory?: string,
) => ({
  promptId,
  promptText,
  avgDiff,
  latestAt: `2026-11-${String(day).padStart(2, '0')}T10:00:00Z`,
  promptCategory,
});

const prompts = [
  prompt('p1', 'Best CRM for startups', -40, 18, 'Comparison'),
  prompt('p2', 'best crm for startups', 5, 19, 'Comparison'),
  prompt('p3', 'CRM pricing for small teams', -10, 12, 'Pricing'),
  prompt('p4', 'How to import contacts', 20, 15),
];

describe('the Prompt-by-Prompt list (UX audit CP-12)', () => {
  it('lists the most recent first, or the widest gap first', () => {
    expect(listPrompts(prompts, {}).map((p) => p.promptId)).toEqual(['p2', 'p1', 'p4', 'p3']);
    expect(listPrompts(prompts, { sort: 'diff' }).map((p) => p.promptId)).toEqual([
      'p1',
      'p3',
      'p2',
      'p4',
    ]);
  });

  it('searches every word, any case, and keeps one category', () => {
    expect(listPrompts(prompts, { query: 'crm  STARTUPS' }).map((p) => p.promptId)).toEqual([
      'p2',
      'p1',
    ]);
    expect(listPrompts(prompts, { category: 'Pricing' }).map((p) => p.promptId)).toEqual(['p3']);
    expect(promptCategories(prompts)).toEqual(['Comparison', 'Pricing']);
  });

  it('counts the prompts that repeat another but for letter case', () => {
    expect(caseRepeats(prompts)).toBe(1);
  });
});
