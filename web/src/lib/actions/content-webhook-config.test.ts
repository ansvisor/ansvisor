import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return { query, createClient: vi.fn() };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

const { getWebhookConfig } = await import('./content');

beforeEach(() => {
  mocks.query.select.mockClear().mockReturnValue(mocks.query);
  mocks.query.eq.mockClear().mockReturnValue(mocks.query);
  mocks.query.limit.mockClear().mockReturnValue(mocks.query);
  mocks.query.single.mockReset().mockResolvedValue({
    data: {
      id: 'default-config',
      brand_id: 'brand-1',
      name: 'Default',
      webhook_url: 'https://hooks.example/default',
      webhook_secret: 'default-secret',
      events: ['daily_pulse.created'],
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    },
    error: null,
  });
  mocks.createClient.mockResolvedValue({
    from: () => mocks.query,
  });
});

describe('getWebhookConfig', () => {
  it('reads only the dashboard Default config, leaving Zapier-managed subscriptions separate', async () => {
    const result = await getWebhookConfig('brand-1');
    expect(result?.id).toBe('default-config');
    expect(mocks.query.eq).toHaveBeenNthCalledWith(1, 'brand_id', 'brand-1');
    expect(mocks.query.eq).toHaveBeenNthCalledWith(2, 'name', 'Default');
  });
});
