import { describe, expect, it } from 'vitest';
import { resolveSettingsSection, settingsSectionPath } from './_sections';

const cloud = { isCloud: true };
const selfHost = { isCloud: false };

describe('resolveSettingsSection', () => {
  it('opens the section the address names', () => {
    expect(resolveSettingsSection('ai-providers', cloud)).toBe('ai-providers');
    expect(resolveSettingsSection('notifications', selfHost)).toBe('notifications');
  });

  it('reads the older names an address may carry', () => {
    expect(resolveSettingsSection('agent', cloud)).toBe('ai-providers');
    expect(resolveSettingsSection('project', selfHost)).toBe('organization');
  });

  it("opens Account for none, an unknown section, or one self-host doesn't have", () => {
    expect(resolveSettingsSection(null, cloud)).toBe('account');
    expect(resolveSettingsSection('nope', cloud)).toBe('account');
    expect(resolveSettingsSection('ai-providers', selfHost)).toBe('account');
    expect(resolveSettingsSection('billing', selfHost)).toBe('account');
  });
});

describe('settingsSectionPath', () => {
  it('keeps the locale prefix and replaces the section', () => {
    expect(settingsSectionPath('/dashboard/settings', 'team')).toBe('/dashboard/settings/team');
    expect(settingsSectionPath('/tr/dashboard/settings/team', 'ai-providers')).toBe(
      '/tr/dashboard/settings/ai-providers',
    );
  });
});
