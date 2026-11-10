import { describe, expect, it, vi } from 'vitest';

/** A brand's HubSpot settings (#2140): the consent, the account, the properties. */

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../brand-integrations.js', () => ({ brandConnection: vi.fn() }));

const { AI_SOURCES_VERSION } = await import('../ai-sources.js');
const { PROPERTIES_VERSION } = await import('./properties.js');
const { nextConsent, propertiesReady, readSettings } = await import('./connection.js');

describe('readSettings', () => {
  it('reads nothing allowed from nothing, or from anything malformed', () => {
    const none = {
      consent: { contacts: false, pages: false, by: null, at: null },
      blog: null,
      portal: null,
      properties: null,
    };
    expect(readSettings(undefined)).toEqual(none);
    expect(readSettings([])).toEqual(none);
    expect(readSettings({ consent: { contacts: 'yes', pages: 1 }, portal: { id: '12' } })).toEqual(
      none,
    );
  });

  it('reads what was stored', () => {
    const stored = {
      consent: { contacts: true, pages: false, by: 'u1', at: '2026-11-10T09:00:00.000Z' },
      blog: { id: '1234567890', name: 'Acme blog' },
      portal: { id: 4412893, currency: 'USD', timeZone: 'Europe/Istanbul', uiDomain: 'app.x' },
      properties: { version: 1, sourcesVersion: 3, at: '2026-11-10T09:00:01.000Z', error: null },
    };
    expect(readSettings(stored)).toEqual(stored);
  });
});

describe('nextConsent', () => {
  const now = new Date('2026-11-10T10:00:00.000Z');

  it('records who allowed a write, and when', () => {
    expect(nextConsent(null, { contacts: true, pages: false }, 'u1', now)).toEqual({
      contacts: true,
      pages: false,
      by: 'u1',
      at: '2026-11-10T10:00:00.000Z',
    });
  });

  it('keeps the last allowing when a write is turned off, or nothing new is allowed', () => {
    const before = { contacts: true, pages: true, by: 'u1', at: '2026-11-01T00:00:00.000Z' };
    expect(nextConsent(before, { contacts: false, pages: true }, 'u2', now)).toEqual({
      ...before,
      contacts: false,
    });
    expect(nextConsent(before, { contacts: true, pages: true }, 'u2', now)).toEqual(before);
    // Turning one on again is a new allowing.
    expect(
      nextConsent({ ...before, pages: false }, { contacts: true, pages: true }, 'u2', now),
    ).toMatchObject({ by: 'u2', at: now.toISOString() });
  });
});

describe('propertiesReady', () => {
  const ready = {
    properties: {
      version: PROPERTIES_VERSION,
      sourcesVersion: AI_SOURCES_VERSION,
      at: '2026-11-10T09:00:00.000Z',
      error: null,
    },
  };

  it('is ready once made with the current definitions and AI source list', () => {
    expect(propertiesReady(ready)).toBe(true);
    expect(propertiesReady({ properties: null })).toBe(false);
    expect(propertiesReady({ properties: { ...ready.properties, error: 'scopes' } })).toBe(false);
    expect(propertiesReady({ properties: { ...ready.properties, version: 0 } })).toBe(false);
    expect(
      propertiesReady({
        properties: { ...ready.properties, sourcesVersion: AI_SOURCES_VERSION - 1 },
      }),
    ).toBe(false);
  });
});
