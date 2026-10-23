import { describe, expect, it, vi } from 'vitest';

// record.js reaches the admin client at import time, whose config hard-exits
// without SUPABASE_* env (as in CI). Its `from` is replaced per test below.
vi.mock('../../config/supabase.js', () => ({ default: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../pulse/metrics.js', () => ({ computePulseMetrics: vi.fn() }));

import supabaseAdmin from '../../config/supabase.js';
import { auditCandidates } from './record.js';
import { ENGINE_THRESHOLDS } from '../../config/action-engine.js';

const { auditLowScore } = ENGINE_THRESHOLDS.detection;

const now = new Date('2026-10-23T06:00:00.000Z');

/** site_audits in miniature: every chained filter passes, the rows come back as given. */
function serve(rows) {
  const query = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'then'
          ? (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject)
          : () => query,
    },
  );
  supabaseAdmin.from.mockReturnValue(query);
}

const audit = (i, score) => ({
  url: `https://acme.example/p${i}`,
  total_score: score,
  completed_at: now.toISOString(),
});

/** Site Audit's low pages (AC-009): the ten lowest to show, every address past them. */
describe('auditCandidates', () => {
  it('lists no addresses beside the ten it shows', async () => {
    serve(Array.from({ length: 10 }, (_, i) => audit(i, auditLowScore - 1 - i)));
    const [signal] = await auditCandidates('b1', now);
    expect(signal.payload.urls).toHaveLength(10);
    expect(signal.payload).not.toHaveProperty('targetIds');
  });

  it('lists every low page’s address past them', async () => {
    serve(Array.from({ length: 12 }, (_, i) => audit(i, auditLowScore - 1 - i)));
    const [signal] = await auditCandidates('b1', now);
    expect(signal.payload.urls).toHaveLength(10);
    expect(signal.payload.targetIds).toHaveLength(12);
    expect(signal.currentValue).toBe(12);
  });
});
