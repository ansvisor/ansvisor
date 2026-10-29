import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Ask your Admin (CHAT-20 §4c, chat_access_requests 00403). */

const ME = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const BRAND = '33333333-3333-4333-8333-333333333333';
const REQUEST = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';

interface Call {
  table: string;
  op: string;
  row?: unknown;
  filters: unknown[][];
}
let calls: Call[] = [];
let role = 'analyst';
/** What each table and operation answers. */
let answers: Record<string, unknown> = {};

function from(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  calls.push(call);
  const answer = () => {
    const found = answers[`${table}.${call.op}`];
    return typeof found === 'function' ? found(call) : (found ?? { data: null, error: null });
  };
  const chain: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      if (opts?.head) call.op = call.op === 'select' ? 'count' : call.op;
      return chain;
    },
    insert: (row: unknown) => Object.assign(call, { op: 'insert', row }) && chain,
    update: (row: unknown) => Object.assign(call, { op: 'update', row }) && chain,
    ...Object.fromEntries(
      ['eq', 'in', 'or', 'order', 'limit'].map((name) => [
        name,
        (...args: unknown[]) => {
          call.filters.push([name, ...args]);
          return chain;
        },
      ]),
    ),
    single: async () => answer(),
    maybeSingle: async () => answer(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (t: string) => from(t) } }));
vi.mock('@/lib/member-emails', () => ({
  readMemberAuth: async (ids: string[]) =>
    new Map(ids.map((id) => [id, { email: `${id.slice(0, 4)}@x.example`, lastSignInAt: null }])),
}));

const {
  countPendingAccessRequests,
  decideAccessRequest,
  listAccessRequests,
  requestAccess,
  withdrawAccessRequest,
} = await import('./chat-access-requests');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  calls = [];
  role = 'analyst';
  answers = {
    'profiles.select': () => ({ data: { organization_id: ORG, role }, error: null }),
    'chat_access_requests.count': { count: 0, error: null },
    'chat_access_requests.insert': { data: { id: REQUEST }, error: null },
  };
});
afterEach(() => vi.unstubAllEnvs());

const ask = {
  asked: 'Add competitors · Peec AI',
  ruleKind: 'role' as const,
  toolKey: 'addCompetitors',
};
const inserted = () => calls.find((c) => c.op === 'insert')?.row as Record<string, unknown>;

describe('requestAccess', () => {
  it("sends the person's request with the rule and a fingerprint of what was asked", async () => {
    answers['brands.select'] = { data: { id: BRAND }, error: null };
    expect(
      await requestAccess({ ...ask, ruleDetail: 'Your role is Analyst.', brandId: BRAND }),
    ).toEqual({ ok: true, id: REQUEST });
    expect(inserted()).toEqual({
      organization_id: ORG,
      requester_id: ME,
      brand_id: BRAND,
      conversation_id: null,
      asked: 'Add competitors · Peec AI',
      asked_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      tool_key: 'addCompetitors',
      rule_kind: 'role',
      rule_detail: 'Your role is Analyst.',
      drafted_change: null,
    });
  });

  it('asks the same change once: the fingerprint ignores case and spacing', async () => {
    await requestAccess(ask);
    const first = inserted().asked_hash;
    calls = [];
    await requestAccess({ ...ask, asked: '  add competitors ·  PEEC AI ' });
    expect(inserted().asked_hash).toBe(first);
    calls = [];
    await requestAccess({ ...ask, toolKey: 'saveDraft' });
    expect(inserted().asked_hash).not.toBe(first);
  });

  it("drops a brand or a chat that isn't the person's", async () => {
    answers['brands.select'] = { data: null, error: null };
    answers['chat_conversations.select'] = { data: null, error: null };
    await requestAccess({ ...ask, brandId: BRAND, conversationId: OTHER });
    expect(inserted()).toMatchObject({ brand_id: null, conversation_id: null });
    const conversation = calls.find((c) => c.table === 'chat_conversations')!;
    expect(conversation.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'user_id', ME],
        ['eq', 'organization_id', ORG],
      ]),
    );
  });

  it('refuses past ten waiting requests, and the same ask twice a day', async () => {
    answers['chat_access_requests.count'] = { count: 10, error: null };
    expect(await requestAccess(ask)).toEqual({ ok: false, reason: 'too_many' });
    expect(inserted()).toBeUndefined();
    answers['chat_access_requests.count'] = { count: 3, error: null };
    answers['chat_access_requests.insert'] = {
      data: null,
      error: { code: '23505', message: 'dup' },
    };
    expect(await requestAccess(ask)).toEqual({ ok: false, reason: 'already_today' });
  });

  it('turns an Admin away, and does nothing while Chat is off or for a bad ask', async () => {
    role = 'admin';
    expect(await requestAccess(ask)).toEqual({ ok: false, reason: 'admin' });
    role = 'manager';
    expect(await requestAccess({ ...ask, asked: '   ' })).toEqual({ ok: false, reason: 'invalid' });
    expect(await requestAccess({ ...ask, ruleKind: 'nope' as never })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await requestAccess(ask)).toEqual({ ok: false, reason: 'chat_off' });
    expect(inserted()).toBeUndefined();
  });
});

