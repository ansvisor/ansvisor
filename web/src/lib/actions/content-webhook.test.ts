import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The brand's webhook keeps the events it is subscribed to: Content page
 * sent (#1331) among them, anything else left out.
 */

let upserts: unknown[];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      let value: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        upsert: (v: Record<string, unknown>) => ((value = v), upserts.push(v), chain),
        select: () => chain,
        single: async () => ({ data: { id: 'w1', ...value }, error: null }),
      };
      return chain;
    },
  })),
}));

const { saveWebhookConfig } = await import('./content');

beforeEach(() => {
  upserts = [];
});

describe('saveWebhookConfig', () => {
  it('keeps Content page sent and leaves out what no webhook sends', async () => {
    const saved = await saveWebhookConfig('brand-1', {
      webhookUrl: 'https://hooks.example/abc',
      events: ['content_draft.sent', 'opportunity.sent', 'content_draft.sent', 'page.deleted'],
    });
    expect(upserts).toEqual([
      expect.objectContaining({ events: ['content_draft.sent', 'opportunity.sent'] }),
    ]);
    expect(saved.events).toEqual(['content_draft.sent', 'opportunity.sent']);
  });

  it('needs one event it sends', async () => {
    await expect(
      saveWebhookConfig('brand-1', { webhookUrl: 'https://hooks.example/abc', events: ['x'] }),
    ).rejects.toThrow('Select at least one webhook event.');
    expect(upserts).toEqual([]);
  });
});
