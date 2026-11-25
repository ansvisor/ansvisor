import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ claimed: new Set(), error: null, updates: [] }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: () => ({
      upsert: (row) => ({
        select: async () => {
          if (db.error) return { data: null, error: db.error };
          const key = `${row.kind}|${row.user_id}|${row.subject}`;
          if (db.claimed.has(key)) return { data: [], error: null };
          db.claimed.add(key);
          return { data: [{ id: key }], error: null };
        },
      }),
      update: (values) => {
        const chain = { eq: () => chain, then: (resolve) => resolve({ error: null }) };
        db.updates.push(values);
        return chain;
      },
    }),
  },
}));

const { claimSend, dayKey, markSent, weekKey } = await import('./sends.js');

beforeEach(() => {
  db.claimed = new Set();
  db.error = null;
  db.updates = [];
});

describe('each notification e-mail once (00556)', () => {
  const send = { kind: 'critical_action', userId: 'ana', brandId: 'b1', subject: 'action:a1' };

  it('claims an e-mail once', async () => {
    expect(await claimSend(send)).toBe(true);
    expect(await claimSend(send)).toBe(false);
    expect(await claimSend({ ...send, userId: 'bo' })).toBe(true);
    await markSent(send);
    expect(db.updates[0]).toEqual({ sent_at: expect.any(String) });
  });

  it('claims nothing without 00556, and throws any other error', async () => {
    db.error = { code: 'PGRST205', message: 'missing' };
    expect(await claimSend(send)).toBe(false);
    db.error = { code: 'XX000', message: 'boom' };
    await expect(claimSend(send)).rejects.toThrow('boom');
  });

  it('keys a day and its week by their UTC date and Monday', () => {
    expect(dayKey(new Date('2026-11-20T23:30:00Z'))).toBe('2026-11-20');
    expect(weekKey(new Date('2026-11-20T10:00:00Z'))).toBe('2026-11-16');
    expect(weekKey(new Date('2026-11-16T00:00:00Z'))).toBe('2026-11-16');
    expect(weekKey(new Date('2026-11-22T23:00:00Z'))).toBe('2026-11-16');
  });
});
