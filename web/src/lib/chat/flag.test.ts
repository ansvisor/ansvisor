import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  autoGoLiveEnabled,
  chatAgenticEnabled,
  chatAgenticOrgScope,
  chatOperatorEnabled,
  chatOperatorOn,
  chatOperatorOrgScope,
} from './flag';
import { skillFlagOn } from './skills/flagged';
import { enabledSkills } from './skills/library';

/** The new Chat's switch: CHAT_AGENTIC, narrowed by CHAT_AGENTIC_ORGS. */

const ORG_A = '22222222-2222-4222-8222-222222222222';
const ORG_B = '33333333-3333-4333-8333-333333333333';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('chatAgenticEnabled', () => {
  it('is off when CHAT_AGENTIC is unset, so a self-hosted install sees nothing new', () => {
    vi.stubEnv('CHAT_AGENTIC', undefined);
    vi.stubEnv('CHAT_AGENTIC_ORGS', undefined);
    expect(chatAgenticEnabled(ORG_A)).toBe(false);
    expect(chatAgenticEnabled()).toBe(false);
  });

  it('is off for anything but "true"', () => {
    for (const value of ['', 'false', '1', 'yes', 'TRUE', ' true']) {
      vi.stubEnv('CHAT_AGENTIC', value);
      expect(chatAgenticEnabled(ORG_A)).toBe(false);
    }
  });

  it('is on for every organization when CHAT_AGENTIC_ORGS is unset or empty', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    for (const orgs of [undefined, '', ' , ,']) {
      vi.stubEnv('CHAT_AGENTIC_ORGS', orgs);
      expect(chatAgenticEnabled(ORG_A)).toBe(true);
      expect(chatAgenticEnabled(ORG_B)).toBe(true);
      expect(chatAgenticEnabled()).toBe(true);
    }
  });

  it('is on only for the listed organizations when CHAT_AGENTIC_ORGS is set', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv(
      'CHAT_AGENTIC_ORGS',
      ` ${ORG_A.toUpperCase()} , 44444444-4444-4444-8444-444444444444`,
    );
    expect(chatAgenticEnabled(ORG_A)).toBe(true);
    expect(chatAgenticEnabled(` ${ORG_A} `)).toBe(true);
    expect(chatAgenticEnabled(ORG_B)).toBe(false);
    expect(chatAgenticEnabled(null)).toBe(false);
    expect(chatAgenticEnabled()).toBe(false);
  });

  it("doesn't turn Chat on with CHAT_AGENTIC_ORGS alone", () => {
    vi.stubEnv('CHAT_AGENTIC', undefined);
    vi.stubEnv('CHAT_AGENTIC_ORGS', ORG_A);
    expect(chatAgenticEnabled(ORG_A)).toBe(false);
  });

  it('reads the variables when asked, not when loaded', () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(chatAgenticEnabled(ORG_A)).toBe(false);
    vi.stubEnv('CHAT_AGENTIC', 'true');
    expect(chatAgenticEnabled(ORG_A)).toBe(true);
  });
});

describe('autoGoLiveEnabled (AUTONOMOUS-GO-LIVE §9)', () => {
  it('is off unless both CHAT_AGENTIC and CHAT_AUTO_GO_LIVE are on', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_AUTO_GO_LIVE', undefined);
    expect(autoGoLiveEnabled(ORG_A)).toBe(false);
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'true');
    vi.stubEnv('CHAT_AUTO_GO_LIVE_ORGS', '');
    expect(autoGoLiveEnabled(ORG_A)).toBe(true);
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(autoGoLiveEnabled(ORG_A)).toBe(false);
  });

  it('is on only for the listed organizations when CHAT_AUTO_GO_LIVE_ORGS is set', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'true');
    vi.stubEnv('CHAT_AUTO_GO_LIVE_ORGS', ` ${ORG_A.toUpperCase()} `);
    expect(autoGoLiveEnabled(ORG_A)).toBe(true);
    expect(autoGoLiveEnabled(ORG_B)).toBe(false);
    expect(autoGoLiveEnabled(null)).toBe(false);
  });
});

describe('chatOperatorEnabled (the AEO Operator, AEO Operator plan §4.5)', () => {
  it('is off by default, and off unless both CHAT_AGENTIC and CHAT_OPERATOR are on', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_OPERATOR', undefined);
    vi.stubEnv('CHAT_OPERATOR_ORGS', undefined);
    expect(chatOperatorEnabled(ORG_A)).toBe(false);
    expect(chatOperatorOn()).toBe(false);
    vi.stubEnv('CHAT_OPERATOR', 'yes');
    expect(chatOperatorEnabled(ORG_A)).toBe(false);
    vi.stubEnv('CHAT_OPERATOR', 'true');
    expect(chatOperatorEnabled(ORG_A)).toBe(true);
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(chatOperatorEnabled(ORG_A)).toBe(false);
  });

  it('is on only for the listed organizations when CHAT_OPERATOR_ORGS is set', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_OPERATOR', 'true');
    vi.stubEnv('CHAT_OPERATOR_ORGS', ` ${ORG_A.toUpperCase()} `);
    expect(chatOperatorEnabled(ORG_A)).toBe(true);
    expect(chatOperatorEnabled(ORG_B)).toBe(false);
    expect(chatOperatorEnabled(null)).toBe(false);
    // With no workspace to ask about (an install's list): the switch alone.
    expect(chatOperatorOn()).toBe(true);
  });

  it('names the workspaces it is on for, for the sweep’s reads: none off, null for all', () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_OPERATOR', 'true');
    vi.stubEnv('CHAT_OPERATOR_ORGS', '');
    expect(chatAgenticOrgScope()).toEqual([]);
    expect(chatOperatorOrgScope()).toEqual([]);
    vi.stubEnv('CHAT_AGENTIC', 'true');
    expect(chatAgenticOrgScope()).toBeNull();
    expect(chatOperatorOrgScope()).toBeNull();
    vi.stubEnv('CHAT_OPERATOR_ORGS', ` ${ORG_A.toUpperCase()} `);
    expect(chatOperatorOrgScope()).toEqual([ORG_A]);
    // Both narrowed: the workspaces on both lists.
    vi.stubEnv('CHAT_AGENTIC_ORGS', `${ORG_A},${ORG_B}`);
    vi.stubEnv('CHAT_OPERATOR_ORGS', '');
    expect(chatAgenticOrgScope()).toEqual([ORG_A, ORG_B]);
    expect(chatOperatorOrgScope()).toEqual([ORG_A, ORG_B]);
    vi.stubEnv('CHAT_OPERATOR_ORGS', ORG_B);
    expect(chatOperatorOrgScope()).toEqual([ORG_B]);
    vi.stubEnv('CHAT_OPERATOR', '');
    expect(chatOperatorOrgScope()).toEqual([]);
  });

  it('hides the /operator skill everywhere while off: every list reads it as off', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_OPERATOR', '');
    expect(skillFlagOn('operator')).toBe(false);
    expect(skillFlagOn('operator', ORG_A)).toBe(false);
    expect(enabledSkills(ORG_A).map((skill) => skill.name)).not.toContain('operator');
    vi.stubEnv('CHAT_OPERATOR', 'true');
    expect(enabledSkills(ORG_A).map((skill) => skill.name)).toContain('operator');
  });
});
