import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  integrationName,
  settingsDots,
  strongestSettingsDot,
  type SettingsState,
} from './settings-dots';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const EARLIER = '2026-11-10T09:00:00.000Z';
const LATER = '2026-11-11T09:30:00.000Z';
const CLOUD = { isCloud: true, subscriptionStatus: 'active', trialEndsAt: null };

const state = (over: Partial<SettingsState> = {}): SettingsState => ({
  joined: null,
  expiredInvites: 0,
  seatsFull: false,
  brokenIntegration: null,
  newIntegration: null,
  newClient: null,
  ...over,
});

describe("Settings' dots", () => {
  it('lights Members green for who joined, until Members is opened here', () => {
    const joined = { count: 3, names: ['Ayşe', 'Mehmet', 'Can'], at: EARLIER };
    expect(settingsDots(state({ joined }), {}, CLOUD, NOW).members).toEqual({
      place: 'members',
      colour: 'green',
      reason: { kind: 'joined', count: 3, names: ['Ayşe', 'Mehmet', 'Can'] },
    });
    expect(settingsDots(state({ joined }), { members: LATER }, CLOUD, NOW).members).toBeUndefined();
  });

  it('turns Members yellow for an expired invite or full seats, over green', () => {
    const joined = { count: 1, names: ['Can'], at: EARLIER };
    expect(settingsDots(state({ joined, expiredInvites: 2 }), {}, CLOUD, NOW).members).toEqual({
      place: 'members',
      colour: 'yellow',
      reason: { kind: 'inviteExpired', count: 2 },
    });
    expect(settingsDots(state({ seatsFull: true }), {}, CLOUD, NOW).members?.reason).toEqual({
      kind: 'seatsFull',
    });
  });

  it('turns Integrations red while a connection is broken, and green for a teammate’s new one', () => {
    const broken = { provider: 'google-search-console', label: null };
    const fresh = { provider: 'hubspot', label: null, by: 'Ali', at: EARLIER };
    const both = settingsDots(
      state({ brokenIntegration: broken, newIntegration: fresh }),
      {},
      CLOUD,
      NOW,
    );
    expect(both.integrations).toMatchObject({
      colour: 'red',
      reason: { kind: 'integrationBroken', provider: 'Search Console' },
    });
    expect(
      settingsDots(state({ newIntegration: fresh }), {}, CLOUD, NOW).integrations,
    ).toMatchObject({
      colour: 'green',
      reason: { kind: 'integrationNew', provider: 'HubSpot', by: 'Ali' },
    });
    expect(
      settingsDots(state({ newIntegration: fresh }), { integrations: LATER }, CLOUD, NOW)
        .integrations,
    ).toBeUndefined();
  });

  it('lights API & MCP green for a new MCP client', () => {
    const dots = settingsDots(
      state({ newClient: { name: 'Claude', at: EARLIER } }),
      {},
      CLOUD,
      NOW,
    );
    expect(dots.api).toMatchObject({
      colour: 'green',
      reason: { kind: 'clientNew', name: 'Claude' },
    });
  });

  it("turns Plans & billing red for a failed payment and yellow in a trial's last 3 days, on the cloud only", () => {
    expect(
      settingsDots(null, {}, { ...CLOUD, subscriptionStatus: 'past_due' }, NOW).billing?.colour,
    ).toBe('red');
    const trial = (end: string, isCloud = true) =>
      settingsDots(null, {}, { isCloud, subscriptionStatus: 'trialing', trialEndsAt: end }, NOW)
        .billing;
    expect(trial('2026-11-13T12:00:00.000Z')).toMatchObject({
      colour: 'yellow',
      reason: { kind: 'trialEnding', days: 3 },
    });
    expect(trial('2026-11-20T12:00:00.000Z')).toBeUndefined();
    expect(trial('2026-11-12T12:00:00.000Z', false)).toBeUndefined();
  });

  it('puts the strongest on the avatar: red, then yellow, green', () => {
    const dots = settingsDots(
      state({
        joined: { count: 1, names: ['Can'], at: EARLIER },
        brokenIntegration: { provider: 'slack', label: null },
      }),
      {},
      { ...CLOUD, subscriptionStatus: 'trialing', trialEndsAt: '2026-11-12T12:00:00.000Z' },
      NOW,
    );
    expect(strongestSettingsDot(dots)?.place).toBe('integrations');
    delete dots.integrations;
    expect(strongestSettingsDot(dots)?.place).toBe('billing');
    expect(strongestSettingsDot({})).toBeNull();
  });

  it('names connections and counts days', () => {
    expect(integrationName('wordpress', 'shop.example')).toBe('WordPress');
    expect(integrationName('shopify', 'My shop')).toBe('My shop');
    expect(integrationName('shopify', null)).toBe('Shopify');
    expect(daysUntil('2026-11-09T00:00:00.000Z', NOW)).toBe(0);
  });
});
