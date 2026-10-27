// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/agent/chat on a read-only workspace (Ansvisor Cloud, plan not
 * active): a chat turn is an action, so it answers 402 subscription_inactive
 * before anything else; an active plan, or self-hosted, goes on to the
 * conversation check.
 */

let status: string | null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        // No conversation: past the gate, the route answers 404.
        maybeSingle: async () => ({
          data: table === 'organizations' ? { subscription_status: status, plan: 'starter' } : null,
          error: null,
        }),
      };
      return query;
    },
  },
}));
vi.mock('@/lib/agent/auth', () => ({
  resolveAgentAuth: async () => ({
    userId: 'user-1',
    email: 'a@example.com',
    organizationId: 'org-1',
    apiKeyId: 'agent-internal',
  }),
}));
vi.mock('@/lib/agent/tools', () => ({ buildAgentTools: vi.fn() }));
vi.mock('@/lib/agent/model', () => ({ AGENT_PROVIDER_OPTIONS: {}, buildAgentModel: vi.fn() }));
vi.mock('@/lib/agent/key', () => ({ resolveAgentModelConfig: vi.fn() }));
vi.mock('@/lib/agent/token-quota', () => ({ recordAgentTokenUsage: vi.fn() }));
vi.mock('@/lib/agent/system-prompt', () => ({ buildAgentSystemPrompt: vi.fn() }));

const { POST } = await import('./route');

const chat = () =>
  POST(
    new Request('http://localhost/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conversation-1',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      }),
    }),
  );

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  status = 'canceled';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/agent/chat', () => {
  it('answers 402 subscription_inactive while the workspace is read-only', async () => {
    const res = await chat();
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: 'plan_limit',
      code: 'subscription_inactive',
      message: expect.any(String),
    });
  });

  it('goes on to the conversation once the plan is active', async () => {
    status = 'active';
    const res = await chat();
    expect(res.status).toBe(404);
  });

  it('never gates self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    const res = await chat();
    expect(res.status).toBe(404);
  });
});
