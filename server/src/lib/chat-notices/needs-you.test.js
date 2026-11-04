import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Telling a person an agent's run waits for them (00474): the person the run
 * acts as, when they reach its brand, one e-mail by their "Notify me when an
 * agent needs me", once per run, and a notice row that records it.
 */

const db = vi.hoisted(() => ({ tables: {} }));
const deliverEmail = vi.hoisted(() => vi.fn(async () => 'sent'));
const readers = vi.hoisted(() => ({ value: new Map() }));

/** A query on the in-memory tables: filters, an upsert, and select. */
function query(table) {
  const filters = [];
  let upsert = null;
  let one = false;
  const chain = {
    select: () => chain,
    eq: (col, val) => (filters.push((r) => r[col] === val), chain),
    in: (col, vals) => (filters.push((r) => vals.includes(r[col])), chain),
    limit: () => chain,
    upsert: (rows) => ((upsert = rows), chain),
    maybeSingle: () => ((one = true), chain),
    then: (resolve) => {
      const rows = (db.tables[table] ??= []);
      if (upsert) {
        const written = [];
        for (const row of upsert) {
          if (rows.some((r) => r.user_id === row.user_id && r.dedupe_key === row.dedupe_key)) {
            continue;
          }
          rows.push(row);
          written.push(row);
        }
        return resolve({ data: written, error: null });
      }
      const found = rows.filter((r) => filters.every((f) => f(r)));
      return resolve({ data: one ? (found[0] ?? null) : found, error: null });
    },
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => query(table),
    auth: {
      admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@acme.test` } } }) },
    },
  },
}));
vi.mock('../access.js', () => ({ brandReaders: async () => readers.value }));
vi.mock('../email.js', () => ({ deliverEmail }));
vi.mock('../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { renderNeedsYouEmail, tellNeedsYou } = await import('./needs-you.js');

const ORG = 'org-1';
const BRAND = 'brand-1';
const RUN = 'run-1';

beforeEach(() => {
  deliverEmail.mockClear();
  readers.value = new Map([['person-1', new Set([BRAND])]]);
  db.tables = {
    chat_agent_runs: [
      {
        id: RUN,
        organization_id: ORG,
        agent_id: 'agent-1',
        acting_user_id: 'person-1',
        brand_id: BRAND,
        status: 'needs_you',
      },
    ],
    chat_agents: [{ id: 'agent-1', name: 'Weekly brief', owner_id: 'owner-1' }],
    brands: [{ id: BRAND, name: 'Acme Coffee' }],
    chat_conversations: [{ id: 'chat-1', agent_run_id: RUN }],
    profiles: [
      { id: 'person-1', organization_id: ORG },
      { id: 'owner-1', organization_id: ORG },
    ],
    chat_user_prefs: [],
    chat_notices: [],
  };
});

describe('tellNeedsYou', () => {
  it('e-mails the person the run acts as, once per run, and records it', async () => {
    expect(await tellNeedsYou({ orgId: ORG, agentRunId: RUN })).toEqual({ notices: 1, emails: 1 });
    expect(db.tables.chat_notices).toEqual([
      {
        organization_id: ORG,
        user_id: 'person-1',
        kind: 'agent_needs_you',
        brand_id: BRAND,
        dedupe_key: `agent_needs_you:${RUN}`,
        payload: { agent: 'Weekly brief', agentId: 'agent-1', runId: RUN, chatId: 'chat-1' },
      },
    ]);
    expect(deliverEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['person-1@acme.test'], subject: 'Weekly brief needs you' }),
    );
    // The run waits again: no second e-mail.
    expect(await tellNeedsYou({ orgId: ORG, agentRunId: RUN })).toEqual({ notices: 0, emails: 0 });
    expect(deliverEmail).toHaveBeenCalledTimes(1);
  });

  it('sends no e-mail to a person who picked Inbox only', async () => {
    db.tables.chat_user_prefs = [{ user_id: 'person-1', notify_via: 'inbox' }];
    expect(await tellNeedsYou({ orgId: ORG, agentRunId: RUN })).toEqual({ notices: 1, emails: 0 });
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('tells the agent’s owner when the run acts as no one, if they reach the brand', async () => {
    db.tables.chat_agent_runs[0].acting_user_id = null;
    expect(await tellNeedsYou({ orgId: ORG, agentRunId: RUN })).toEqual({ notices: 0, emails: 0 });
    readers.value.set('owner-1', new Set([BRAND]));
    expect(await tellNeedsYou({ orgId: ORG, agentRunId: RUN })).toEqual({ notices: 1, emails: 1 });
    expect(db.tables.chat_notices[0].user_id).toBe('owner-1');
  });

  it('tells no one about a run that doesn’t wait, or another workspace’s', async () => {
    db.tables.chat_agent_runs[0].status = 'running';
    expect(await tellNeedsYou({ orgId: ORG, agentRunId: RUN })).toEqual({ notices: 0, emails: 0 });
    db.tables.chat_agent_runs[0].status = 'needs_you';
    expect(await tellNeedsYou({ orgId: 'org-2', agentRunId: RUN })).toEqual({
      notices: 0,
      emails: 0,
    });
    expect(deliverEmail).not.toHaveBeenCalled();
  });
});

describe('renderNeedsYouEmail', () => {
  it('names the agent and the brand, and opens the run', () => {
    const { subject, html } = renderNeedsYouEmail({
      agent: 'Weekly <brief>',
      brand: 'Acme Coffee',
      chatId: 'chat-1',
    });
    expect(subject).toBe('Weekly <brief> needs you');
    expect(html).toContain('Weekly &lt;brief&gt; stopped on Acme Coffee');
    expect(html).toContain('/dashboard/chat/chat-1');
    expect(html).toContain('Once per run.');
  });
});
