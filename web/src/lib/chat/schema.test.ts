// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHAT_MODES } from './precedence';

/**
 * Chat's Wave 1 (00407–00413) and Wave 2 (00417–00422) tables as the
 * migrations leave them: who reads them, what stays with the server, and the
 * limits the specs set. Read from the SQL, as events.test.ts reads the step
 * kinds: the repository has no database tests.
 */

const dir = fileURLToPath(new URL('../../../../supabase/migrations', import.meta.url));
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

/** A migration's SQL, without its comments. */
function migration(number: string): string {
  const file = files.find((name) => name.startsWith(`${number}_`));
  if (!file) throw new Error(`No migration ${number}`);
  return readFileSync(`${dir}/${file}`, 'utf8').replace(/--[^\n]*/g, '');
}

const WAVE_1 = ['00407', '00408', '00409', '00410', '00411', '00412', '00413'];
const sql = WAVE_1.map(migration).join('\n');

/** The tables the wave creates. */
const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

/** Tables no member reads: tool names, model costs and anonymous logs. */
const SERVER_ONLY = [
  'chat_tool_cache',
  'help_answer_cache',
  'help_gaps',
  'add_on_products',
  'ai_credit_grants',
  'storage_grants',
];

/** A bucket the migrations create: private or not, its size limit and types. */
function bucket(id: string) {
  const m = sql.match(
    new RegExp(
      `insert into storage\\.buckets[^;]*?values\\s*\\(\\s*'${id}',\\s*'${id}',\\s*(true|false),\\s*(\\d+),\\s*array\\[([^\\]]*)\\]`,
    ),
  );
  if (!m) throw new Error(`No bucket ${id}`);
  return {
    public: m[1] === 'true',
    sizeLimit: Number(m[2]),
    types: [...m[3].matchAll(/'([^']+)'/g)].map((t) => t[1]),
  };
}

/** A policy's text, from its name to the end of its statement. */
function policy(name: string, from = sql): string {
  const m = from.match(new RegExp(`create policy "${name}"[^;]*;`));
  if (!m) throw new Error(`No policy ${name}`);
  return m[0].replace(/\s+/g, ' ');
}

