import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OPPORTUNITIES_PER_RUN, OPPORTUNITY_COUNT_RULE } from './opportunity-limits.js';

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
  }
});
