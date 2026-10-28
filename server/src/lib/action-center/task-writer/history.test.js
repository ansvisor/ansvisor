import { describe, expect, it, vi } from 'vitest';
import { pastRound } from './history.js';

// pastRound reads nothing; the client only has to load without credentials.
vi.mock('../../../config/supabase.js', () => ({ default: {} }));

/**
 * An earlier round as the task writer reads it (learning B5): what was done,
 * what was left, and what the result read; a dismissed one, why.
 */
describe('pastRound', () => {
  it('reads a completed round: its result, its main metric and its tasks', () => {
    expect(
      pastRound(
        {
          status: 'completed',
          outcome: 'improved',
          validation: {
            primary: 'citations',
            metrics: [
              { metric: 'mentions', before: 1, after: 2 },
              { metric: 'citations', before: 4, after: 9 },
            ],
          },
          completed_at: '2026-09-12T08:00:00Z',
        },
        [
          { task_key: 'refresh_content', title: null, status: 'completed' },
          { task_key: null, title: 'Pitch seriouseats.com', status: 'skipped' },
          { task_key: null, title: '  ', status: 'todo' },
        ],
      ),
    ).toEqual({
      closed: '2026-09-12',
      result: 'improved',
      final: false,
      mainMetric: { metric: 'citations', before: 4, after: 9 },
      done: ['Refresh content'],
      notDone: ['Pitch seriouseats.com'],
    });
  });

  it('reads a round not measured yet, and one with no main metric read', () => {
    expect(
      pastRound({ status: 'completed', outcome: null, validation: null, completed_at: null }, []),
    ).toEqual({
      closed: null,
      result: 'pending_measurement',
      final: false,
      mainMetric: null,
      done: [],
      notDone: [],
    });
  });

  it('reads a dismissed round as why it was turned down', () => {
    expect(
      pastRound(
        { status: 'dismissed', dismiss_reason: 'wrong_data', updated_at: '2026-08-02T00:00:00Z' },
        [{ task_key: 'refresh_content', status: 'todo' }],
      ),
    ).toEqual({ closed: '2026-08-02', dismissed: true, reason: 'wrong_data' });
  });
});
