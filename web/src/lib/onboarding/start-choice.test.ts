import { describe, expect, it } from 'vitest';
import {
  opensOnStartChoice,
  startChoiceName,
  startPositionProps,
  workspaceNameFromBrand,
  type StartChoiceFacts,
} from './start-choice';

/** A new account's admin with its organization made, no plan and no brand. */
const fresh: StartChoiceFacts = {
  cloud: true,
  hasOrganization: true,
  role: 'admin',
  subscriptionStatus: null,
  everSubscribed: false,
  ownBrands: 0,
};

describe('opensOnStartChoice', () => {
  it('opens a new admin on the choice, with or without the organization made yet', () => {
    expect(opensOnStartChoice({ cloud: true, hasOrganization: false, role: 'admin' })).toBe(true);
    expect(opensOnStartChoice(fresh)).toBe(true);
    // A Checkout left unpaid or expired leaves no subscription behind.
    expect(opensOnStartChoice({ ...fresh, subscriptionStatus: 'incomplete_expired' })).toBe(true);
  });

  it('never on a self-hosted install, nor for anyone but an admin', () => {
    expect(opensOnStartChoice({ ...fresh, cloud: false })).toBe(false);
    expect(opensOnStartChoice({ cloud: false, hasOrganization: false, role: 'admin' })).toBe(false);
    for (const role of ['manager', 'analyst', 'agency_partner', null]) {
      expect(opensOnStartChoice({ ...fresh, role })).toBe(false);
      expect(opensOnStartChoice({ cloud: true, hasOrganization: false, role })).toBe(false);
    }
  });

  it('keeps the old order once a brand of its own is set up, or when it could not be counted', () => {
    expect(opensOnStartChoice({ ...fresh, ownBrands: 1 })).toBe(false);
    expect(opensOnStartChoice({ ...fresh, ownBrands: null })).toBe(false);
    expect(opensOnStartChoice({ cloud: true, hasOrganization: true, role: 'admin' })).toBe(false);
  });

  it('never with a plan on (setup after purchase), or after one (the read-only dashboard)', () => {
    expect(opensOnStartChoice({ ...fresh, subscriptionStatus: 'trialing' })).toBe(false);
    expect(opensOnStartChoice({ ...fresh, subscriptionStatus: 'active' })).toBe(false);
    expect(
      opensOnStartChoice({ ...fresh, subscriptionStatus: 'canceled', everSubscribed: true }),
    ).toBe(false);
  });
});

describe('the choice in analytics', () => {
  it('names each choice', () => {
    expect(startChoiceName('trial')).toBe('trial');
    expect(startChoiceName('month')).toBe('monthly');
    expect(startChoiceName('year')).toBe('yearly');
    expect(startChoiceName('demo')).toBe('demo');
  });

  it('marks the first screen only', () => {
    expect(startPositionProps(true)).toEqual({ position: 'first' });
    expect(startPositionProps(false)).toEqual({});
  });
});

describe('workspaceNameFromBrand', () => {
  const placeholder = 'My workspace';

  it('names a workspace still named as it was made after its first brand', () => {
    expect(
      workspaceNameFromBrand({ current: 'My workspace', placeholder, brandName: ' Acme ' }),
    ).toBe('Acme');
  });

  it('leaves one renamed since, one unread, or a brand with no name, as it is', () => {
    expect(workspaceNameFromBrand({ current: 'Acme Group', placeholder, brandName: 'Acme' })).toBe(
      null,
    );
    expect(workspaceNameFromBrand({ current: null, placeholder, brandName: 'Acme' })).toBe(null);
    expect(workspaceNameFromBrand({ current: 'My workspace', placeholder, brandName: ' ' })).toBe(
      null,
    );
  });
});
