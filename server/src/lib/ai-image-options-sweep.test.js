import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../config/supabase.js', () => ({ default: {} }));

import { logger } from './logger.js';
import {
  CONTENT_IMAGE_BUCKET,
  LIST_PAGE,
  REMOVE_BATCH,
  sweepAiImageOptions,
} from './ai-image-options-sweep.js';

/** The Content Editor's AI image options nobody kept (W4-09): gone after a day. */

const NOW = new Date('2026-11-05T02:00:00.000Z');
const OLD = '2026-11-03T12:00:00.000Z'; // 38 hours before
const NEW = '2026-11-04T20:00:00.000Z'; // 6 hours before

/**
 * A fake storage bucket over a flat list of objects ({ path, created_at,
 * updated_at }), listing as Supabase's v1 list does: the entries directly
 * under a prefix, folders with a null id, by name, a page at a time.
 * `failList` / `failRemove` name the prefixes whose calls fail.
 */
function fakeDb(objects, { failList = [], failRemove = [] } = {}) {
  const calls = { list: [], remove: [] };
  const bucketCalls = [];
  const bucket = {
    list: async (prefix, { limit = 100, offset = 0 } = {}) => {
      calls.list.push({ prefix, limit, offset });
      if (failList.includes(prefix)) return { data: null, error: { message: 'storage down' } };
      const base = prefix ? `${prefix}/` : '';
      const entries = new Map();
      for (const object of objects) {
        if (!object.path.startsWith(base)) continue;
        const [name, ...rest] = object.path.slice(base.length).split('/');
        if (rest.length > 0) {
          entries.set(name, {
            name,
            id: null,
            created_at: null,
            updated_at: null,
            metadata: null,
          });
        } else {
          entries.set(name, {
            name,
            id: `id-${object.path}`,
            created_at: object.created_at ?? null,
            updated_at: object.updated_at ?? object.created_at ?? null,
            metadata: { size: 1 },
          });
        }
      }
      const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
      return { data: sorted.slice(offset, offset + limit), error: null };
    },
    remove: async (paths) => {
      calls.remove.push(paths);
      if (paths.some((path) => failRemove.some((prefix) => path.startsWith(`${prefix}/`)))) {
        return { data: null, error: { message: 'storage down' } };
      }
      const removed = [];
      for (const path of paths) {
        const i = objects.findIndex((object) => object.path === path);
        if (i >= 0) removed.push({ name: objects.splice(i, 1)[0].path });
      }
      return { data: removed, error: null };
    },
  };
  return {
    calls,
    bucketCalls,
    storage: {
      from: (name) => {
        bucketCalls.push(name);
        return bucket;
      },
    },
  };
}

