import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

const {
  CAREFUL_MIN_DECIDED,
  CAREFUL_REJECT_SHARE,
  DECISION_WINDOW_DAYS,
  carefulLine,
  carefulRules,
} = await import('./content-suggestion-stats.js');

/** The rules a brand mostly rejects the Content Agent's suggestions for (learning B6). */

const db = (rows) => {
  const rpc = vi.fn(async () => ({ data: rows, error: null }));
  return { rpc };
};

describe('carefulRules', () => {
  it('names the rules decided often enough and mostly rejected, the most rejected first', async () => {
    const reads = db([
      { rule_key: 'faq', accepted: 2, rejected: 8 },
      { rule_key: 'tables', accepted: 0, rejected: 12 },
      // 7 of 10: just at the share.
      { rule_key: 'dated', accepted: 3, rejected: 7 },
      // Mostly taken.
      { rule_key: 'answerFirst', accepted: 9, rejected: 1 },
      // Too few to tell.
      { rule_key: 'aiTraces', accepted: 0, rejected: CAREFUL_MIN_DECIDED - 1 },
    ]);
    const now = new Date('2026-10-28T12:00:00Z');
    expect(await carefulRules('b1', { now, db: reads })).toEqual([
      { key: 'tables', accepted: 0, rejected: 12 },
      { key: 'faq', accepted: 2, rejected: 8 },
      { key: 'dated', accepted: 3, rejected: 7 },
    ]);
    expect(CAREFUL_REJECT_SHARE).toBe(0.7);
    const since = new Date(now.getTime() - DECISION_WINDOW_DAYS * 86_400_000).toISOString();
    expect(reads.rpc).toHaveBeenCalledWith('content_suggestion_decisions', {
      p_brand_id: 'b1',
      p_since: since,
    });
  });

  it('names five at most, and throws when the decisions can’t be read', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      rule_key: `rule${i}`,
      accepted: 0,
      rejected: 10 + i,
    }));
    expect(await carefulRules('b1', { db: db(many) })).toHaveLength(5);
    const failing = { rpc: async () => ({ data: null, error: { message: 'gone' } }) };
    await expect(carefulRules('b1', { db: failing })).rejects.toThrow('gone');
  });
});

describe('carefulLine', () => {
  it('tells the agent which rules to keep small, and nothing with none', () => {
    expect(carefulLine([{ key: 'faq', accepted: 2, rejected: 8 }])).toBe(
      'People at this brand reject most of the changes suggested for these rules: faq (8 of 10 rejected). For them, suggest a change only where the rule can’t be met without it, and keep it as small as the rule allows: the fewest words, no new section.'.replace(
        'can’t',
        "can't",
      ),
    );
    expect(carefulLine([])).toBe('');
  });
});
