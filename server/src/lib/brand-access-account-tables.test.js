import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

/**
 * Brand access on the brand tables whose policies looked only at the
 * organization or the person (00390 for the Account's, 00424 for Chat's), on
 * content_draft_member(), the plan's quotas and invitations. Read from the
 * SQL, as the other migration tests here do: the repository has no database
 * tests. brand-access-policies.test.js checks that every brand table reaches
 * the brand; this one that nothing else in those policies changed, so people
 * with All brands (everyone, until the Team screen) see what they saw.
 */

const dir = new URL('../../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const ACCOUNT = '00390_brand_access_account_tables.sql';
const CHAT = '00424_brand_access_chat_tables.sql';

/** A migration's SQL without its comments, on one line. */
const read = (file) =>
  readFileSync(new URL(file, dir), 'utf8')
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A migration's statements, function bodies left out. */
const statements = (file) =>
  read(file)
    .replace(/\$(\w*)\$.*?\$\1\$/g, "''")
    .split(';')
    .map((text) => text.trim());

/** The last definition of a function, across every migration: its file, header and body. */
function lastFunction(name) {
  let last = null;
  const definition = new RegExp(
    `create (?:or replace )?function "?public"?\\."?${name}"?\\s*\\(([^$]*?)\\$\\$(.*?)\\$\\$`,
    'gi',
  );
  for (const file of files) {
    for (const m of read(file).matchAll(definition)) {
      last = { file, header: m[1].toLowerCase(), body: m[2] };
    }
  }
  if (!last) throw new Error(`No function ${name}`);
  return last;
}

/** A `create policy` statement's name, command, roles and conditions. */
function parsePolicy(file, policyName, rest) {
  const text = rest.replace(/"/g, '');
  const head = text.split(/\b(?:using|with check)\b/i)[0];
  return {
    file,
    name: policyName,
    command: (head.match(/\bfor (all|select|insert|update|delete)\b/i)?.[1] ?? 'all').toLowerCase(),
    roles: head.match(/\bto ([\w, ]+?)\s*$/i)?.[1] ?? 'public',
    body: text.slice(head.length).trim(),
  };
}

/**
 * A table's policy statements in migration order: every `create policy`
 * (history) and the policies left once every migration has run (now).
 */
function policiesOf(table) {
  const on = `on (?:"?public"?\\.)?"?${table}"?`;
  const create = new RegExp(`^create policy "([^"]+)" ${on} (.*)$`, 'i');
  const drop = new RegExp(`^drop policy (?:if exists )?"([^"]+)" ${on}$`, 'i');
  const history = [];
  const now = new Map();
  for (const file of files) {
    for (const text of statements(file)) {
      let m;
      if ((m = text.match(create))) {
        const policy = parsePolicy(file, m[1], m[2]);
        history.push(policy);
        now.set(policy.name, policy);
      } else if ((m = text.match(drop))) {
        now.delete(m[1]);
      }
    }
  }
  return { history, now };
}

/** The index of the parenthesis that closes the one at `open`. */
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** A policy body's `using (…)` and `with check (…)` conditions, without spaces, case or outer parentheses. */
function conditions(body) {
  const found = [];
  const start = /\b(using|with check) \(/gi;
  let m;
  while ((m = start.exec(body))) {
    const open = m.index + m[0].length - 1;
    const end = closing(body, open);
    let text = body.slice(open + 1, end).trim();
    while (text.startsWith('(') && closing(text, 0) === text.length - 1) {
      text = text.slice(1, -1).trim();
    }
    found.push(`${m[1].toLowerCase()}:${text.replace(/\s+/g, '').toLowerCase()}`);
    start.lastIndex = end + 1;
  }
  return found;
}

/** The brand condition the two migrations add, as `and …`. */
const BRAND_CONDITION =
  /\s*and \((?: ?brand_id is null or brand_id in \(select public\.user_brand_ids\(\)\) ?)\)|\s*and brand_id in \(select public\.user_brand_ids\(\)\)/g;

/** The policies a migration (re)creates: [table, name] pairs. */
function created(file) {
  return statements(file)
    .map((text) => text.match(/^create policy "([^"]+)" on public\.(\w+)/i))
    .filter(Boolean)
    .map((m) => [m[2], m[1]]);
}

describe('the brand tables 00390 and 00424 take', () => {
  const taken = [...created(ACCOUNT), ...created(CHAT)].filter(
    ([table]) => table !== 'invitations',
  );

  it('are the ones whose policies looked only at the organization or the person', () => {
    expect([...new Set(taken.map(([table]) => table))].sort()).toEqual([
      'agent_conversations',
      'chat_access_requests',
      'chat_activity_log',
      'chat_agent_runs',
      'chat_conversations',
      'chat_files',
      'chat_suggestion_feeds',
      'chat_suggestions',
      'chat_why_analyses',
      'content_draft_deliveries',
      'prompt_usage_counters',
      'ship_events',
    ]);
  });

  it.each(taken)(
    '%s "%s": the same rule as before, for signed-in people, within brand access',
    (table, name) => {
      const history = policiesOf(table).history.filter((p) => p.name === name);
      const now = history.at(-1);
      const before = history.at(-2);
      expect([ACCOUNT, CHAT]).toContain(now.file);
      expect(before.file < now.file).toBe(true);

      expect(now.roles).toBe('authenticated');
      expect(now.command).toBe(before.command);
      // Every condition gains the brand condition…
      for (const condition of conditions(now.body)) {
        expect(condition).toMatch(/brand_idin\(selectpublic\.user_brand_ids\(\)\)\)?$/);
      }
      // …and keeps everything it had.
      expect(conditions(now.body.replace(BRAND_CONDITION, ''))).toEqual(conditions(before.body));
    },
  );

  it('keeps a row without a brand where the column may be empty, and only there', () => {
    const nullable = new Set(
      taken
        .filter(([table, name]) =>
          policiesOf(table).now.get(name).body.includes('brand_id is null'),
        )
        .map(([table]) => table),
    );
    // brand_id is nullable there: a chat or file about the whole workspace, or
    // a row whose brand was deleted (on delete set null).
    expect([...nullable].sort()).toEqual([
      'agent_conversations',
      'chat_access_requests',
      'chat_activity_log',
      'chat_agent_runs',
      'chat_conversations',
      'chat_files',
    ]);
  });

  it('come after the migration that creates each table, as a fresh install runs them in order', () => {
    for (const [table] of taken) {
      const creates = new RegExp(
        `create table (?:if not exists )?(?:"?public"?\\.)?"?${table}"? \\(`,
        'i',
      );
      const maker = files.find((file) => creates.test(read(file)));
      const changer = created(ACCOUNT).some(([t]) => t === table) ? ACCOUNT : CHAT;
      expect(maker < changer, table).toBe(true);
    }
  });
});

describe('content_draft_member (00390)', () => {
  const member = lastFunction('content_draft_member');

  it('lets in the server, or a person who can access the draft’s brand', () => {
    expect(member.file).toBe(ACCOUNT);
    expect(member.header).toMatch(/ stable security definer set search_path = '' /);
    expect(member.body).toMatch(
      /select auth\.role\(\) = 'service_role' or exists \( select 1 from public\.content_drafts d where d\.id = p_draft_id and public\.can_access_brand\(d\.brand_id\) \);/,
    );
    // The organization alone no longer lets anyone in.
    expect(member.body).not.toMatch(/profiles/);
  });

  it('backs its policies for signed-in people only', () => {
    const policies = read(ACCOUNT).match(
      /alter policy "content_draft_\w+: member \w+" on public\.content_draft_\w+ to authenticated/g,
    );
    expect(policies).toHaveLength(10);
  });
});

describe('the plan’s quotas (00390)', () => {
  const MEMBER =
    /coalesce\(auth\.role\(\), ''\) = 'service_role' or exists \( select 1 from public\.profiles pf where pf\.id = auth\.uid\(\) and pf\.organization_id = p_organization_id \)/;

  it('count every location of the organization for its members, the hidden brands in one row', () => {
    const usage = lastFunction('org_prompt_location_usage');
    expect(usage.file).toBe(ACCOUNT);
    expect(usage.header).toMatch(
      /returns table \(brand_id uuid, locations bigint\) language sql stable security definer set search_path = '' /,
    );
    expect(usage.body).toMatch(
      /where b\.organization_id = p_organization_id and not b\.is_demo and p\.is_active/,
    );
    expect(usage.body).toMatch(MEMBER);
    expect(usage.body).toMatch(
      /case when coalesce\(auth\.role\(\), ''\) = 'service_role' or u\.id in \(select public\.user_brand_ids\(\)\) then u\.id end as brand_id/,
    );
    expect(usage.body).toMatch(
      /select s\.brand_id, sum\(s\.locations\)::bigint from shown s group by s\.brand_id;/,
    );
  });

  it('total the Account on the usage cards for anyone who can access the brand', () => {
    const summary = lastFunction('prompt_usage_summary');
    expect(summary.file).toBe(ACCOUNT);
    expect(summary.header).toMatch(/ stable security definer set search_path = '' /);
    expect(summary.body).toMatch(
      /where b\.id = p_brand_id and \(coalesce\(auth\.role\(\), ''\) = 'service_role' or public\.can_access_brand\(b\.id\)\);/,
    );
    // The totals read the organization, not the person's brands.
    expect(summary.body).toMatch(
      /where b2\.organization_id = b\.organization_id and not b2\.is_demo/,
    );
    expect(summary.body).toMatch(
      /where c\.organization_id = b\.organization_id and not cb\.is_demo/,
    );
    expect(summary.body).not.toMatch(/user_brand_ids/);
  });

  it('count every brand of the organization for maxBrands, the demo brand left out', () => {
    const count = lastFunction('org_brand_count');
    expect(count.file).toBe(ACCOUNT);
    expect(count.header).toMatch(
      /returns integer language sql stable security definer set search_path = '' /,
    );
    expect(count.body).toMatch(/where b\.organization_id = p_organization_id and not b\.is_demo/);
    expect(count.body).toMatch(MEMBER);
  });

  it('run for signed-in people and the server, never anon', () => {
    const sql = read(ACCOUNT);
    for (const name of ['org_prompt_location_usage', 'prompt_usage_summary', 'org_brand_count']) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${name}\\(uuid\\) from public, anon`),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\(uuid\\) to authenticated, service_role`,
        ),
      );
    }
  });
});

describe('invitations (00390)', () => {
  it('are read by the organization’s admins only, and managed by them as before', () => {
    const policies = policiesOf('invitations').now;
    const reads = [...policies.values()].filter((p) => p.command === 'select');
    expect(reads.map((p) => p.name)).toEqual(['Admins can view org invitations']);
    expect(reads[0].roles).toBe('authenticated');
    expect(reads[0].body).toMatch(/where p\.id = auth\.uid\(\) and p\.role = 'admin'/);
    expect([...policies.values()].map((p) => p.command).sort()).toEqual([
      'delete',
      'insert',
      'select',
      'update',
    ]);
  });
});

describe('member_brands (00390)', () => {
  it('locks the person’s profile while it checks their organization', () => {
    const check = lastFunction('check_member_brand_organization');
    expect(check.file).toBe(ACCOUNT);
    expect(check.body).toMatch(
      /perform 1 from public\.profiles p where p\.id = new\.user_id and p\.organization_id = new\.organization_id for share; if not found then raise exception/,
    );
  });
});
