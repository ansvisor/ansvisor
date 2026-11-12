// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BRAND = '11111111-2222-4333-8444-555555555555';
const AUTH = {
  userId: 'user-1',
  email: 'owner@acme.example',
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin' as const,
};

const mocks = vi.hoisted(() => {
  const query = {
    upsert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };
  query.upsert.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return {
    authenticateMcpRequest: vi.fn(),
    listBrandsFor: vi.fn(),
    isDemoBrandOf: vi.fn(),
    from: vi.fn(() => query),
    query,
  };
});

vi.mock('@/lib/mcp-auth', () => ({ authenticateMcpRequest: mocks.authenticateMcpRequest }));
vi.mock('@/lib/mcp/data', () => ({ listBrandsFor: mocks.listBrandsFor }));
vi.mock('@/lib/mcp/demo-gate', () => ({
  DEMO_BRAND: { error: 'demo_brand', code: 'demo_brand' },
  isDemoBrandOf: mocks.isDemoBrandOf,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: mocks.from } }));

const { POST } = await import('./route');

const body = (overrides: Record<string, unknown> = {}) => ({
  brand_id: BRAND,
  event: 'daily_pulse.created',
  webhook_url: 'https://hooks.zapier.com/hooks/catch/123/456',
  webhook_secret: 'brand-webhook-secret',
  subscription_id: 'a'.repeat(32),
  ...overrides,
});

const post = (payload: unknown) =>
  POST(
    new Request('http://localhost/api/mcp/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );

beforeEach(() => {
  mocks.authenticateMcpRequest.mockReset().mockResolvedValue(AUTH);
  mocks.listBrandsFor.mockReset().mockResolvedValue([{ id: BRAND }]);
  mocks.isDemoBrandOf.mockReset().mockResolvedValue(false);
  mocks.from.mockClear();
  mocks.query.upsert.mockClear().mockReturnValue(mocks.query);
  mocks.query.select.mockClear().mockReturnValue(mocks.query);
  mocks.query.single.mockReset().mockResolvedValue({ data: { id: 'config-1' }, error: null });
});

describe('POST /api/mcp/webhooks', () => {
  it('registers one event-specific Zapier webhook for an accessible brand', async () => {
    const response = await post(body());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'config-1' });
    expect(mocks.from).toHaveBeenCalledWith('webhook_configs');
    expect(mocks.query.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_id: BRAND,
        name: 'Zapier:' + 'a'.repeat(32),
        webhook_url: 'https://hooks.zapier.com/hooks/catch/123/456',
        webhook_secret: 'brand-webhook-secret',
        events: ['daily_pulse.created'],
        is_active: true,
      }),
      { onConflict: 'brand_id,name' },
    );
  });

  it('rejects unsupported events, non-HTTPS targets and malformed subscription IDs', async () => {
    expect((await post(body({ event: 'webhook.test' }))).status).toBe(400);
    expect((await post(body({ webhook_url: 'http://hooks.zapier.com/catch/123' }))).status).toBe(
      400,
    );
    expect((await post(body({ subscription_id: 'not-a-hash' }))).status).toBe(400);
  });

  it('requires a webhook secret and a brand the API key can access', async () => {
    expect((await post(body({ webhook_secret: '' }))).status).toBe(400);
    mocks.listBrandsFor.mockResolvedValueOnce([]);
    expect((await post(body())).status).toBe(404);
  });

  it('requires a manager or admin and refuses demo brands', async () => {
    mocks.authenticateMcpRequest.mockResolvedValueOnce({ ...AUTH, role: 'analyst' });
    expect((await post(body())).status).toBe(403);
    mocks.isDemoBrandOf.mockResolvedValueOnce(true);
    expect((await post(body())).status).toBe(402);
  });

  it('returns a generic server error if the subscription cannot be stored', async () => {
    mocks.query.single.mockResolvedValueOnce({ data: null, error: { message: 'database detail' } });
    const response = await post(body());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Unable to register the webhook subscription.',
    });
  });
});
