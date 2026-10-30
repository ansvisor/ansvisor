// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHAT_MODES } from './precedence';

/**
 * Chat's Wave 1 tables (00407–00413) as the migrations leave them: who reads
 * them, what stays with the server, and the limits the specs set. Read from
 * the SQL, as events.test.ts reads the step kinds: the repository has no
 * database tests.
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
function policy(name: string): string {
  const m = sql.match(new RegExp(`create policy "${name}"[^;]*;`));
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
