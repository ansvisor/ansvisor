import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /analyze-new with the prompt ids a bulk import sends (up to 1,000).
 * One PostgREST `in` filter over that many ids fails, and the route used to
 * read the failure as "nothing new", so a large import never got its first
 * analysis. These pin that every `in` filter stays at 100 ids and that a
 * failed lookup is an error, not `newCount: 0`.
 */

const createJob = vi.fn();
const runTrackingJob = vi.fn();

let inSizes = [];
let failTable = null;

function builder(table) {
  const filters = {};
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: (column, values) => {
      inSizes.push({ table, column, size: values.length });
      filters[column] = values;
      return chain;
    },
    single: async () => {
      if (table === 'brands') {
        return { data: { id: 'b1', organization_id: 'org-1', is_active: true }, error: null };
      }
      if (table === 'profiles') return { data: { organization_id: 'org-1' }, error: null };
      return { data: null, error: null };
    },
    then: (resolve) => {
      if (table === failTable) return resolve({ data: null, error: new Error('URI too long') });
      if (table === 'prompt_sets') return resolve({ data: [{ id: 'set-1' }], error: null });
      if (table === 'prompts') {
        return resolve({ data: (filters.id ?? []).map((id) => ({ id })), error: null });
      }
      // No prompt has results yet: every imported prompt is new.
      return resolve({ data: [], error: null });
    },
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (table) => builder(table) } }));
vi.mock('../lib/job-manager.js', () => ({ createJob, getJob: vi.fn(), cancelJob: vi.fn() }));
vi.mock('../lib/job-runner.js', () => ({ runTrackingJob }));
vi.mock('../lib/tracking-quota.js', () => ({
  enforceOnDemandTrackingQuota: vi.fn(),
  TrackingQuotaError: class TrackingQuotaError extends Error {},
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: vi.fn() }));

const { default: router } = await import('./tracking.js');

const handler = router.stack.find((layer) => layer.route?.path === '/analyze-new').route.stack[0]
  .handle;

async function analyzeNew(body) {
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
  const req = {
    body,
    user: { id: 'u1' },
    log: { error: vi.fn() },
    app: { get: () => null },
  };
  await handler(req, res);
  return res;
}

const ids = Array.from(
  { length: 1000 },
  (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
);

describe('POST /analyze-new', () => {
  beforeEach(() => {
    inSizes = [];
    failTable = null;
    createJob.mockReset().mockResolvedValue({ id: 'job-1' });
    runTrackingJob.mockReset();
  });

  it('submits all 1,000 imported prompts with no `in` filter over 100 ids', async () => {
    const res = await analyzeNew({ brandId: 'b1', promptIds: ids });

    expect(res.body).toMatchObject({ success: true, jobId: 'job-1', newCount: 1000 });
    expect(createJob.mock.calls[0][0].data.promptIds).toHaveLength(1000);
    const idFilters = inSizes.filter((f) => f.column !== 'prompt_set_id');
    expect(idFilters.length).toBeGreaterThanOrEqual(20);
    expect(Math.max(...idFilters.map((f) => f.size))).toBeLessThanOrEqual(100);
  });

  it('fails instead of reporting nothing new when a lookup errors', async () => {
    failTable = 'prompt_results';

    const res = await analyzeNew({ brandId: 'b1', promptIds: ids });

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ success: false });
    expect(createJob).not.toHaveBeenCalled();
  });
});