describe('withdrawAccessRequest and decideAccessRequest', () => {
  it('withdraws only the person’s own waiting request', async () => {
    answers['chat_access_requests.update'] = { data: [{ id: REQUEST }], error: null };
    expect(await withdrawAccessRequest(REQUEST)).toBe(true);
    const update = calls.find((c) => c.op === 'update')!;
    expect(update.row).toMatchObject({ status: 'withdrawn', decided_by: ME });
    expect(update.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'requester_id', ME],
        ['eq', 'status', 'pending'],
      ]),
    );
    answers['chat_access_requests.update'] = { data: [], error: null };
    expect(await withdrawAccessRequest(REQUEST)).toBe(false);
    expect(await withdrawAccessRequest('not-an-id')).toBe(false);
  });

  it("lets the first Admin decide a workspace's waiting request", async () => {
    role = 'admin';
    answers['chat_access_requests.update'] = { data: [{ id: REQUEST }], error: null };
    expect(await decideAccessRequest(REQUEST, 'approved')).toBe(true);
    const update = calls.find((c) => c.op === 'update')!;
    expect(update.row).toMatchObject({ status: 'approved', decided_by: ME });
    expect(update.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'organization_id', ORG],
        ['eq', 'status', 'pending'],
      ]),
    );
    answers['chat_access_requests.update'] = { data: [], error: null };
    expect(await decideAccessRequest(REQUEST, 'rejected')).toBe(false);
  });

  it('refuses anyone but an Admin a decision', async () => {
    role = 'manager';
    await expect(decideAccessRequest(REQUEST, 'approved')).rejects.toThrow(/Only Admins/);
  });
});

describe('listAccessRequests and countPendingAccessRequests', () => {
  const row = (id: string, requester: string, status: string, created_at: string) => ({
    id,
    requester_id: requester,
    asked: 'Upgrade to Growth',
    tool_key: null,
    rule_kind: 'plan',
    rule_detail: "Needs Growth · you're on Starter",
    status,
    created_at,
    decided_at: status === 'pending' ? null : created_at,
  });

  it("gives an Admin the workspace's requests, waiting ones first, with who asked", async () => {
    role = 'admin';
    answers['chat_access_requests.select'] = {
      data: [
        row('r2', OTHER, 'approved', '2026-10-29T10:00:00Z'),
        row('r1', OTHER, 'pending', '2026-10-28T10:00:00Z'),
      ],
      error: null,
    };
    answers['profiles.select'] = (call: Call) =>
      call.filters.some((f) => f[0] === 'in')
        ? { data: [{ id: OTHER, full_name: 'Taylor Brooks' }], error: null }
        : { data: { organization_id: ORG, role }, error: null };
    const listed = await listAccessRequests();
    expect(listed?.isAdmin).toBe(true);
    expect(listed?.requests.map((r) => [r.id, r.status, r.requester])).toEqual([
      ['r1', 'pending', 'Taylor Brooks'],
      ['r2', 'approved', 'Taylor Brooks'],
    ]);
    const read = calls.find((c) => c.table === 'chat_access_requests')!;
    expect(read.filters.some((f) => f[0] === 'eq' && f[1] === 'requester_id')).toBe(false);
  });

  it('gives anyone else only their own', async () => {
    answers['chat_access_requests.select'] = { data: [], error: null };
    await listAccessRequests();
    const read = calls.find((c) => c.table === 'chat_access_requests')!;
    expect(read.filters).toContainEqual(['eq', 'requester_id', ME]);
  });

  it('counts the waiting requests for an Admin only', async () => {
    answers['chat_access_requests.count'] = { count: 3, error: null };
    expect(await countPendingAccessRequests()).toBe(0);
    role = 'admin';
    expect(await countPendingAccessRequests()).toBe(3);
  });
});
