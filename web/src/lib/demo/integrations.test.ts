import { describe, expect, it } from 'vitest';
import { DEMO_INTEGRATIONS, demoIntegration, upcomingDemoIntegrations } from './integrations';

describe('the demo brand’s integrations', () => {
  it('shows the live ones connected and the ones to come as soon', () => {
    expect(demoIntegration('google-search-console')).toBe('connected');
    expect(demoIntegration('google-analytics')).toBe('connected');
    expect(demoIntegration('webflow')).toBe('connected');
    for (const id of ['google-merchant-center', 'shopify', 'wordpress', 'framer', 'wix']) {
      expect(demoIntegration(id)).toBe('soon');
    }
    expect(demoIntegration('hubspot')).toBeNull();
  });

  it('lists each integration once', () => {
    const ids = DEMO_INTEGRATIONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rows of their own only for those without a card yet, by group', () => {
    expect(upcomingDemoIntegrations('stores')).toEqual(['shopify']);
    expect(upcomingDemoIntegrations('cms')).toEqual(['wordpress', 'framer', 'wix']);
  });
});
