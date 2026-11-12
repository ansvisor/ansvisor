import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Send to CMS → HubSpot (#2140; 00522): a brand's HubSpot takes pages only
 * when it's set up on the server, connected, on a plan with HubSpot, with
 * consent to send pages as drafts and a blog picked; each refusal named.
 */

vi.mock('../config/supabase.js', () => ({ default: {} }));
const state = vi.hoisted(() => ({ configured: true, plan: true, connection: null }));
vi.mock('./composio.js', () => ({
  isWebflowConfigured: () => false,
  isHubspotConfigured: () => state.configured,
}));
vi.mock('./hubspot/connection.js', () => ({ hubspotConnection: async () => state.connection }));
vi.mock('./cms/hubspot-delivery.js', () => ({
  brandPlanHasHubspot: async () => state.plan,
  sendToHubspot: vi.fn(),
}));

const { cmsConnectionFor } = await import('./content-delivery.js');

const ready = () => ({
  accountId: 'acc-1',
  composioAccountId: 'ca_1',
  connected: true,
  settings: { consent: { contacts: false, pages: true }, blog: { id: '123', name: 'Blog' } },
});

beforeEach(() => {
  state.configured = true;
  state.plan = true;
  state.connection = ready();
});

describe('cmsConnectionFor(brand, "hubspot")', () => {
  it('answers the sign-in and the blog pages go to', async () => {
    await expect(cmsConnectionFor('b1', 'hubspot')).resolves.toEqual({
      accountId: 'acc-1',
      composioAccountId: 'ca_1',
      blogId: '123',
    });
  });

  it('names what is missing', async () => {
    const code = () => cmsConnectionFor('b1', 'hubspot').catch((err) => [err.code, err.status]);
    state.configured = false;
    expect(await code()).toEqual(['hubspot_not_configured', 503]);
    state.configured = true;
    state.connection = null;
    expect(await code()).toEqual(['no_hubspot', 409]);
    state.connection = ready();
    state.plan = false;
    expect(await code()).toEqual(['hubspot_plan', 403]);
    state.plan = true;
    state.connection = { ...ready(), connected: false };
    expect(await code()).toEqual(['hubspot_refused', 409]);
    state.connection = { ...ready(), settings: { ...ready().settings, consent: { pages: false } } };
    expect(await code()).toEqual(['hubspot_no_consent', 409]);
    state.connection = { ...ready(), settings: { ...ready().settings, blog: null } };
    expect(await code()).toEqual(['hubspot_not_ready', 409]);
  });
});
