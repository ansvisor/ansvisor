// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mergePages, pruneSelection } from './merge-pages';

const row = (key: string, status = 'good') => ({ key, status });

describe('mergePages', () => {
  it('patches a shown row in place, keeping the order', () => {
    const current = [row('a', 'running'), row('b'), row('c')];
    const fresh = [row('b'), row('a', 'good')];
    expect(mergePages(current, fresh, false)).toEqual([row('a', 'good'), row('b'), row('c')]);
  });

  it('keeps rows the read does not reach, so Load more is not undone', () => {
    const current = Array.from({ length: 150 }, (_, i) => row(`p${i}`));
    const fresh = current.slice(0, 100).map((p) => ({ ...p, status: 'needs_work' }));
    const merged = mergePages(current, fresh, false);
    expect(merged).toHaveLength(150);
    expect(merged[0].status).toBe('needs_work');
    expect(merged[149]).toEqual(row('p149'));
  });

  it('puts a newly listed page on top', () => {
    expect(mergePages([row('b')], [row('n'), row('b')], false).map((p) => p.key)).toEqual([
      'n',
      'b',
    ]);
  });

  it('drops a missing row only when the read covered the whole list', () => {
    expect(mergePages([row('a'), row('b')], [row('a')], false)).toHaveLength(2);
    expect(mergePages([row('a'), row('b')], [row('a')], true)).toEqual([row('a')]);
  });
});

describe('pruneSelection', () => {
  it('keeps selected keys the read does not reach', () => {
    const selected = new Set(['a', 'z']);
    expect([...pruneSelection(selected, [row('a')], false)]).toEqual(['a', 'z']);
  });

  it('drops a selected page that is now running', () => {
    const kept = pruneSelection(new Set(['a', 'b']), [row('a', 'running'), row('b')], false);
    expect([...kept]).toEqual(['b']);
  });

  it('drops a selected page that is gone once the read was complete', () => {
    expect([...pruneSelection(new Set(['a', 'z']), [row('a')], true)]).toEqual(['a']);
  });
});
