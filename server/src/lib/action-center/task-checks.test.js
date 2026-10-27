import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Automatic checks (AC-010): a task checked `auto` read on its page, fetched
 * again, by what it changes; passed, it is completed and History says so.
 */

let db;
let ops;
let reads;

function table(name) {
  const q = { op: 'select', filters: [], payload: null };
  const run = () => {
    if (q.op === 'select') {
      reads.push({ table: name, filters: q.filters });
      return { data: db[name] ?? [], error: null };
    }
    ops.push({ table: name, op: q.op, payload: q.payload, filters: q.filters });
    if (q.op === 'update' && name === 'action_tasks') {
      return { data: db.moved ? [] : [{ id: 't1' }], error: null };
    }
    return { data: null, error: null };
  };
  const filter =
    (kind) =>
    (...args) => (q.filters.push([kind, ...args]), chain);
  const chain = {
    select: () => chain,
    eq: (col, value) => (q.filters.push([col, value]), chain),
    in: filter('in'),
    is: filter('is'),
    not: filter('not'),
    or: filter('or'),
    order: filter('order'),
    limit: () => chain,
    insert: (payload) => ((q.op = 'insert'), (q.payload = payload), chain),
    update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { checkKind, checkPage, pageAddress, runTaskCheck, sweepTaskChecks } =
  await import('./task-checks.js');

/** A fetch that answers each address with a page, or fails as the reader does. */
const fetchOf = (pages) =>
  vi.fn(async (url) => {
    const page = pages[url];
    if (page === undefined) throw Object.assign(new Error('timeout'), { code: 'timeout' });
    if (page === 'not_html') throw Object.assign(new Error('html'), { code: 'not_html' });
    if (typeof page === 'number') {
      throw Object.assign(new Error('http'), { code: 'http_error', status: page });
    }
    return { url, status: 200, html: page };
  });

const PAGE = 'https://acme.example/pricing';
const ROBOTS = 'https://acme.example/robots.txt';
const html = (body, head = '') =>
  `<html><head><title>Pricing</title>${head}</head><body><main><h1>Pricing</h1><p>${body}</p></main></body></html>`;

beforeEach(() => {
  db = { brand_domains: [{ domain: 'acme.example' }], action_tasks: [], moved: false };
  ops = [];
  reads = [];
});

describe('checkKind', () => {
  it('reads a library task by its key, a written one by its new text, only checked auto with a page', () => {
    const auto = { check: 'auto', url: '/pricing' };
    expect(checkKind({ task_key: 'publish_content', details: auto })).toBe('published');
    expect(checkKind({ task_key: 'fix_broken_target', details: auto })).toBe('answers');
    expect(checkKind({ task_key: 'fix_structured_data', details: auto })).toBe('structuredData');
    expect(checkKind({ task_key: 'fix_crawler_access', details: auto })).toBe('crawlers');
    expect(checkKind({ task_key: 'optimize_content', details: auto })).toBe('changed');
    expect(checkKind({ task_key: null, details: { ...auto, change: { after: 'New FAQ' } } })).toBe(
      'text',
    );
    // A Site Audit task, a re-run, no page, no new text: no check here.
    expect(checkKind({ task_key: 'fix_technical_issue', details: auto })).toBeNull();
    expect(
      checkKind({ task_key: 'validate_citations', details: { ...auto, check: 'rerun' } }),
    ).toBeNull();
    expect(checkKind({ task_key: 'publish_content', details: { check: 'auto' } })).toBeNull();
    expect(checkKind({ task_key: null, details: auto })).toBeNull();
  });

  it('puts a path on the brand’s domain', () => {
    expect(pageAddress('/pricing', 'acme.example')).toBe(PAGE);
    expect(pageAddress(PAGE, null)).toBe(PAGE);
    expect(pageAddress('/pricing', null)).toBeNull();
    expect(pageAddress('pricing', 'acme.example')).toBeNull();
  });
});

describe('checkPage', () => {
  it('passes a broken page that answers again; a 4xx is an answer, a 5xx or none says nothing', async () => {
    expect(await checkPage('answers', PAGE, { fetch: fetchOf({ [PAGE]: html('x') }) })).toEqual({
      passed: true,
      missing: [],
    });
    expect(await checkPage('answers', PAGE, { fetch: fetchOf({ [PAGE]: 404 }) })).toEqual({
      passed: false,
      missing: ['page_error'],
      wasMissing: true,
    });
    expect(await checkPage('answers', PAGE, { fetch: fetchOf({ [PAGE]: 503 }) })).toBeNull();
    expect(await checkPage('answers', PAGE, { fetch: fetchOf({}) })).toBeNull();
  });

  it('passes a published page that didn’t answer before, never one live from the start', async () => {
    const missing = await checkPage('published', PAGE, { fetch: fetchOf({ [PAGE]: 404 }) });
    const live = fetchOf({ [PAGE]: html('Plans') });
    expect(
      await checkPage('published', PAGE, { previous: { ...missing, url: PAGE }, fetch: live }),
    ).toEqual({ passed: true, missing: [] });
    // Live at the first look: kept, and passed once it changes.
    const first = await checkPage('published', PAGE, { fetch: live });
    expect(first).toMatchObject({ passed: false, missing: ['first_look'] });
  });

  it('reads valid structured data', async () => {
    const ld = '<script type="application/ld+json">{"@type":"Product","name":"Plan"}</script>';
    expect(
      await checkPage('structuredData', PAGE, { fetch: fetchOf({ [PAGE]: html('x', ld) }) }),
    ).toEqual({ passed: true, missing: [] });
    const broken = '<script type="application/ld+json">{"@type":</script>';
    expect(
      await checkPage('structuredData', PAGE, { fetch: fetchOf({ [PAGE]: html('x', broken) }) }),
    ).toEqual({ passed: false, missing: ['no_structured_data'] });
  });

  it('reads robots.txt for the AI crawlers, and the page for noindex', async () => {
    const check = (pages) => checkPage('crawlers', PAGE, { fetch: fetchOf(pages) });
    const allowed = { passed: true, missing: [] };
    expect(await check({ [PAGE]: html('x'), [ROBOTS]: 'User-agent: *\nDisallow: /admin' })).toEqual(
      allowed,
    );
    // None (4xx), or a page instead of one: every crawler in.
    expect(await check({ [PAGE]: html('x'), [ROBOTS]: 404 })).toEqual(allowed);
    expect(await check({ [PAGE]: html('x'), [ROBOTS]: 'not_html' })).toEqual(allowed);
    expect(
      await check({
        [PAGE]: html('x', '<meta name="robots" content="noindex, follow">'),
        [ROBOTS]: 'User-agent: GPTBot\nDisallow: /',
      }),
    ).toEqual({ passed: false, missing: ['crawlers_blocked', 'noindex'] });
    // A server error, or no answer, says nothing.
    expect(await check({ [PAGE]: html('x'), [ROBOTS]: 503 })).toBeNull();
    expect(await check({ [PAGE]: html('x') })).toBeNull();
  });

  it('keeps the first look, passes a change of words, never of a script’s or of another page', async () => {
    const look = (body, previous = null, head = '') =>
      checkPage('changed', PAGE, { previous, fetch: fetchOf({ [PAGE]: html(body, head) }) });
    const first = await look('Old plans');
    expect(first).toMatchObject({ passed: false, missing: ['first_look'] });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const kept = { ...first, url: PAGE };
    // The same words, spaced or marked another way, and a JSON-LD date: no change.
    const ld = '<script type="application/ld+json">{"dateModified":"2026-10-27"}</script>';
    expect(await look('Old  plans.', kept, ld)).toEqual({
      passed: false,
      missing: ['not_changed'],
      fingerprint: first.fingerprint,
    });
    expect((await look('New plans, shipped free', kept)).passed).toBe(true);
    // A first look of another page (the URL edited since): a first look again.
    expect(await look('New plans', { ...kept, url: 'https://acme.example/old' })).toMatchObject({
      missing: ['first_look'],
    });
  });

  it('finds a written task’s new text on the page, its entities read and whole words only', async () => {
    const check = (after, body, head = '') =>
      checkPage('text', PAGE, { after, fetch: fetchOf({ [PAGE]: html(body, head) }) });
    expect(await check('plans start at $9 a month', 'Plans start at $9 a month.')).toEqual({
      passed: true,
      missing: [],
    });
    expect((await check('Tom & Jerry plans', 'Tom &amp; Jerry&nbsp;plans')).passed).toBe(true);
    // A word inside another isn't it.
    expect(await check('art', 'Start here')).toEqual({
      passed: false,
      missing: ['change_not_found'],
    });
    // The title and the meta description are read too.
    expect(
      (await check('Plans for teams', 'x', '<meta name="description" content="Plans for teams.">'))
        .passed,
    ).toBe(true);
  });
});

describe('runTaskCheck', () => {
  const action = { brand_id: 'b1' };
  const task = (over = {}) => ({
    id: 't1',
    action_id: 'a1',
    task_key: 'fix_broken_target',
    title: null,
    status: 'todo',
    updated_at: '2026-10-26T10:00:00Z',
    details: { check: 'auto', url: '/pricing', source: 'template' },
    ...over,
  });
  const now = new Date('2026-10-27T03:00:00Z');
  const at = now.toISOString();

  it('completes a task that passes, keeps the check on it and tells History', async () => {
    const result = await runTaskCheck(task(), action, {
      fetch: fetchOf({ [PAGE]: html('x') }),
      now,
    });
    expect(result).toEqual({
      autoCheck: { at, triedAt: at, url: PAGE, passed: true, missing: [] },
    });
    const update = ops.find((op) => op.table === 'action_tasks');
    expect(update.payload).toMatchObject({
      status: 'completed',
      // The template's mark stays: a check is no one's edit.
      details: { source: 'template', autoCheck: { passed: true } },
    });
    // Only if no one moved or edited it meanwhile.
    expect(update.filters).toContainEqual(['status', 'todo']);
    expect(update.filters).toContainEqual(['updated_at', '2026-10-26T10:00:00Z']);
    expect(ops.find((op) => op.table === 'action_events').payload).toMatchObject({
      action_id: 'a1',
      event: 'task_checked',
      data: { taskId: 't1', task: 'fix_broken_target' },
      actor_id: null,
    });
  });

  it('keeps what is missing on a task that fails, and its first look through a 4xx', async () => {
    const changed = task({
      task_key: 'optimize_content',
      details: {
        check: 'auto',
        url: '/pricing',
        autoCheck: { at: 'x', url: PAGE, fingerprint: 'f1', passed: false, missing: [] },
      },
    });
    const result = await runTaskCheck(changed, action, { fetch: fetchOf({ [PAGE]: 404 }), now });
    expect(result.autoCheck).toMatchObject({
      passed: false,
      missing: ['page_error'],
      fingerprint: 'f1',
    });
    const update = ops.find((op) => op.table === 'action_tasks');
    expect(update.payload).not.toHaveProperty('status');
    expect(ops.some((op) => op.table === 'action_events')).toBe(false);
  });

  it('keeps only the try when the page can’t be read', async () => {
    const tried = task({
      details: {
        check: 'auto',
        url: '/pricing',
        autoCheck: { at: 'x', passed: false, missing: ['page_error'] },
      },
    });
    expect(await runTaskCheck(tried, action, { fetch: fetchOf({}), now })).toEqual({
      reason: 'no_answer',
    });
    expect(ops.find((op) => op.table === 'action_tasks').payload.details.autoCheck).toEqual({
      at: 'x',
      passed: false,
      missing: ['page_error'],
      triedAt: at,
    });
  });

  it('says why nothing was checked: no check here, done, or changed meanwhile', async () => {
    const fetch = fetchOf({ [PAGE]: html('x') });
    expect(
      await runTaskCheck(task({ task_key: 'fix_technical_issue' }), action, { fetch }),
    ).toEqual({ reason: 'not_checkable' });
    expect(await runTaskCheck(task({ status: 'completed' }), action, { fetch })).toEqual({
      reason: 'not_open',
    });
    db.moved = true;
    expect(await runTaskCheck(task(), action, { fetch })).toEqual({ reason: 'changed' });
    expect(ops.some((op) => op.table === 'action_events')).toBe(false);
  });
});

describe('sweepTaskChecks', () => {
  const now = new Date('2026-10-27T03:00:00Z');
  const row = (id, over = {}) => ({
    id,
    action_id: 'a1',
    task_key: 'fix_broken_target',
    title: null,
    status: 'todo',
    updated_at: 'u',
    details: { check: 'auto', url: PAGE },
    actions: { brand_id: 'b1', status: 'new', deleted_at: null },
    ...over,
  });

  it('reads only tasks it can check, the least recently tried first', async () => {
    await sweepTaskChecks({ fetch: fetchOf({}), now });
    const filters = reads.find((r) => r.table === 'action_tasks').filters;
    expect(filters).toContainEqual(['not', 'details->>url', 'is', null]);
    expect(filters).toContainEqual([
      'or',
      expect.stringContaining('task_key.in.(publish_content,fix_broken_target'),
    ]);
    expect(filters).toContainEqual([
      'order',
      'details->autoCheck->>triedAt',
      { ascending: true, nullsFirst: true },
    ]);
  });

  it('checks the open tasks not tried in the last day, one at a time', async () => {
    db.action_tasks = [
      row('t1'),
      // Tried an hour ago: not again tonight.
      row('t2', {
        details: { check: 'auto', url: PAGE, autoCheck: { triedAt: '2026-10-27T02:00:00Z' } },
      }),
    ];
    const fetch = fetchOf({ [PAGE]: html('x') });
    expect(await sweepTaskChecks({ fetch, now })).toEqual({ checked: 1, passed: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
