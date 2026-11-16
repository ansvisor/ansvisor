// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slack's Approve and Reject through the API server (#2139, N7): POST
 * /api/internal/chat/slack/card and /decide, with CHAT_INTERNAL_SECRET. Not
 * there with the new Chat off; 401 without the secret; a read-only
 * workspace is refused before the card is read; the run goes on past the
 * answer.
 */

const fakes = vi.hoisted(() => ({
  read: vi.fn(),
  decide: vi.fn(),
  active: vi.fn(),
  after: vi.fn(),
}));
vi.mock('@/lib/chat/slack-approval', () => ({
  readSlackCard: fakes.read,
  decideFromSlack: fakes.decide,
}));
vi.mock('@/lib/mcp/subscription-gate', () => ({ subscriptionActiveFor: fakes.active }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: fakes.after,
}));

const decide = await import('./route');
const card = await import('../card/route');

const SECRET = 'a-long-shared-secret';
const REF = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  brandId: '22222222-2222-4222-8222-222222222222',
  agentRunId: '33333333-3333-4333-8333-333333333333',
};
const DECISION = {
  ...REF,
  userId: '77777777-7777-4777-8777-777777777777',
  decision: 'approve',
  n: 3,
  digest: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
};

const post = (
  handler: (req: Request) => Promise<Response>,
  body: unknown,
  auth: string | null = `Bearer ${SECRET}`,
) =>
  handler(
    new Request('http://localhost/api/internal/chat/slack/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_INTERNAL_SECRET', SECRET);
  fakes.active.mockResolvedValue(true);
  fakes.read.mockResolvedValue({ state: 'waiting', n: 3 });
  fakes.decide.mockImplementation(async (_ref, _input, background) => {
    background(async () => {});
    return { outcome: 'approved', card: { state: 'waiting' } };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/internal/chat/slack/decide', () => {
  it('decides as the person the server matched, and drives the run past the answer', async () => {
    const res = await post(decide.POST, DECISION);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      decision: { outcome: 'approved', card: { state: 'waiting' } },
    });
    const { userId, decision, n, digest } = DECISION;
    expect(fakes.decide).toHaveBeenCalledWith(
      REF,
      { userId, decision, n, digest },
      expect.any(Function),
    );
    expect(fakes.after).toHaveBeenCalledOnce();
  });

  it('refuses a read-only workspace before anything is read', async () => {
    fakes.active.mockResolvedValue(false);
    expect(await (await post(decide.POST, DECISION)).json()).toEqual({
      ok: true,
      decision: { outcome: 'refused', reason: 'read_only', card: null },
    });
    expect(fakes.decide).not.toHaveBeenCalled();
  });

  it('is not there with Chat off, refuses a missing or wrong secret and a bad body', async () => {
    expect((await post(decide.POST, DECISION, null)).status).toBe(401);
    expect((await post(decide.POST, DECISION, 'Bearer wrong')).status).toBe(401);
    expect((await post(decide.POST, { ...DECISION, decision: 'maybe' })).status).toBe(400);
    expect((await post(decide.POST, { ...DECISION, organizationId: 'org' })).status).toBe(400);
    vi.stubEnv('CHAT_AGENTIC', '');
    expect((await post(decide.POST, DECISION)).status).toBe(404);
    expect(fakes.decide).not.toHaveBeenCalled();
  });
});

describe('POST /api/internal/chat/slack/card', () => {
  it('reads the card, with the step the message showed', async () => {
    const res = await post(card.POST, { ...REF, n: 3 });
    expect(await res.json()).toEqual({ ok: true, card: { state: 'waiting', n: 3 } });
    expect(fakes.read).toHaveBeenCalledWith(REF, 3);
    fakes.read.mockResolvedValue(null);
    expect((await post(card.POST, REF)).status).toBe(404);
    expect((await post(card.POST, REF, null)).status).toBe(401);
  });
});