const file = (path, created_at, updated_at) => ({ path, created_at, updated_at });
const paths = (objects) => objects.map((object) => object.path).sort();

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('sweepAiImageOptions', () => {
  it('removes only old files in ai-options/, never an image a page shows', async () => {
    const objects = [
      file('org-1/ai-options/a.png', OLD),
      file('org-1/kept.png', OLD), // a picked option, moved out
      file('org-1/upload.jpg', OLD), // an upload
      file('org-1/other/ai-options/x.png', OLD), // not an organization's ai-options/
      file('org-1/ai-options/nested/y.png', OLD), // a folder inside ai-options/
      file('org-2/ai-options/b.webp', OLD),
      file('org-2/ai-options-old/c.png', OLD),
      file('stray.png', OLD), // a file at the top, not an organization's folder
    ];
    const db = fakeDb(objects);
    const result = await sweepAiImageOptions({ db, now: NOW });
    expect(result).toEqual({ removed: 2, organizations: 2, failed: 0 });
    expect(db.calls.remove.flat().sort()).toEqual([
      'org-1/ai-options/a.png',
      'org-2/ai-options/b.webp',
    ]);
    expect(paths(objects)).toEqual([
      'org-1/ai-options/nested/y.png',
      'org-1/kept.png',
      'org-1/other/ai-options/x.png',
      'org-1/upload.jpg',
      'org-2/ai-options-old/c.png',
      'stray.png',
    ]);
    expect(new Set(db.bucketCalls)).toEqual(new Set([CONTENT_IMAGE_BUCKET]));
    expect(logger.info).toHaveBeenCalledWith(
      { removed: 2, organizations: 2, failed: 0 },
      expect.any(String),
    );
  });

  it('keeps an option younger than a day, or one with no time to read', async () => {
    const objects = [
      file('org-1/ai-options/old.png', OLD),
      file('org-1/ai-options/new.png', NEW),
      file('org-1/ai-options/touched.png', OLD, NEW), // updated since
      file('org-1/ai-options/exactly-a-day.png', '2026-11-04T02:00:00.000Z'),
      file('org-1/ai-options/no-time.png', null, null),
    ];
    const db = fakeDb(objects);
    const result = await sweepAiImageOptions({ db, now: NOW });
    expect(result.removed).toBe(1);
    expect(db.calls.remove).toEqual([['org-1/ai-options/old.png']]);
    expect(paths(objects)).toEqual([
      'org-1/ai-options/exactly-a-day.png',
      'org-1/ai-options/new.png',
      'org-1/ai-options/no-time.png',
      'org-1/ai-options/touched.png',
    ]);
  });

  it('counts only what storage says it removed', async () => {
    const objects = [file('org-1/ai-options/a.png', OLD), file('org-1/ai-options/b.png', OLD)];
    const db = fakeDb(objects);
    const remove = db.storage.from(CONTENT_IMAGE_BUCKET).remove;
    // The dialog's own drop took b.png between the listing and the sweep's remove.
    db.storage.from(CONTENT_IMAGE_BUCKET).remove = async (batch) => {
      objects.splice(
        objects.findIndex((object) => object.path === 'org-1/ai-options/b.png'),
        1,
      );
      return remove(batch);
    };
    const result = await sweepAiImageOptions({ db, now: NOW });
    expect(result).toEqual({ removed: 1, organizations: 1, failed: 0 });
    expect(objects).toEqual([]);
  });

  it('makes no remove call for an organization with nothing to remove', async () => {
    const db = fakeDb([file('org-1/upload.jpg', OLD), file('org-2/ai-options/n.png', NEW)]);
    expect(await sweepAiImageOptions({ db, now: NOW })).toEqual({
      removed: 0,
      organizations: 2,
      failed: 0,
    });
    expect(db.calls.remove).toEqual([]);
  });

  it('goes on past an organization storage fails for, and never throws', async () => {
    const objects = [
      file('org-1/ai-options/a.png', OLD),
      file('org-2/ai-options/b.png', OLD),
      file('org-3/ai-options/c.png', OLD),
      file('org-4/ai-options/d.png', OLD),
    ];
    const db = fakeDb(objects, {
      failList: ['org-1/ai-options'],
      failRemove: ['org-3/ai-options'],
    });
    const result = await sweepAiImageOptions({ db, now: NOW });
    expect(result).toEqual({ removed: 2, organizations: 4, failed: 2 });
    expect(paths(objects)).toEqual(['org-1/ai-options/a.png', 'org-3/ai-options/c.png']);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
      expect.any(String),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-3' }),
      expect.any(String),
    );
  });

  it('removes nothing when the organizations can’t be listed, and never throws', async () => {
    const objects = [file('org-1/ai-options/a.png', OLD)];
    const db = fakeDb(objects, { failList: [''] });
    expect(await sweepAiImageOptions({ db, now: NOW })).toEqual({
      removed: 0,
      organizations: 0,
      failed: 0,
    });
    expect(db.calls.remove).toEqual([]);
    expect(objects).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('lists every page of organizations before removing, so none is skipped', async () => {
    // Each organization has only its ai-options/: removing its last file
    // takes its folder out of the top listing, which would shift the pages.
    const count = LIST_PAGE * 2 + 5;
    const objects = Array.from({ length: count }, (_, i) =>
      file(`org-${String(i).padStart(4, '0')}/ai-options/a.png`, OLD),
    );
    const db = fakeDb(objects);
    const result = await sweepAiImageOptions({ db, now: NOW });
    expect(result).toEqual({ removed: count, organizations: count, failed: 0 });
    expect(objects).toHaveLength(0);
    const top = db.calls.list.filter((call) => call.prefix === '');
    expect(top.map((call) => call.offset)).toEqual([0, LIST_PAGE, LIST_PAGE * 2]);
  });

  it('lists every page of an organization’s options and removes them in batches', async () => {
    const count = REMOVE_BATCH + LIST_PAGE + 7;
    const objects = [
      ...Array.from({ length: count }, (_, i) =>
        file(`org-1/ai-options/${String(i).padStart(5, '0')}.png`, OLD),
      ),
      file('org-1/ai-options/zz-new.png', NEW),
    ];
    const db = fakeDb(objects);
    const result = await sweepAiImageOptions({ db, now: NOW });
    expect(result.removed).toBe(count);
    expect(db.calls.remove.map((batch) => batch.length)).toEqual([REMOVE_BATCH, LIST_PAGE + 7]);
    expect(paths(objects)).toEqual(['org-1/ai-options/zz-new.png']);
    const pages = db.calls.list.filter((call) => call.prefix === 'org-1/ai-options');
    expect(pages).toHaveLength(Math.floor((count + 1) / LIST_PAGE) + 1);
    expect(pages.every((call) => call.limit === LIST_PAGE)).toBe(true);
  });
});
