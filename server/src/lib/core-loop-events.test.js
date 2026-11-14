import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn() } }));

const { captureWorkspaceEvent } = await import('./core-loop-events.js');

/** A db answering by table; `profiles` is the workspace's first admin. */
function fakeDb({ brand = { organization_id: 'o1', is_demo: false }, admin = { id: 'u1' } } = {}) {
  const answers = {
    brands: { data: brand },
    organizations: { data: { plan: 'growth' } },
    profiles: { data: admin },
  };
  return {
    from: (table) => {
      const chain = new Proxy(
        {},
        { get: (_t, prop) => (prop === 'maybeSingle' ? async () => answers[table] : () => chain) },
      );
      return chain;
    },
  };
}

beforeEach(() => vi.stubEnv('POSTHOG_KEY', 'phc_test'));
afterEach(() => vi.unstubAllEnvs());

describe('captureWorkspaceEvent', () => {
  it("sends the event as the workspace's first admin with ids, counts and the plan", async () => {
    const capture = vi.fn();
    await captureWorkspaceEvent(
      'b1',
      'tracking_results_ready',
      { result_count: 12 },
      { db: fakeDb(), capture },
    );
    expect(capture).toHaveBeenCalledWith([
      {
        event: 'tracking_results_ready',
        distinctId: 'u1',
        properties: { result_count: 12, brand_id: 'b1', organization_id: 'o1', plan: 'growth' },
      },
    ]);
  });

  it('sends as the acting user when there is one', async () => {
    const capture = vi.fn();
    await captureWorkspaceEvent(
      'b1',
      'action_created',
      {},
      { userId: 'u9', db: fakeDb(), capture },
    );
    expect(capture.mock.calls[0][0][0].distinctId).toBe('u9');
  });

  it('sends nothing without a key, for a demo brand, or without anyone to send as', async () => {
    const capture = vi.fn();
    await captureWorkspaceEvent('b1', 'e', {}, { db: fakeDb({ admin: null }), capture });
    await captureWorkspaceEvent(
      'b1',
      'e',
      {},
      { db: fakeDb({ brand: { organization_id: 'o1', is_demo: true } }), capture },
    );
    vi.stubEnv('POSTHOG_KEY', '');
    await captureWorkspaceEvent('b1', 'e', {}, { db: fakeDb(), capture });
    expect(capture).not.toHaveBeenCalled();
  });

  it('never throws when the read or the capture fails', async () => {
    const broken = {
      from: () => {
        throw new Error('db down');
      },
    };
    await expect(captureWorkspaceEvent('b1', 'e', {}, { db: broken })).resolves.toBeUndefined();
    const capture = vi.fn().mockRejectedValue(new Error('network'));
    await expect(
      captureWorkspaceEvent('b1', 'e', {}, { db: fakeDb(), capture }),
    ).resolves.toBeUndefined();
  });
});
