import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';

/**
 * Route-level tests for volume analysis.
 *
 * The unit tests around analyzeBrandVolumes cover which prompts get analyzed.
 * What only shows up here is the contract the Prompts page depends on: that a
 * brand of any size is accepted, that the answer comes back before the run
 * does, and that a second click cannot start a second pass.
 */

class PlanLimitError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = 'PlanLimitError';
    this.statusCode = statusCode;
  }
}

const enforceVolumeQuota = vi.fn();
const assertBrandAccess = vi.fn();
const getVolumeProgress = vi.fn();
const analyzeBrandVolumes = vi.fn();
const insert = vi.fn();

/** Lets a test hold a run open and decide exactly when it ends. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('../lib/plan-guard.js', () => ({
    PlanLimitError,
    enforceVolumeQuota,
    getVolumeQuotaStatus: vi.fn(),
    requireFeature: () => (req, res, next) => next(),
  }));
  vi.doMock('../lib/access.js', () => ({
    assertBrandAccess,
    assertPromptAccess: vi.fn(),
  }));
  vi.doMock('../lib/volume-analysis.js', () => ({
    getVolumeProgress,
    analyzeBrandVolumes,
    mapVolumeRow: (r) => r,
    fetchAndSaveVolumes: vi.fn(),
  }));
  vi.doMock('../config/supabase.js', () => ({ default: { from: () => ({ insert }) } }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });
  vi.doMock('../lib/ai-provider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/dataforseo-codes.js', () => ({
    regionToLocationCode: vi.fn(),
    languageToCode: vi.fn(),
  }));

  const { default: router } = await import('./volumes.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/volumes', router);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/volumes`;
}

const post = (body) =>
  fetch(`${baseUrl}/analyze-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  enforceVolumeQuota.mockResolvedValue({ remaining: -1, orgId: 'org1' });
  assertBrandAccess.mockResolvedValue(undefined);
  getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 0 });
  analyzeBrandVolumes.mockResolvedValue([]);
  insert.mockResolvedValue({ error: null });
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /analyze-batch', () => {
  // The failure this whole change exists for: the route used to refuse more
  // than 50 prompts, so the page's own "Analyze 100 prompts" button returned
  // 400 every time.
  it('accepts a brand with 100 prompts', async () => {
    const res = await post({ brandId: 'b1' });

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ started: 100, running: true });
  });

  it('answers before the run finishes, not after', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);

    const res = await post({ brandId: 'b1' });

    // The response is already here while the run is still outstanding — an
    // eleven-minute request would be cut long before this point.
    expect(res.status).toBe(202);
    run.resolve([]);
  });

  it('starts only the prompts that have no volumes yet', async () => {
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 60 });

    expect(await (await post({ brandId: 'b1' })).json()).toMatchObject({ started: 40 });
    expect(analyzeBrandVolumes).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ onlyMissing: true }),
    );
  });

  it('starts every active prompt under force', async () => {
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 60 });

    expect(await (await post({ brandId: 'b1', force: true })).json()).toMatchObject({
      started: 100,
    });
    expect(analyzeBrandVolumes).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ force: true, onlyMissing: false }),
    );
  });

  it('does nothing when every active prompt already has volumes', async () => {
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 100 });

    const res = await post({ brandId: 'b1' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ started: 0, running: false });
    expect(analyzeBrandVolumes).not.toHaveBeenCalled();
  });

  // Two clicks would otherwise analyze every prompt twice and bill the quota
  // twice. The claim is taken before the first await for exactly this reason.
  it('refuses to start a second run while one is in flight', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);

    await post({ brandId: 'b1' });
    const second = await post({ brandId: 'b1' });

    expect(second.status).toBe(202);
    expect(await second.json()).toMatchObject({ started: 0, running: true });
    expect(analyzeBrandVolumes).toHaveBeenCalledTimes(1);

    run.resolve([]);
  });

  // Sequential clicks are the easy case. Two arriving together are the real
  // one: reading "not running" and then awaiting the progress count leaves a
  // gap both requests pass through, and the brand gets analyzed twice.
  it('refuses a second run even when both clicks arrive together', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);
    // The progress read is what yields control between the check and the claim.
    getVolumeProgress.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ total: 100, analyzed: 0 }), 5)),
    );

    const [a, b] = await Promise.all([post({ brandId: 'b1' }), post({ brandId: 'b1' })]);
    const bodies = [await a.json(), await b.json()];

    expect(analyzeBrandVolumes).toHaveBeenCalledTimes(1);
    expect(bodies.filter((x) => x.started > 0)).toHaveLength(1);

    run.resolve([]);
  });

  it('holds no claim against a different brand', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);

    await post({ brandId: 'b1' });
    await post({ brandId: 'b2' });

    expect(analyzeBrandVolumes).toHaveBeenCalledTimes(2);
    run.resolve([]);
  });

  it('lets the brand start again once the run has ended', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);
    await post({ brandId: 'b1' });

    run.resolve([]);
    await new Promise((resolve) => setTimeout(resolve, 10));

    analyzeBrandVolumes.mockResolvedValue([]);
    const again = await post({ brandId: 'b1' });
    expect(await again.json()).toMatchObject({ started: 100, running: true });
    expect(analyzeBrandVolumes).toHaveBeenCalledTimes(2);
  });

  // A failed run must not leave the brand permanently claimed — the next click
  // would report "already running" forever with nothing running.
  it('releases the claim when the run fails', async () => {
    analyzeBrandVolumes.mockRejectedValueOnce(new Error('upstream down'));
    await post({ brandId: 'b1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    analyzeBrandVolumes.mockResolvedValue([]);
    expect(await (await post({ brandId: 'b1' })).json()).toMatchObject({ started: 100 });
  });

  it('releases the claim when the progress read fails', async () => {
    getVolumeProgress.mockRejectedValueOnce(new Error('db blip'));
    expect((await post({ brandId: 'b1' })).status).toBe(500);

    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 0 });
    expect(await (await post({ brandId: 'b1' })).json()).toMatchObject({ started: 100 });
  });

  it('requires a brand', async () => {
    expect((await post({})).status).toBe(400);
  });

  // The page distinguishes this from a generic failure so it can offer the
  // upgrade wording; it has to arrive as a code, not as prose.
  it('reports an exhausted quota as quota_exceeded', async () => {
    enforceVolumeQuota.mockRejectedValueOnce(new PlanLimitError('Monthly limit reached (4/4).'));

    const res = await post({ brandId: 'b1' });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('quota_exceeded');
  });

  it('bills the quota once per run, not once per prompt', async () => {
    analyzeBrandVolumes.mockResolvedValue([
      { promptId: 'p1' },
      { promptId: 'p2' },
      { promptId: 'p3' },
    ]);

    await post({ brandId: 'b1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ prompt_count: 3 }));
  });

  it('bills nothing when every prompt in the run failed', async () => {
    analyzeBrandVolumes.mockResolvedValue([{ promptId: 'p1', error: 'boom' }]);

    await post({ brandId: 'b1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(insert).not.toHaveBeenCalled();
  });
});

describe('GET /status/:brandId', () => {
  it('reports progress and whether a run is in flight', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);
    await post({ brandId: 'b1' });

    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 32 });
    const res = await fetch(`${baseUrl}/status/b1`);

    expect(await res.json()).toEqual({ running: true, total: 100, analyzed: 32 });
    run.resolve([]);
  });

  it('reports a brand with no run as stopped', async () => {
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 100 });

    expect(await (await fetch(`${baseUrl}/status/b1`)).json()).toEqual({
      running: false,
      total: 100,
      analyzed: 100,
    });
  });
});
