// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BRAND = '11111111-2222-4333-8444-555555555555';
const ID = '22222222-3333-4444-8555-666666666666';
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
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    delete: vi.fn(),
    then: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.delete.mockReturnValue(query);
  query.then.mockImplementation((resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ error: null }).then(resolve, reject),
  );
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

const { DELETE } = await import('./route');

const remove = (id = ID) => DELETE(
  new Request('http://localhost/api/mcp/webhooks/' + id, { method: 'DELETE' }),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  mocks.authenticateMcpRequest.mockReset().mockResolvedValue(AUTH);
  mocks.listBrandsFor.mockReset().mockResolvedValue([{ id: BRAND }]);
  mocks.isDemoBrandOf.mockReset().mockResolvedValue(false);
  mocks.from.mockClear();
  mocks.query.select.mockClear().mockReturnValue(mocks.query);
  mocks.query.eq.mockClear().mockReturnValue(mocks.query);
  mocks.query.maybeSingle.mockReset().mockResolvedValue({
    data: { id: ID, brand_id: BRAND, name: 'Zapier:' + 'a'.repeat(32) },
    error: null,
  });
  mocks.query.delete.mockClear().mockReturnValue(mocks.query);
  mocks.query.then.mockReset().mockImplementation((resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ error: null }).then(resolve, reject),
  );
});

describe('DELETE /api/mcp/webhooks/{id}', () => {
  it('removes only the Zapier-managed webhook config', async () => {
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.from).toHaveBeenCalledWith('webhook_configs');
    expect(mocks.query.delete).toHaveBeenCalled();
  });

  it('does not delete the dashboard Default webhook config', async () => {
    mocks.query.maybeSingle.mockResolvedValueOnce({
      data: { id: ID, brand_id: BRAND, name: 'Default' },
      error: null,
    });
    expect((await remove()).status).toBe(404);
    expect(mocks.query.delete).not.toHaveBeenCalled();
  });

  it('requires a valid ID, brand access and a manager role', async () => {
    expect((await remove('not-a-uuid')).status).toBe(400);
    mocks.listBrandsFor.mockResolvedValueOnce([]);
    expect((await remove()).status).toBe(404);
    mocks.authenticateMcpRequest.mockResolvedValueOnce({ ...AUTH, role: 'analyst' });
    expect((await remove()).status).toBe(403);
  });

  it('refuses demo brands and returns a generic error on delete failure', async () => {
    mocks.isDemoBrandOf.mockResolvedValueOnce(true);
    expect((await remove()).status).toBe(402);

    mocks.query.then.mockImplementationOnce((resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ error: { message: 'database detail' } }).then(resolve, reject),
    );
    const response = await remove();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unable to remove the webhook subscription.' });
  });
});
