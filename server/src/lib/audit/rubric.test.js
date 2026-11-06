import { describe, expect, it } from 'vitest';
import { evidenceLevels, isScored, RUBRIC_VERSION, signalsByKey, TOTAL_SIGNALS } from './rubric.js';

/**
 * Evidence levels (Site Audit spec §6.2, SA-010): each signal says how strong
 * the evidence behind it is, from the spec's research (§3). llms.txt is
 * informational: shown, never scored.
 */

const levelOf = (level) =>
  Object.values(signalsByKey)
    .filter((s) => s.evidenceLevel === level)
    .map((s) => s.key)
    .sort();

describe('rubric evidence levels', () => {
  it('is rubric v1.3 (v1.2 evidence levels, v1.3 the live bot test) with the four levels, of which only informational is not scored', () => {
    expect(RUBRIC_VERSION).toBe('v1.3');
    expect(evidenceLevels.map((l) => [l.key, l.scored])).toEqual([
      ['strong', true],
      ['likely', true],
      ['hygiene', true],
      ['informational', false],
    ]);
  });

  it('gives every signal one of the levels', () => {
    const keys = new Set(evidenceLevels.map((l) => l.key));
    const signals = Object.values(signalsByKey);
    expect(signals).toHaveLength(TOTAL_SIGNALS);
    for (const s of signals) expect(keys.has(s.evidenceLevel), s.key).toBe(true);
  });

  it('rates as strong what the spec’s research rates strong: bot access, freshness, statistics, quotes and sources', () => {
    expect(levelOf('strong')).toEqual(
      [
        'ai-bot-access',
        'freshness',
        'statistic-density',
        'quotations',
        'citation-density',
        'outbound-authority-links',
      ].sort(),
    );
  });

  it('rates as likely what it rates plausible: answer-first intro, headings, lists, tables, definitions, authors, first-hand evidence', () => {
    expect(levelOf('likely')).toEqual(
      [
        'direct-answer',
        'bluf-answer',
        'h2-coverage',
        'sub-query-coverage',
        'lists',
        'tables',
        'definitions',
        'author-byline',
        'author-credentials',
        'byline-depth',
        'first-person',
        'case-study-evidence',
      ].sort(),
    );
  });

  it('keeps schema as hygiene, as the research found it a weak citation lever', () => {
    for (const key of ['json-ld-presence', 'json-ld-validity', 'json-ld-relevance', 'faq-schema']) {
      expect(signalsByKey[key].evidenceLevel, key).toBe('hygiene');
    }
  });

  it('makes llms.txt informational, with a short evidence note, and the only signal left out of the score', () => {
    expect(levelOf('informational')).toEqual(['llms-txt-presence']);
    const llms = signalsByKey['llms-txt-presence'];
    expect(llms.evidenceNote).toMatch(/97%/);
    expect(llms.evidenceNote.length).toBeLessThanOrEqual(150);
    expect(isScored('llms-txt-presence')).toBe(false);
    expect(Object.keys(signalsByKey).filter((k) => !isScored(k))).toEqual(['llms-txt-presence']);
  });

  it('scores no key the rubric doesn’t know', () => {
    expect(isScored('no-such-signal')).toBe(false);
    expect(isScored('https')).toBe(true);
  });
});
