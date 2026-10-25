import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** Composio for Webflow (Send to CMS, #1331 phase 2): a brand's site token as an API-key account. */

const sdk = {
  initiate: vi.fn(),
  list: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
};
vi.mock('@composio/core', () => ({
  AuthScheme: { APIKey: (val) => ({ authScheme: 'API_KEY', val }) },
  Composio: class {
    connectedAccounts = {
      initiate: (...args) => sdk.initiate(...args),
      list: (...args) => sdk.list(...args),
      delete: (...args) => sdk.delete(...args),
    };
    tools = { execute: (...args) => sdk.execute(...args) };
  },
}));

const { connectWebflowToken, executeWebflowTool, forgetWebflowAccounts, isWebflowConfigured } =
  await import('./composio.js');

beforeEach(() => {
  vi.stubEnv('COMPOSIO_API_KEY', 'test-composio-key');
  vi.stubEnv('COMPOSIO_WEBFLOW_AUTH_CONFIG_ID', 'ac_webflow');
  for (const fn of Object.values(sdk)) fn.mockReset();
});

afterAll(() => vi.unstubAllEnvs());

describe('Webflow on Composio', () => {
  it('is set up with the API key and the Webflow auth config', () => {
    expect(isWebflowConfigured()).toBe(true);
    vi.stubEnv('COMPOSIO_WEBFLOW_AUTH_CONFIG_ID', '');
    expect(isWebflowConfigured()).toBe(false);
  });

  it('connects a token as one more API-key account of the brand: the one it replaces is still there', async () => {
    sdk.initiate.mockResolvedValue({ id: 'ca_new', status: 'ACTIVE' });
    expect(await connectWebflowToken('brand_b1', 'wf-token')).toBe('ca_new');
    expect(sdk.initiate).toHaveBeenCalledWith('brand_b1', 'ac_webflow', {
      config: { authScheme: 'API_KEY', val: { api_key: 'wf-token' } },
      allowMultiple: true,
    });
  });

  it('removes the brand’s Webflow accounts but the one kept', async () => {
    sdk.list.mockResolvedValue({ items: [{ id: 'ca_old' }, { id: 'ca_new' }, { id: 'ca_left' }] });
    await forgetWebflowAccounts('brand_b1', 'ca_new');
    expect(sdk.list).toHaveBeenCalledWith({ authConfigIds: ['ac_webflow'], userIds: ['brand_b1'] });
    expect(sdk.delete.mock.calls).toEqual([['ca_old'], ['ca_left']]);

    sdk.delete.mockClear();
    await forgetWebflowAccounts('brand_b1');
    expect(sdk.delete).toHaveBeenCalledTimes(3);

    sdk.delete.mockRejectedValueOnce(new Error('down'));
    await expect(forgetWebflowAccounts('brand_b1')).rejects.toThrow('down');
  });

  it('runs a tool on the brand’s own account, pinned to a toolkit version', async () => {
    sdk.execute.mockResolvedValueOnce({ successful: true, data: { sites: [] } });
    expect(
      await executeWebflowTool(
        'WEBFLOW_LIST_WEBFLOW_SITES',
        {
          entityId: 'brand_b1',
          accountId: 'ca_new',
        },
        {},
      ),
    ).toEqual({ sites: [] });
    expect(sdk.execute).toHaveBeenCalledWith('WEBFLOW_LIST_WEBFLOW_SITES', {
      userId: 'brand_b1',
      connectedAccountId: 'ca_new',
      arguments: {},
      version: '20260826_00',
    });
    sdk.execute.mockResolvedValueOnce({ successful: false, error: '401 Unauthorized' });
    await expect(
      executeWebflowTool('WEBFLOW_LIST_WEBFLOW_SITES', { entityId: 'b', accountId: 'a' }, {}),
    ).rejects.toThrow('401 Unauthorized');
  });
});
