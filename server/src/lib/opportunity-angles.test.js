import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ANGLE_AFTER_DAYS,
  NIGHTLY_ANGLES,
  STILL_LOW_VISIBILITY,
  angleCandidates,
  angleLine,
} from './opportunity-angles.js';

const now = Date.parse('2026-11-03T12:00:00Z');
const daysAgo = (n) => new Date(now - n * 86_400_000).toISOString();

const cand = (id, over = {}) => ({
  id,
  topicId: 't1',
  score: 50,
  metrics: { tested: 3, visibility: 5 },
  ...over,
});
const row = (id, clusterId, over = {}) => ({
  id,
  title: `Opportunity ${id}`,
  status: 'done',
  created_at: daysAgo(60),
  cluster_id: clusterId,
  related_cluster_ids: [],
  ...over,
});
const pick = (candidates, rows, opts = {}) =>
  angleCandidates(candidates, rows, {
    covered: new Set(candidates.map((c) => c.id)),
    now,
    ...opts,
  }).map((c) => c.id);

describe('angleCandidates', () => {
  it('takes covered needs the brand is still barely seen for, best score first', () => {
    const candidates = [
      cand('c1', { score: 40 }),
      cand('c2', { score: 70 }),
      cand('c3', { metrics: { tested: 3, visibility: STILL_LOW_VISIBILITY } }),
      cand('c4', { metrics: { tested: 0, visibility: 0 } }),
    ];
    const rows = ['c1', 'c2', 'c3', 'c4'].map((c, i) => row(`o${i}`, c));
    expect(pick(candidates, rows)).toEqual(['c2', 'c1']);
  });

  it('waits until an open opportunity has had its 30 days', () => {
    const candidates = [cand('c1'), cand('c2')];
    const rows = [
      row('o1', 'c1', { status: 'new', created_at: daysAgo(ANGLE_AFTER_DAYS - 1) }),
      row('o2', 'c2', { status: 'in_progress', created_at: daysAgo(ANGLE_AFTER_DAYS) }),
    ];
    expect(pick(candidates, rows)).toEqual(['c2']);
  });

  it('skips a need dismissed as not mattering, and one with a fresh angle on it', () => {
    const candidates = [cand('c1'), cand('c2'), cand('c3')];
    const rows = [
      row('o1', 'c1', { status: 'dismissed', dismissReason: 'not_relevant' }),
      row('o2', 'c2', { status: 'dismissed', dismissReason: 'wrong_angle' }),
      row('o3', 'c3'),
      row('o4', 'c3', { status: 'new', created_at: daysAgo(2) }),
    ];
    expect(pick(candidates, rows)).toEqual(['c2']);
  });

  it('counts a merged need by the opportunity that took it in, and ignores archived ones', () => {
    const candidates = [cand('c1'), cand('c2')];
    const rows = [
      row('o1', 'c9', { status: 'new', created_at: daysAgo(3), related_cluster_ids: ['c1'] }),
      row('o2', 'c2', { status: 'archived' }),
    ];
    // c1's opportunity is fresh; c2 has only an archived one.
    expect(pick(candidates, rows)).toEqual([]);
  });

  it('keeps to covered needs in the focus, and names the newest opportunity as the original', () => {
    const candidates = [cand('c1'), cand('c2', { topicId: 't2' }), cand('c3')];
    const rows = [
      row('o1', 'c1', { created_at: daysAgo(90) }),
      row('o2', 'c1', { status: 'dismissed', created_at: daysAgo(40), decision: 'create' }),
      row('o3', 'c2'),
      row('o4', 'c3'),
    ];
    const picked = angleCandidates(candidates, rows, {
      covered: new Set(['c1', 'c2']),
      inFocus: (c) => c.topicId === 't1',
      now,
    });
    expect(picked.map((c) => c.id)).toEqual(['c1']);
    expect(picked[0].angleOf).toEqual({ id: 'o2', title: 'Opportunity o2', decision: 'create' });
  });
});

describe('angleCandidates at night', () => {
  const nightly = (candidates, rows) => pick(candidates, rows, { nightly: true });

  it('takes only needs whose opportunity has been done for 30 days, most demand first', () => {
    const candidates = [
      cand('c1', { metrics: { tested: 3, visibility: 5, demand: 900 } }),
      cand('c2', { metrics: { tested: 3, visibility: 5, demand: 4000 } }),
      cand('c3', { metrics: { tested: 3, visibility: 5, demand: 9000 } }),
      cand('c4', { metrics: { tested: 3, visibility: 5, demand: 9500 } }),
    ];
    const rows = [
      row('o1', 'c1', { updated_at: daysAgo(ANGLE_AFTER_DAYS) }),
      row('o2', 'c2', { updated_at: daysAgo(45) }),
      row('o3', 'c3', { updated_at: daysAgo(ANGLE_AFTER_DAYS - 1) }),
      row('o4', 'c4', { status: 'dismissed', updated_at: daysAgo(60) }),
    ];
    expect(nightly(candidates, rows)).toEqual(['c2', 'c1']);
  });

  it('leaves out a need still open, however old, and one the brand is seen for', () => {
    const candidates = [
      cand('c1'),
      cand('c2', { metrics: { tested: 3, visibility: 35, demand: 100 } }),
    ];
    const rows = [
      row('o1', 'c1', { status: 'new', created_at: daysAgo(200), updated_at: daysAgo(200) }),
      row('o2', 'c2', { updated_at: daysAgo(90) }),
    ];
    expect(nightly(candidates, rows)).toEqual([]);
  });
});

describe('angleLine', () => {
  it('tells the model what the need has and that this one must differ', () => {
    const line = angleLine({ title: 'Compare coffee subscriptions', decision: 'create' });
    expect(line).toContain('"Compare coffee subscriptions" (decided as "create")');
    expect(line).toContain('set sameAs to null');
  });
});

describe('the generator', () => {
  const code = readFileSync(
    fileURLToPath(new URL('./opportunity-generator.js', import.meta.url)),
    'utf8',
  );

  it('fills a New request, or a night with no need left, never a prompt or page request', () => {
    const flat = code.replace(/\s+/g, ' ');
    expect(flat).toContain('const nightly = count === undefined;');
    expect(flat).toContain(
      'targeted || promptId ? 0 : nightly ? (fresh.length ? 0 : NIGHTLY_ANGLES) : count - fresh.length;',
    );
    expect(flat).toContain('covered: coveredBefore, inFocus, nightly,');
    expect(NIGHTLY_ANGLES).toBe(1);
  });

  it('never folds an angle into another opportunity, and marks it as one', () => {
    expect(code).toContain('!cand.angleOf && Number.isInteger(opp.sameAs)');
    expect(code).toContain('alternativeOf || cand.angleOf');
  });
});
