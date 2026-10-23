import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasSettingsSection, resolveSettingsSection, settingsSectionPath } from './_sections';

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

describe('Authors (CE-037)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it("isn't there until Content Editor Quality's first phase is live", () => {
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '');
    expect(hasSettingsSection('authors', selfHost)).toBe(false);
    expect(resolveSettingsSection('authors', cloud)).toBe('account');
  });

  it('opens on its own address once it is', () => {
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '1');
    expect(hasSettingsSection('authors', selfHost)).toBe(true);
    expect(resolveSettingsSection('authors', selfHost)).toBe('authors');
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