describe('Wave 1 tables', () => {
  it('creates the tables the plan lists', () => {
    expect(created.sort()).toEqual(
      [
        'chat_uploads',
        'chat_tool_cache',
        'chat_files',
        'chat_file_task_links',
        'chat_storage_usage',
        'help_answer_cache',
        'help_gaps',
        'add_on_products',
        'add_on_purchases',
        'ai_credit_grants',
        'storage_grants',
      ].sort(),
    );
  });

  it('turns row level security on for each of them', () => {
    for (const table of created) {
      expect(sql, table).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`),
      );
    }
  });

  it('lets members read at most: every write is the server’s', () => {
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/);
    expect(sql).not.toMatch(/create policy[^;]*for (insert|update|delete|all)\b/);
  });

  it('keeps tool results, Help logs and the dollars of packs and grants from members', () => {
    for (const table of SERVER_ONLY) {
      expect(sql, table).not.toMatch(
        new RegExp(`grant [^;]*on table public\\.${table} to authenticated`),
      );
      expect(sql, table).not.toMatch(new RegExp(`create policy [^;]*on public\\.${table}\\b`));
    }
  });
});

describe('chats', () => {
  it('shows a chat to its author, or to its workspace once shared, and to nobody once deleted', () => {
    const author = policy('chat_conversations: author select');
    const shared = policy('chat_conversations: shared select');
    expect(author).toContain('user_id = auth.uid()');
    expect(shared).toContain('shared_at is not null');
    expect(shared).not.toContain('user_id = auth.uid()');
    for (const text of [author, shared]) {
      expect(text).toContain('deleted_at is null');
      expect(text).toContain(
        'select p.organization_id from public.profiles p where p.id = auth.uid()',
      );
    }
  });

  it('keeps what a message was scoped to on the person’s messages only', () => {
    expect(migration('00407')).toMatch(/check \(context_json is null or role = 'user'\)/);
  });

  it('searches titles and messages in any language', () => {
    const chats = migration('00407');
    expect(chats).toMatch(/to_tsvector\('simple', coalesce\(title, ''\)\)/);
    expect(chats).toMatch(/to_tsvector\('simple', content_md\)/);
    expect(chats).toMatch(/chat_conversations using gin \(search_tsv\)/);
    expect(chats).toMatch(/chat_messages using gin \(search_tsv\)/);
  });
});

describe('a person’s Chat settings', () => {
  it('start a chat in one of the composer’s modes', () => {
    const check = migration('00408').match(/default_mode in \(([^)]*)\)/)?.[1] ?? '';
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...CHAT_MODES]);
  });
});

describe('attachments', () => {
  const uploads = migration('00409');

  it('are private, 10 MB each, in the types the composer offers', () => {
    const chatUploads = bucket('chat-uploads');
    expect(chatUploads.public).toBe(false);
    expect(chatUploads.sizeLimit).toBe(10 * 1024 * 1024);
    expect(uploads).toMatch(
      /size_bytes integer not null check \(size_bytes between 1 and 10485760\)/,
    );
    const column = uploads.match(/mime_type in \(([^)]*)\)/)?.[1] ?? '';
    expect([...column.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(chatUploads.types);
    expect(chatUploads.types).toHaveLength(11);
  });

  it('are 5 a message at most, kept 90 days', () => {
    expect(uploads).toMatch(/\) >= 5/);
    expect(uploads).toMatch(/before insert or update of message_id on public\.chat_uploads/);
    expect(uploads).toMatch(
      /expires_at timestamptz not null default \(now\(\) \+ interval '90 days'\)/,
    );
  });
});

describe('Files', () => {
  const chatFiles = migration('00411');

  it('are private to the workspace and kept a year', () => {
    expect(bucket('chat-files').public).toBe(false);
    expect(chatFiles).toMatch(
      /expires_at timestamptz not null default \(now\(\) \+ interval '1 year'\)/,
    );
    expect(policy('chat_files: member select')).toContain(
      'organization_id in ( select p.organization_id from public.profiles p where p.id = auth.uid() )',
    );
  });

  it('count every file written, resized or deleted toward the workspace’s storage', () => {
    expect(chatFiles).toMatch(
      /after insert or delete or update of size_bytes on public\.chat_files\s+for each row execute function public\.chat_files_count_storage\(\)/,
    );
  });
});

describe('add-on packs', () => {
  const packs = [
    ...migration('00413').matchAll(
      /\(\s*'(\w+)',\s*'(ai|storage)',\s*'[^']*',\s*(\d+),\s*'(\w+)',\s*(\d+|null),\s*(\d+|null),\s*(\d+|null),\s*(true|false),\s*\d+\s*\)/g,
    ),
  ].map(([, id, kind, cents, billing, usd, bytes, months, highlight]) => ({
    id,
    kind,
    cents: Number(cents),
    billing,
    usd: usd === 'null' ? null : Number(usd),
    bytes: bytes === 'null' ? null : Number(bytes),
    months: months === 'null' ? null : Number(months),
    highlight: highlight === 'true',
  }));
  const GB = 1024 ** 3;

  it('sell AI credits at $10, $50, $250 and $1,000: half the price as budget, valid 12 months', () => {
    const ai = packs.filter((pack) => pack.kind === 'ai');
    expect(ai.map((pack) => pack.cents)).toEqual([1000, 5000, 25000, 100000]);
    for (const pack of ai) {
      expect(pack.usd).toBe(pack.cents / 100 / 2);
      expect(pack).toMatchObject({ billing: 'one_time', months: 12, bytes: null });
    }
  });

  it('sell storage monthly: +25 GB $5, +100 GB $15, +250 GB $29', () => {
    const storage = packs.filter((pack) => pack.kind === 'storage');
    expect(storage.map((pack) => [pack.bytes, pack.cents])).toEqual([
      [25 * GB, 500],
      [100 * GB, 1500],
      [250 * GB, 2900],
    ]);
    for (const pack of storage) {
      expect(pack).toMatchObject({ billing: 'monthly', months: null, usd: null });
    }
  });

  it('mark $50 and +25 GB as Most picked', () => {
    expect(packs.filter((pack) => pack.highlight).map((pack) => pack.id)).toEqual([
      'ai_50',
      'storage_25',
    ]);
  });

  it('show purchases to the workspace’s Admins only', () => {
    expect(policy('add_on_purchases: admin select')).toContain(
      "where p.id = auth.uid() and p.role = 'admin'",
    );
  });

  it('tie a ledger row to the grant it drew on', () => {
    expect(migration('00413')).toMatch(
      /alter table public\.prompt_improve_usage\s+add column if not exists grant_id uuid\s+references public\.ai_credit_grants\(id\) on delete set null/,
    );
  });
});

const WAVE_2 = ['00417', '00418', '00419', '00420', '00421', '00422'];
const wave2 = WAVE_2.map(migration).join('\n');

/** The tables Wave 2 creates. */
const created2 = [...wave2.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

/** A table's create statement, from its name to its closing parenthesis. */
function table(name: string): string {
  const m = wave2.match(
    new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`),
  );
  if (!m) throw new Error(`No table ${name}`);
  return m[1];
}

/** The values a column's check allows, in order. */
function allowed(text: string, column: string): string[] {
  const m = text.match(new RegExp(`\\b${column} in \\(([^)]*)\\)`));
  if (!m) throw new Error(`No check on ${column}`);
  return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((v) => v[1]);
}

/** The one outcome vocabulary (decision 13, CHAT-22 shared rule 3). */
const OUTCOMES = ['pending', 'improved', 'no_meaningful_change', 'declined', 'not_measurable'];

describe('Wave 2 tables', () => {
  it('creates the tables the plan lists', () => {
    expect(created2.sort()).toEqual(
      [
        'chat_asks',
        'chat_next_moves',
        'chat_task_state',
        'chat_agents',
        'chat_agent_versions',
        'chat_agent_triggers',
        'chat_agent_runs',
        'chat_why_analyses',
        'ship_events',
        'impact_measurements',
        'impact_control_sets',
        'chat_suggestion_feeds',
        'chat_suggestions',
      ].sort(),
    );
  });

  it('turns row level security on for each of them', () => {
    for (const name of created2) {
      expect(wave2, name).toMatch(
        new RegExp(`alter table public\\.${name} enable row level security`),
      );
    }
  });

  it('lets members read at most: every write is the server’s', () => {
    expect(wave2).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/);
    expect(wave2).not.toMatch(/create policy[^;]*for (insert|update|delete|all)\b/);
  });

  it('keeps the agent queue, the holds and the agents’ shares with the server', () => {
    for (const fn of [
      'chat_start_next_agent_run',
      'reserve_chat_ai_usage',
      'chat_agent_usage_shares',
    ]) {
      expect(wave2, fn).toMatch(
        new RegExp(
          `revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon, authenticated`,
        ),
      );
      expect(wave2, fn).not.toMatch(
        new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated`),
      );
    }
  });
});

describe('questions and next moves', () => {
  const asks = table('chat_asks');
  const moves = table('chat_next_moves');

  it('ask at most 4 questions a run, in order', () => {
    expect(asks).toMatch(/position smallint not null check \(position between 1 and 4\)/);
    expect(asks).toMatch(/unique \(run_id, position\)/);
  });

  it('give each question 2–4 options with exactly one Recommended', () => {
    const fn = migration('00417');
    expect(fn).toMatch(/jsonb_array_length\(p_options\) not between 2 and 4 then false/);
    expect(fn).toMatch(/count\(\*\) filter \(where o -> 'recommended' = 'true'::jsonb\) = 1/);
    expect(asks).toMatch(/public\.chat_ask_options_valid\(options_json\)/);
  });

  it('rank 2–4 moves whose prompts fit as ghost text, each with its action class', () => {
    expect(moves).toMatch(/rank smallint not null check \(rank between 1 and 4\)/);
    expect(moves).toMatch(/prompt text not null check \(char_length\(prompt\) between 1 and 80\)/);
    expect(allowed(moves, 'class')).toEqual(['read', 'write', 'execute']);
  });

  it('keep the shortcut on the person’s message only', () => {
    expect(migration('00417')).toMatch(/check \(shortcut_id is null or role = 'user'\)/);
  });
});

describe('the task strip', () => {
  it('holds Chat’s own status, never the task’s Action Center one', () => {
    const strip = table('chat_task_state');
    expect(allowed(strip, 'chat_status')).toEqual([
      'queued',
      'writing',
      'ready_for_review',
      'done',
    ]);
    expect(migration('00418')).not.toMatch(/alter table public\.action_tasks/);
  });
});

describe('agents', () => {
  const agents = table('chat_agents');
  const versions = table('chat_agent_versions');
  const runs = table('chat_agent_runs');
  const agentSql = migration('00419');

  it('go draft, active, paused, archived, with a reason when paused', () => {
    expect(allowed(agents, 'status')).toEqual(['draft', 'active', 'paused', 'archived']);
    expect(allowed(agents, 'paused_reason')).toEqual([
      'cap',
      'connection',
      'skill_off',
      'failures',
      'owner_role',
      'plan',
      'brand_gone',
      'manual',
    ]);
    expect(agents).toMatch(/check \(\(status = 'paused'\) = \(paused_reason is not null\)\)/);
  });

  it('run in one of the composer’s modes, with 1–3 skills and no key', () => {
    expect(allowed(versions, 'mode')).toEqual([...CHAT_MODES]);
    expect(versions).toMatch(/cardinality\(skill_ids\) between 1 and 3/);
    expect(`${agents}\n${versions}`).not.toMatch(/key_encrypted|api_key/);
  });

  it('cap a run at 10% of the AI limit by default, 1–50%', () => {
    expect(agents).toMatch(
      /max_run_share numeric\(3, 2\) not null default 0\.10 check \(max_run_share between 0\.01 and 0\.50\)/,
    );
    expect(agentSql).toMatch(
      /agent_run_share_default numeric\(3, 2\) not null default 0\.10\s+check \(agent_run_share_default between 0\.01 and 0\.50\)/,
    );
  });

  it('keep CHAT-21’s run statuses, queued and skipped included', () => {
    expect(allowed(runs, 'status')).toEqual([
      'queued',
      'running',
      'needs_you',
      'done',
      'failed',
      'stopped',
      'skipped',
      'paused_cap',
    ]);
    expect(allowed(runs, 'outcome')).toEqual(OUTCOMES);
  });

  it('run one at a time per agent and brand, a run paused at its cap keeping its place', () => {
    expect(agentSql).toMatch(
      /on public\.chat_agent_runs \(agent_id, brand_id\)\s+where status in \('running', 'needs_you', 'paused_cap'\)/,
    );
  });

  it('start a queued run only for a live agent and brand, within the workspace limit', () => {
    const start = agentSql.slice(agentSql.indexOf('function public.chat_start_next_agent_run'));
    expect(start).toContain("raise exception 'a workspace limit is needed'");
    expect(start).toContain('q.brand_id is not null');
    expect(start).toContain("g.status <> 'archived'");
    expect(start).toContain("(g.status = 'active' or q.trigger_kind in ('manual', 'action'))");
  });

  it("hold a step against the chat's own agent run, so subtasks count toward it", () => {
    const reserve = agentSql.slice(agentSql.indexOf('function public.reserve_chat_ai_usage'));
    expect(reserve).toContain(
      'select r.parent_run_id, c.agent_run_id into v_parent_id, v_agent_run',
    );
    expect(reserve).toContain("raise exception 'agent run is not the chat''s'");
    expect(reserve).toMatch(/set search_path = ''/);
  });

  it('show a run’s chat to whoever reads the run, never once deleted', () => {
    const text = policy('chat_conversations: agent run select', agentSql);
    expect(text).toContain('agent_run_id in (select r.id from public.chat_agent_runs r)');
    expect(text).toContain('deleted_at is null');
  });

  it('show a private agent to its owner and the Admins only', () => {
    const text = policy('chat_agents: member select', agentSql);
    expect(text).toContain("p.role = 'admin'");
    expect(text).toContain("chat_agents.visibility = 'workspace'");
    expect(text).toContain('chat_agents.owner_id = auth.uid()');
  });

  it('give a subtask no message of its own, one level deep', () => {
    expect(agentSql).toMatch(/\(parent_run_id is null\) = \(message_id is not null\)/);
    expect(agentSql).toMatch(/and p\.parent_run_id is null/);
    expect(agentSql).toMatch(/\) >= 10 then/);
  });

  it('keep the server’s hold arguments, adding the agent run and its cap', () => {
    const fn = agentSql.match(
      /create or replace function public\.reserve_chat_ai_usage\(([^)]*)\)/,
    )?.[1];
    const names = [...(fn ?? '').matchAll(/(p_\w+)/g)].map((m) => m[1]);
    expect(names).toEqual([
      'p_organization_id',
      'p_chat_run_id',
      'p_chat_run_step_id',
      'p_feature',
      'p_model',
      'p_cost',
      'p_own_key',
      'p_since',
      'p_budget',
      'p_agent_run_id',
      'p_run_cap',
    ]);
    expect(fn).toMatch(/p_agent_run_id\s+uuid default null/);
    expect(fn).toMatch(/p_run_cap\s+numeric default null/);
  });

  it('give each agent’s spend as shares, never as costs', () => {
    expect(agentSql).toMatch(
      /returns table \(agent_id uuid, share numeric, own_key_share numeric, runs integer\)/,
    );
  });
});

describe('the impact ledger', () => {
  const measurements = table('impact_measurements');

  it('measures each ship event once, in the one outcome vocabulary', () => {
    expect(measurements).toMatch(
      /ship_event_id uuid not null unique references public\.ship_events\(id\)/,
    );
    expect(allowed(measurements, 'outcome')).toEqual(OUTCOMES);
    expect(allowed(measurements, 'confidence')).toEqual(['low', 'medium', 'high']);
  });

  it('checks at 7, 14, 30 and 90 days', () => {
    for (const name of ['impact_measurements', 'impact_control_sets']) {
      expect(allowed(table(name), 'checkpoint'), name).toEqual(['d7', 'd14', 'd30', 'd90']);
    }
  });

  it('is read by every member of the workspace', () => {
    expect(policy('ship_events: member select', wave2)).toContain(
      'organization_id in ( select p.organization_id from public.profiles p where p.id = auth.uid() )',
    );
  });

  it('writes one ship event per CMS send, and notes a page published again (00425)', () => {
    const delivery = migration('00425');
    expect(delivery).toMatch(
      /add column if not exists content_draft_delivery_id uuid\s+references public\.content_draft_deliveries\(id\) on delete set null/,
    );
    expect(delivery).toMatch(/add column if not exists republished_at timestamptz/);
    // A plain unique index: PostgREST's on_conflict can't name a partial one's predicate.
    expect(delivery).toMatch(
      /create unique index if not exists ship_events_content_draft_delivery_uidx\s+on public\.ship_events \(content_draft_delivery_id\);/,
    );
    expect(delivery).not.toMatch(/grant [^;]*to authenticated/);
  });

  it('decides a CMS publish under a lock on its draft, into a cms_publish only (00428)', () => {
    const ship = migration('00428');
    expect(ship).toMatch(
      /pg_advisory_xact_lock\(hashtext\('ship_cms_publish:' \|\| p_content_draft_id::text\)\)/,
    );
    expect(ship).toMatch(
      /and s\.kind = 'cms_publish'\s+and s\.shipped_at >= p_shipped_at - interval '90 days'\s+and s\.shipped_at <= p_shipped_at \+ interval '90 days'/,
    );
    // The latest before the send first, else the nearest after it.
    expect(ship).toMatch(
      /order by s\.shipped_at > p_shipped_at,\s+greatest\(s\.shipped_at - p_shipped_at, p_shipped_at - s\.shipped_at\)/,
    );
    expect(ship).toMatch(/on conflict \(content_draft_delivery_id\) do nothing/);
    expect(ship).toMatch(/set search_path = ''/);
    expect(ship).toMatch(
      /revoke all on function public\.ship_cms_publish\([^)]*\)\s+from public, anon, authenticated;/,
    );
    expect(ship).toMatch(
      /grant execute on function public\.ship_cms_publish\([^)]*\)\s+to service_role;/,
    );
    expect(ship).toMatch(/check \(cardinality\(republished_delivery_ids\) <= 50\)/);
  });

  it('finds a send noted on a cms_publish by its id, before the draft lookup (00428)', () => {
    const ship = migration('00428');
    // A deleted draft sets content_draft_id null: only the noted ids tie the send to it.
    const noted = ship.indexOf('where s.republished_delivery_ids @> array[p_delivery_id]');
    expect(noted).toBeGreaterThan(-1);
    expect(noted).toBeLessThan(ship.indexOf('and s.content_draft_id = p_content_draft_id'));
    expect(ship).toMatch(
      /create index if not exists ship_events_republished_delivery_ids_idx\s+on public\.ship_events using gin \(republished_delivery_ids\);/,
    );
  });
});

describe('daily suggestions', () => {
  it('send at most one a day per person and brand', () => {
    expect(table('chat_suggestions')).toMatch(/unique \(user_id, brand_id, sent_on\)/);
  });

  it('show a person only their own', () => {
    for (const name of ['chat_suggestions: own select', 'chat_suggestion_feeds: own select']) {
      expect(policy(name, wave2)).toContain('user_id = auth.uid()');
    }
  });
});
