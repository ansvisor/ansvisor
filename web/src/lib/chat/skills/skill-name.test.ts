import { describe, expect, it } from 'vitest';
import { readSkillName } from './skill-name';

/** A skill's /name on its draft card (W3-08): as kept, and why it can't be. */
describe('readSkillName', () => {
  it('keeps a /name without its slash, trimmed and lowercase', () => {
    expect(readSkillName(' /Pricing-FAQ ')).toEqual({ name: 'pricing-faq', problem: null });
  });

  it('says what is wrong with an empty name, a wrong form, and a reserved one', () => {
    expect(readSkillName('  ').problem).toBe('nameRequired');
    for (const bad of ['pricing faq', 'pricing--faq', '-pricing', 'faq_page', 'x'.repeat(65)]) {
      expect(readSkillName(bad).problem).toBe('nameFormat');
    }
    // An Ansvisor skill's name, and a shortcut's (W2-09).
    expect(readSkillName('winback')).toEqual({ name: 'winback', problem: 'nameReserved' });
    expect(readSkillName('/start').problem).toBe('nameReserved');
  });
});
