import { describe, expect, it } from 'vitest';
import { actionRef } from '@/lib/action-center/action-ref';
import { ACTION_NAME_RULES, PERSONA_RULES, SAFETY_RULES } from './rules';

/** Chat's system rules (CHAT-05), the safety ones (owner decision 2026-11-03). */

describe('SAFETY_RULES', () => {
  it("are in the writer's persona rules, which Chat's agents and schedules run on too", () => {
    for (const rule of SAFETY_RULES) expect(PERSONA_RULES).toContain(rule);
  });

  it('forbid what puts a life at risk, profanity and insults, and promised results', () => {
    const rules = SAFETY_RULES.join('\n');
    expect(rules).toContain('doses, harmful health claims');
    expect(rules).toContain('local emergency services');
    expect(rules).toContain('No profanity and no insults');
    expect(rules).toContain('even when the person swears');
    expect(rules).toContain('Never promise results or earnings');
    expect(rules).toContain('an estimate or a scenario, not a guarantee');
  });
});

describe('PERSONA_RULES facts', () => {
  it('never invent a fact, never collapse one that varies, and ask for the missing ones', () => {
    expect(PERSONA_RULES).toContain(
      "unless it comes from the brand's facts, the brand's own pages read in this run, or an official source cited in this run",
    );
    expect(PERSONA_RULES).toContain('is never collapsed into one figure');
    expect(PERSONA_RULES).toContain('ask the person for the missing facts in one question');
    expect(PERSONA_RULES).not.toContain('anything else is a [placeholder]');
  });

  it('explain a change by its drivers, never by a share left unexplained', () => {
    expect(PERSONA_RULES).toContain('explain the drivers the data supports');
    expect(PERSONA_RULES).toContain('also reflects shifts across AI answers');
  });
});

describe('ACTION_NAME_RULES (the owner’s report, 2026-11-14)', () => {
  it("are in the writer's persona rules", () => {
    expect(PERSONA_RULES).toContain(ACTION_NAME_RULES);
  });

  it('name an action by its title with its linked number, never by a number alone', () => {
    expect(ACTION_NAME_RULES).toContain(
      `Name an action by its title, then its number in brackets, which the app turns into a link: **Recover lost citations on 3 prompts** (${actionRef(12)}).`,
    );
    expect(ACTION_NAME_RULES).toContain('Never a number alone');
    expect(ACTION_NAME_RULES).toContain('never bare numbers');
    // A group says what it shares and gives each its own number.
    expect(ACTION_NAME_RULES).toContain(
      `3 stale actions about sources (${actionRef(12)}, ${actionRef(13)}, ${actionRef(14)})`,
    );
    expect(ACTION_NAME_RULES).toContain('Never a range in place of the numbers');
  });

  it("keep the app's title when answering in another language (the owner's decision, 2026-11-16)", () => {
    expect(ACTION_NAME_RULES).toContain(
      "Write the title exactly as the app shows it, in the app's language, even when you answer in another language",
    );
    expect(ACTION_NAME_RULES).toContain(
      "A short explanation in the person's language may follow it; never a translated title in its place.",
    );
  });

  it('say how many actions a read judged when it showed fewer than its total', () => {
    expect(ACTION_NAME_RULES).toContain('the top 50 of 53 open actions');
    expect(ACTION_NAME_RULES).toContain('or read the next page first');
  });

  it('read an action asked for by its code, and never answer with the closest others (owner, 2026-11-16)', () => {
    expect(ACTION_NAME_RULES).toContain(
      `An action the person names by its code (${actionRef(12)}, however they write it): answer from a read of that code, never from a page of the list, and say whether it is its code or its previous code.`,
    );
    expect(ACTION_NAME_RULES).toContain(
      'A code that names two actions: name both and say which is which; never pick one.',
    );
    expect(ACTION_NAME_RULES).toContain(
      'A code not found in this brand: say plainly that this brand has no action with that code, and that codes are per brand.',
    );
    expect(ACTION_NAME_RULES).toContain(
      'Never offer "the closest" or similar actions in its place',
    );
    expect(ACTION_NAME_RULES).toContain(
      "never say an action doesn't exist because a page of the list didn't show it",
    );
  });

  it('build every example number with the shared formatter, small and generic', () => {
    expect(actionRef(12)).toBe('AC-12');
    expect(ACTION_NAME_RULES).not.toMatch(/AC-\d{3,}/);
  });
});
