import { describe, expect, it } from 'vitest';
import { buildEvidence } from './evidence.js';
import { sameTask, taskProblems } from './quality.js';

const evidence = buildEvidence([
  {
    id: 's1',
    kind: 'lost_citations',
    payload: {
      promptId: 'p1',
      promptText: 'Which coffee subscriptions ship internationally?',
      lostUrls: [{ url: 'https://acme.example/blog/shipping', position: 2 }],
      citedNow: [{ url: 'https://seriouseats.com/best', domain: 'seriouseats.com' }],
    },
  },
]);

const good = {
  title: 'Add a 2026 shipping table to /blog/shipping',
  where: 'acme.example/blog/shipping · lost on ChatGPT',
  why: 'Cited #2 until Oct 12; seriouseats.com now has a dated table.',
  how: ['Add a table of countries and costs.', 'Put "2026" in the title.'],
  doneWhen: 'Cited again on ChatGPT within 14 days.',
  type: 'content',
  effort: '~2h',
  role: 'Content writer',
  refs: ['page:1', 'domain:1'],
};

describe('taskProblems', () => {
  it('keeps a concrete task', () => {
    expect(taskProblems(good, evidence)).toEqual([]);
  });

  it('refuses a title that counts instead of naming', () => {
    expect(taskProblems({ ...good, title: 'Refresh content for 7 prompts' }, evidence)).toContain(
      'the title counts prompts or pages instead of naming one',
    );
    expect(
      taskProblems({ ...good, title: 'Improve /blog/shipping across 3 pages' }, evidence),
    ).toContain('the title counts prompts or pages instead of naming one');
  });

  it('refuses analysis the product does itself', () => {
    expect(
      taskProblems({ ...good, title: 'Analyze citations on /blog/shipping' }, evidence),
    ).toContain('it is analysis, which the product does itself; write the change to make');
  });

  it('needs where, 2 to 5 steps, done-when and a known type', () => {
    expect(
      taskProblems(
        { ...good, where: ' ', how: ['One step.'], doneWhen: '', type: 'marketing' },
        evidence,
      ),
    ).toEqual([
      'Where is empty',
      'How needs 2 to 5 steps',
      'Done when is empty',
      'its type is not one of the six',
    ]);
  });

  it('needs refs the evidence has, and its target named', () => {
    expect(taskProblems({ ...good, refs: [] }, evidence)).toEqual([
      'it cites none of the evidence refs',
    ]);
    expect(taskProblems({ ...good, refs: ['page:1', 'page:9'] }, evidence)).toEqual([
      'it cites refs the evidence does not have (page:9)',
    ]);
    expect(
      taskProblems({ ...good, title: 'Rewrite the shipping guide', where: 'Your blog' }, evidence),
    ).toEqual(['neither the title nor Where names its target']);
  });
});

describe('a task aimed at a prompt', () => {
  const prompts = buildEvidence([
    {
      id: 's2',
      kind: 'uncited_mentions',
      payload: {
        mentions: [
          {
            promptId: 'p9',
            promptText: 'What are the best coffee subscriptions in 2026?',
            platforms: ['gemini-web'],
          },
        ],
      },
    },
  ]);
  const aimed = {
    ...good,
    title: 'Publish a buyer guide that cites acme.example',
    refs: ['prompt:1'],
  };

  it('names the prompt by its first words, whatever the quotes and case', () => {
    expect(
      taskProblems(
        { ...aimed, where: 'Gemini · "what are the BEST coffee subscriptions" prompt' },
        prompts,
      ),
    ).toEqual([]);
  });

  it('does not count a paraphrase as naming it', () => {
    expect(
      taskProblems({ ...aimed, where: 'Gemini · prompts about coffee subscriptions' }, prompts),
    ).toEqual(['neither the title nor Where names its target']);
  });
});

describe('sameTask', () => {
  it('reads two titles that differ only in case and spacing as one', () => {
    expect(
      sameTask(good, { ...good, title: '  add a 2026 SHIPPING table to /blog/shipping ' }),
    ).toBe(true);
  });
});
