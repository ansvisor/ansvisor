import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Removing a member: their profile leaves the organization, and the author
 * they were (Settings › Authors) is no longer linked to them, since only they
 * could unlink themself from a session.
 */

const ADMIN = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';

interface Call {
  table: string;
  op: string;
  row?: unknown;
  filters: [string, unknown][];
}
const sessionCalls: Call[] = [];
let adminCalls: Call[] = [];
/** What a write of each table answers through the service client. */
let adminAnswers: Record<string, { data: unknown; error: null | { message: string } }> = {};

function builder(calls: Call[], answerOf: (call: Call) => unknown) {
  return (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const chain = {
      select: () => chain,
      update: (row: unknown) => Object.assign(call, { op: 'update', row }) && chain,
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return chain;
      },
      single: async () => answerOf(call),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answerOf(call)).then(resolve),
    };
    return chain;
  };
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/member-emails', () => ({ readMemberEmails: vi.fn() }));
vi.mock('@/lib/guards/plan-guard', () => ({ enforceLimit: vi.fn(), getOrgPlan: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ADMIN } } }) },
    from: builder(sessionCalls, () => ({
      data: { id: ADMIN, role: 'admin', organization_id: ORG },
      error: null,
    })),
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) =>
      builder(
        adminCalls,
        (call) => adminAnswers[`${call.table}.${call.op}`] ?? { data: null, error: null },
      )(table),
  },
}));

const { removeMember } = await import('./team');

beforeEach(() => {
  sessionCalls.length = 0;
  adminCalls = [];
  adminAnswers = {};
});

describe('removeMember', () => {
  it('takes the member out of the organization and unlinks the author they were', async () => {
    await removeMember(MEMBER);

    expect(adminCalls).toEqual([
      {
        table: 'profiles',
        op: 'update',
        row: { organization_id: null },
        filters: [
          ['id', MEMBER],
          ['organization_id', ORG],
        ],
      },
      {
        table: 'content_authors',
        op: 'update',
        row: { user_id: null },
        filters: [
          ['organization_id', ORG],
          ['user_id', MEMBER],
        ],
      },
    ]);
  });

  it('leaves the author linked when the member could not be removed', async () => {
    adminAnswers['profiles.update'] = { data: null, error: { message: 'boom' } };

    await expect(removeMember(MEMBER)).rejects.toThrow('boom');
    expect(adminCalls.map((c) => c.table)).toEqual(['profiles']);
  });

  it('says so when the author link could not be cleared', async () => {
    adminAnswers['content_authors.update'] = { data: null, error: { message: 'denied' } };

    await expect(removeMember(MEMBER)).rejects.toThrow('denied');
  });

  it('refuses to remove yourself', async () => {
    await expect(removeMember(ADMIN)).rejects.toThrow('You cannot remove yourself');
    expect(adminCalls).toEqual([]);
  });
});
