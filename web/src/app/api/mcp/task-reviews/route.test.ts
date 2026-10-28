// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The REST mirrors of the task review tools: GET /api/mcp/task-reviews,
 * POST /api/mcp/task-reviews/[id]/approve and /dismiss, with a status for
 * each refusal.
 */

const reviews = vi.hoisted(() => ({
  listTaskReviewsFor: vi.fn(),
  approveTaskReviewFor: vi.fn(),
  dismissTaskReviewFor: vi.fn(),
}));
vi.mock('@/lib/mcp-auth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/mcp/task-reviews', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/task-reviews')>()),
  ...reviews,
}));

const list = await import('./route');
const approve = await import('./[id]/approve/route');
const dismiss = await import('./[id]/dismiss/route');

const params = { params: Promise.resolve({ id: 'review-1' }) };
const post = (path: string, body?: unknown) =>
  new Request(`http://localhost/api/mcp/task-reviews/review-1/${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/mcp/task-reviews', () => {
  it("answers the brand's reviews, 403 for a member who can't review, 404 for another brand", async () => {
    const get = () =>
      list.GET(new Request('http://localhost/api/mcp/task-reviews?brand_id=brand-1'));
    reviews.listTaskReviewsFor.mockResolvedValue([{ id: 'review-1' }]);
    expect(await (await get()).json()).toEqual({ reviews: [{ id: 'review-1' }] });
    reviews.listTaskReviewsFor.mockResolvedValue({ error: 'forbidden', message: 'No' });
    expect((await get()).status).toBe(403);
    reviews.listTaskReviewsFor.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });

  it('asks for a brand', async () => {
    const res = await list.GET(new Request('http://localhost/api/mcp/task-reviews'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/mcp/task-reviews/[id]/approve', () => {
  it('approves with the fields in the body', async () => {
    reviews.approveTaskReviewFor.mockResolvedValue({ task_id: 'task-9' });
    const res = await approve.POST(
      post('approve', { url: '/pricing', change: { after: 'FAQ' }, check: 'auto' }),
      params,
    );
    expect(res.status).toBe(201);
    expect(reviews.approveTaskReviewFor).toHaveBeenCalledWith(expect.anything(), 'review-1', {
      url: '/pricing',
      change: { after: 'FAQ' },
      check: 'auto',
    });
  });

  it('refuses a body it cannot read, before approving', async () => {
    const res = await approve.POST(post('approve', { check: 'sometimes' }), params);
    expect(res.status).toBe(400);
    expect(reviews.approveTaskReviewFor).not.toHaveBeenCalled();
  });

  it('answers each refusal with its status', async () => {
    for (const [error, status] of [
      ['forbidden', 403],
      ['missing', 404],
      ['closed', 409],
      ['incomplete', 422],
    ] as const) {
      reviews.approveTaskReviewFor.mockResolvedValue({ error, message: error });
      const res = await approve.POST(post('approve', {}), params);
      expect(res.status, error).toBe(status);
      expect(await res.json()).toEqual({ error, code: error });
    }
  });
});

describe('POST /api/mcp/task-reviews/[id]/dismiss', () => {
  it('dismisses, or says why not', async () => {
    reviews.dismissTaskReviewFor.mockResolvedValue({ id: 'review-1', dismissed: true });
    expect(await (await dismiss.POST(post('dismiss'), params)).json()).toEqual({
      id: 'review-1',
      dismissed: true,
    });
    reviews.dismissTaskReviewFor.mockResolvedValue({ error: 'forbidden', message: 'No' });
    expect((await dismiss.POST(post('dismiss'), params)).status).toBe(403);
  });
});
