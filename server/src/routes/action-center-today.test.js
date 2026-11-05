import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/action-center/today (AC-011): the Today card's order for the
 * caller, after the brand access check, read by lib/action-center/today.js.
 */

vi.mock('../config/supabase.js', () => ({ default: { name: 'admin' } }));
const assertBrandAccess = vi.fn();
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
const readToday = vi.fn();
vi.mock('../lib/action-center/today.js', () => ({ readToday: (...args) => readToday(...args) }));
vi.mock('../lib/action-center/priority-data.js', () => ({ rescoreActionsForSignal: vi.fn() }));
vi.mock('../lib/plan-guard.js', () => ({
  PlanLimitError: class extends Error {},
  requireFeature: () => (_req, _res, next) => next(),
}));
vi.mock('../lib/action-center/task-writer/index.js', () => ({
  TaskWriterError: class extends Error {},
  isTaskWriterEnabled: () => false,
  writeTasksForAction: vi.fn(),
}));
vi.mock('../lib/action-center/task-send.js', () => ({
  TaskSendError: class extends Error {},
  loadTask: vi.fn(),
  sendTaskToContent: vi.fn(),
  sendTaskToWebhook: vi.fn(),
}));

const { default: router } = await import('./action-center.js');

const BRAND = '22222222-2222-2222-2222-222222222222';

async function getToday(query) {
  const handle = router.stack.find(
    (layer) => layer.route?.path === '/today' && layer.route.methods.get,
  ).route.stack[0].handle;
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const log = { error: vi.fn() };
  await handle({ query, user: { id: 'u1' }, log }, res);
  return { res, log };
}

beforeEach(() => {
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'org-1', role: 'analyst' });
  readToday
    .mockReset()
    .mockResolvedValue({ today: [{ id: 'a1', suggested: true }], next: [{ id: 'a2' }] });
});

describe('GET /today', () => {
  it('reads the caller’s Today for a brand they can see, whatever their role', async () => {
    const { res } = await getToday({ brandId: BRAND });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ today: [{ id: 'a1', suggested: true }], next: [{ id: 'a2' }] });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(readToday).toHaveBeenCalledWith(
      { name: 'admin' },
      expect.objectContaining({ orgId: 'org-1', brandId: BRAND, userId: 'u1' }),
    );
  });

  it('refuses a brand id that can’t be one, before reading anything', async () => {
    const { res } = await getToday({ brandId: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(assertBrandAccess).not.toHaveBeenCalled();
    expect(readToday).not.toHaveBeenCalled();
  });

  it('answers a brand the caller can’t see with its access error, and reads nothing', async () => {
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error('Brand not found'), { status: 404 }),
    );
    const { res, log } = await getToday({ brandId: BRAND });
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('Brand not found');
    expect(readToday).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs a failed read and says so without its details', async () => {
    readToday.mockRejectedValue(Object.assign(new Error('actions read failed'), { code: '57014' }));
    const { res, log } = await getToday({ brandId: BRAND });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to read today.', code: undefined });
    expect(log.error).toHaveBeenCalled();
  });
});
