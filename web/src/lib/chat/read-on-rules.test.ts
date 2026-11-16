import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { READ_FAILED, READ_TIMED_OUT, READ_TIMED_OUT_AGAIN } = await import('./read-attempt');
const { GIVE_UP_WORDS, NEVER_GIVE_UP_RULES, READ_ON_RULES } = await import('./rules');
const { READS_USED_UP, TOOL_READS_USED_UP } = await import('./run-limits');

/**
 * The owner's rule (2026-11-16): Chat reads all a page shows and reaches any
 * other page's data. No answer says "I couldn't read it", "I hit the read
 * limit" or "38 actions are missing": it reads on, looks the item up or
 * narrows the read, and says "not found" only after a direct lookup.
 */

describe('READ_ON_RULES, for the reader', () => {
  it('look an item up by what the person named, read on through a list, and narrow after a miss', () => {
    expect(READ_ON_RULES).toContain('read it by that first');
    expect(READ_ON_RULES).toContain('A list result with next_offset has more');
    expect(READ_ON_RULES).toContain('read the next page with that offset');
    expect(READ_ON_RULES).toContain('truncated: true');
    expect(READ_ON_RULES).toContain('try once more, narrower');
    expect(READ_ON_RULES).toContain('never with the same input');
  });
});

describe('NEVER_GIVE_UP_RULES, for the writer', () => {
  it('read on or look up first, and say "not found" only after a direct lookup', () => {
    expect(NEVER_GIVE_UP_RULES).toContain('Read on first');
    expect(NEVER_GIVE_UP_RULES).toContain('Say "not found" only after a direct lookup');
    expect(NEVER_GIVE_UP_RULES).toContain('Never offer substitutes');
    expect(NEVER_GIVE_UP_RULES).toContain('"the newest 50 of 451 signals"');
    expect(NEVER_GIVE_UP_RULES).not.toContain('say plainly when data is missing');
  });

  it('keep "no" for a true refusal, said with why and what the person can do', () => {
    expect(NEVER_GIVE_UP_RULES).toContain(
      "the plan, the person's role, the AI budget, an Admin setting or a feature that is off",
    );
    expect(NEVER_GIVE_UP_RULES).toContain('say plainly why, once, and what the person can do');
  });

  it('name the words no answer uses, in English and Turkish', () => {
    for (const words of [
      "couldn't read",
      "couldn't reach",
      "couldn't access",
      'read limit',
      'hit the limit',
      '"rows"',
      'a count of missing items',
      'okuyamadım',
      'ulaşamadım',
      'erişemedim',
      'sınırına takıldım',
      '"eksik" about the data',
      '"bulamadım" before a direct lookup',
    ]) {
      expect(GIVE_UP_WORDS).toContain(words);
    }
    expect(NEVER_GIVE_UP_RULES).toContain(`in any language: ${GIVE_UP_WORDS}`);
  });
});

describe("what the engine tells the model after a miss (never what it couldn't read)", () => {
  const messages = {
    READ_TIMED_OUT,
    READ_TIMED_OUT_AGAIN,
    READ_FAILED,
    READS_USED_UP,
    TOOL_READS_USED_UP,
  };

  it.each(Object.entries(messages))('%s says what to do next', (_name, message) => {
    // Never an instruction to tell the person something couldn't be read.
    expect(message).not.toMatch(/say (in the answer )?that this data couldn't/i);
    expect(message).not.toMatch(/Reading is done|No more of these in this run/);
    expect(message).toMatch(/answer|try|narrower|offer/i);
  });

  it('a timeout asks for one narrower try, and the second for none', () => {
    expect(READ_TIMED_OUT).toContain('Try it once more, narrower');
    expect(READ_TIMED_OUT_AGAIN).toContain("don't call it again in this run");
    for (const message of [READ_TIMED_OUT, READ_TIMED_OUT_AGAIN, READ_FAILED]) {
      expect(message).toContain("this figure isn't available right now");
    }
  });

  it('reads used up: answer for what was read and say what it covers, never "a limit"', () => {
    expect(READS_USED_UP).toContain('Say what the answer covers in plain words');
    expect(READS_USED_UP).toContain('offer the rest as a next move');
    expect(READS_USED_UP).toContain('never mention a limit or reading');
    // An agent's run still makes its changes (the agents' test set, 2026-11-03).
    expect(READS_USED_UP).toContain('make the changes the task asks for with their tools');
  });
});
