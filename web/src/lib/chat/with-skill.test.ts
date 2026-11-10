import { describe, expect, it } from 'vitest';
import { withSkillRefusal } from './with-skill';

/** The fan-out reads run only within a skill that names them (owner decision 2026-11-09). */
describe('withSkillRefusal', () => {
  const gaps = { name: 'get_fanout_gaps', withSkill: true as const };

  it('refuses a read marked withSkill while no loaded skill names it', () => {
    expect(withSkillRefusal(gaps, [])).toMatchObject({ code: 'not_available' });
    expect(
      withSkillRefusal(gaps, [
        { body: 'Read `get_fanouts` for the topic.', reads: ['get_fanouts'] },
      ]),
    ).toMatchObject({ code: 'not_available' });
  });

  it("lets it run where a loaded skill's text or a playbook's reads name it", () => {
    expect(
      withSkillRefusal(gaps, [{ body: '1. `get_fanout_gaps` for the last 30 days.' }]),
    ).toBeNull();
    expect(
      withSkillRefusal(gaps, [{ body: 'A playbook.', reads: ['get_fanout_gaps'] }]),
    ).toBeNull();
  });

  it('leaves every other read alone', () => {
    expect(withSkillRefusal({ name: 'get_visibility_summary' }, [])).toBeNull();
  });
});
