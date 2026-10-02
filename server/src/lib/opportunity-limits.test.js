import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MAX_OPEN_PER_PROMPT,
  OPPORTUNITIES_PER_RUN,
  OPPORTUNITY_COUNT_RULE,
  alreadySuggested,
  belowOpenCap,
  openCountsByPrompt,
  openTitlesByPrompt,
  opportunityKey,
  relatedCandidate,
} from './opportunity-limits.js';

/**
 * The count rule is shared because it was duplicated (#730).
 *
 * Two generators produce opportunities — the automatic one after each tracking
 * cycle and the queued one behind the Generate button — and each used to carry
 * its own copy of the sentence and its own schema ceiling. They had already
 * drifted in wording. These tests fail if a number is hand-written back into
 * either file, which is the only way they can disagree again.
 */

const source = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const GENERATORS = [
  ['automatic (tracking cycle)', './opportunity-generator.js'],
  ['queued (Generate button)', '../workers/content-worker.js'],
];

describe('opportunity count', () => {
  it('asks for three', () => {
    expect(OPPORTUNITIES_PER_RUN).toBe(3);
  });

  it('states the count and that the slots go to the highest-impact findings', () => {
    expect(OPPORTUNITY_COUNT_RULE).toContain(String(OPPORTUNITIES_PER_RUN));
    expect(OPPORTUNITY_COUNT_RULE).toMatch(/highest-impact/i);
  });

  for (const [label, path] of GENERATORS) {
    it(`the ${label} generator takes its ceiling from the shared constant`, () => {
      const code = source(path);
      expect(code).toContain('OPPORTUNITIES_PER_RUN');
      expect(code).toContain('.max(OPPORTUNITIES_PER_RUN)');
      // A literal ceiling here is how the two drifted apart before.
      expect(code).not.toMatch(/\.max\(\d+\)/);
    });

    it(`the ${label} generator takes its count instruction from the shared rule`, () => {
      const code = source(path);
      expect(code).toContain('${OPPORTUNITY_COUNT_RULE}');
      expect(code).not.toMatch(/Generate (between )?\d+/);
    });

    it(`the ${label} generator drops an out-of-range prompt index`, () => {
      const code = source(path);
      expect(code).toContain('relatedCandidate(');
      // The old fallback attached the opportunity to the top candidate.
      expect(code).not.toMatch(/relatedPromptIndex\]\s*\|\|/);
    });
  }
});

describe('open-opportunity cap (#837)', () => {
  it('counts open opportunities per prompt', () => {
    const counts = openCountsByPrompt([
      { prompt_id: 'a' },
      { prompt_id: 'a' },
      { prompt_id: 'b' },
      { prompt_id: null },
    ]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.size).toBe(2);
  });

  it('keeps prompts under the cap and drops prompts at it', () => {
    const counts = new Map([
      ['full', MAX_OPEN_PER_PROMPT],
      ['partly', MAX_OPEN_PER_PROMPT - 1],
    ]);
    const kept = belowOpenCap(
      [{ promptId: 'full' }, { promptId: 'partly' }, { promptId: 'fresh' }],
      counts,
    );
    expect(kept.map((c) => c.promptId)).toEqual(['partly', 'fresh']);
  });

  it('resolves an in-range index and drops anything else', () => {
    const candidates = [{ promptId: 'a' }, { promptId: 'b' }];
    expect(relatedCandidate(candidates, 1)).toEqual({ promptId: 'b' });
    expect(relatedCandidate(candidates, 2)).toBeNull();
    expect(relatedCandidate(candidates, -1)).toBeNull();
    expect(relatedCandidate(candidates, 0.5)).toBeNull();
    expect(relatedCandidate(candidates, undefined)).toBeNull();
  });

  it('lists open titles per prompt and renders them for the prompt data', () => {
    const titles = openTitlesByPrompt([
      { prompt_id: 'a', title: 'Guide' },
      { prompt_id: 'a', title: 'Checklist' },
      { prompt_id: 'b', title: null },
    ]);
    expect(titles.get('a')).toEqual(['Guide', 'Checklist']);
    expect(titles.has('b')).toBe(false);
    expect(alreadySuggested(titles.get('a'))).toBe(' | Already suggested: "Guide"; "Checklist"');
    expect(alreadySuggested(undefined)).toBe('');
  });

  it('keys duplicates by prompt and title, ignoring case and outer spaces', () => {
    expect(opportunityKey('p', '  Guide ')).toBe(opportunityKey('p', 'guide'));
    expect(opportunityKey('p', 'Guide')).not.toBe(opportunityKey('q', 'Guide'));
  });

  for (const [label, path] of GENERATORS) {
    it(`the ${label} generator applies the cap and shows the model what is open`, () => {
      const code = source(path);
      expect(code).toContain('loadOpenOpportunities(');
      expect(code).toContain('belowOpenCap(');
      expect(code).toContain('${ALREADY_SUGGESTED_RULE}');
      expect(code).toContain('opportunityKey(');
    });
  }

  it('the Generate button adds to the open list instead of deleting it (#63)', () => {
    const code = source('../workers/content-worker.js');
    expect(code).not.toMatch(/\.delete\(\)/);
  });
});
