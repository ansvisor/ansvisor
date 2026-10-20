import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockFetch, state } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockFetch: vi.fn(),
  state: { configs: [] },
}));

vi.mock('../config/supabase.js', () => ({
  default: { from: mockFrom },
}));
vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { dispatchBrandWebhook } = await import('./webhook-dispatch.js');

function queryForConfigs() {
  const filters = [];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column, value) => {
      filters.push((config) => config[column] === value);
      return query;
    }),
    contains: vi.fn((column, values) => {
      filters.push(
        (config) =>
          Array.isArray(config[column]) && values.every((value) => config[column].includes(value)),
      );
      return query;
    }),
    then: (resolve, reject) =>
      Promise.resolve({
        data: state.configs.filter((config) => filters.every((matches) => matches(config))),
        error: null,
      }).then(resolve, reject),
  };
  return query;
}

beforeEach(() => {
  state.configs = [];
  mockFrom.mockReset();
  mockFrom.mockImplementation((table) => {
    expect(table).toBe('webhook_configs');
    return queryForConfigs();
  });
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', mockFetch);
});

describe('dispatchBrandWebhook', () => {
  it('delivers an event only to active configs subscribed to that event', async () => {
    state.configs = [
      {
        id: 'opportunity-only',
        brand_id: 'brand-1',
        webhook_url: 'https://opportunity.example/hook',
        webhook_secret: null,
        is_active: true,
        events: ['opportunity.sent'],
      },
      {
        id: 'pulse',
        brand_id: 'brand-1',
        webhook_url: 'https://pulse.example/hook',
        webhook_secret: 'pulse-secret',
        is_active: true,
        events: ['daily_pulse.created'],
      },
      {
        id: 'inactive',
        brand_id: 'brand-1',
        webhook_url: 'https://inactive.example/hook',
        webhook_secret: null,
        is_active: false,
        events: ['daily_pulse.created'],
      },
      {
        id: 'other-brand',
        brand_id: 'brand-2',
        webhook_url: 'https://other.example/hook',
        webhook_secret: null,
        is_active: true,
        events: ['daily_pulse.created'],
      },
    ];

    const result = await dispatchBrandWebhook('brand-1', {
      event: 'daily_pulse.created',
      pulse: { date: '2026-10-20' },
    });

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://pulse.example/hook',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': 'pulse-secret',
        },
      }),
    );
  });

  it('counts delivery failures without throwing', async () => {
    state.configs = [
      {
        id: 'non-2xx',
        brand_id: 'brand-1',
        webhook_url: 'https://reject.example/hook',
        webhook_secret: null,
        is_active: true,
        events: ['opportunity.sent'],
      },
      {
        id: 'network-error',
        brand_id: 'brand-1',
        webhook_url: 'https://network.example/hook',
        webhook_secret: null,
        is_active: true,
        events: ['opportunity.sent'],
      },
    ];
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockRejectedValueOnce(new Error('connection refused'));

    await expect(dispatchBrandWebhook('brand-1', { event: 'opportunity.sent' })).resolves.toEqual({
      sent: 0,
      failed: 2,
    });
  });

  it('does not attempt delivery when no config subscribes to the event', async () => {
    state.configs = [
      {
        id: 'opportunity-only',
        brand_id: 'brand-1',
        webhook_url: 'https://opportunity.example/hook',
        webhook_secret: null,
        is_active: true,
        events: ['opportunity.sent'],
      },
    ];

    await expect(
      dispatchBrandWebhook('brand-1', { event: 'daily_pulse.created' }),
    ).resolves.toEqual({ sent: 0, failed: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
