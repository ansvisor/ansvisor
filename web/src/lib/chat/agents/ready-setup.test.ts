// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The person's work areas Agent Center's Ready to use puts first (Settings ›
 * Menu access, 00374): read from their own profile, only the work areas
 * there are, none when saved before WORK_AREAS_RESET_AT, and none when they
 * can't be read.
 */

const PICKED = {
  work_areas: ['content', 'nope', 'growth'],
  work_areas_asked_at: '2026-11-12T09:00:00Z',
};

const db = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  row: null as Record<string, unknown> | null,
  error: null as { message: string } | null,
  asked: [] as string[],
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => {
          db.asked.push(`${table}.${columns} ${column}=${value}`);
          return { maybeSingle: async () => ({ data: db.row, error: db.error }) };
        },
      }),
    }),
  }),
}));
vi.mock('../run-api', () => ({ chatActor: vi.fn() }));
vi.mock('../agents', () => ({ readAgentContext: vi.fn() }));

const { readMyWorkAreas } = await import('./ready-setup');

beforeEach(() => {
  db.user = { id: 'user-1' };
  db.row = PICKED;
  db.error = null;
  db.asked = [];
});

describe('readMyWorkAreas', () => {
  it('reads the person’s own work areas, the known ones in their order', async () => {
    expect(await readMyWorkAreas()).toEqual(['content', 'growth']);
    expect(db.asked).toEqual(['profiles.work_areas, work_areas_asked_at id=user-1']);
  });

  it('is none when skipped, saved before the reset, signed out or unreadable', async () => {
    db.row = { work_areas: null, work_areas_asked_at: null };
    expect(await readMyWorkAreas()).toEqual([]);
    // The old "What do you work on?" answer: Everything now.
    db.row = { ...PICKED, work_areas_asked_at: '2026-10-28T10:00:00Z' };
    expect(await readMyWorkAreas()).toEqual([]);
    db.user = null;
    expect(await readMyWorkAreas()).toEqual([]);
    db.user = { id: 'user-1' };
    db.error = { message: 'down' };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readMyWorkAreas()).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
