import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import {
  DRAFT_STATUSES,
  PAGE_TYPES,
  WRITING_STALE_MS,
  agentStateOf,
  contentEditorPath,
  draftsCreatedIn,
  draftsInTab,
  isPageType,
  libraryTabCounts,
  type ContentDraftListItem,
  type DraftStatus,
} from './drafts';

const draft = (id: string, status: DraftStatus): ContentDraftListItem => ({
  id,
  title: id,
  pageType: 'feature_page',
  method: 'create',
  status,
  author: 'user',
  createdBy: null,
  isMine: true,
  agentState: null,
  createdAt: '2026-10-18T09:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  archivedAt: null,
});

const drafts = [
  draft('a', 'draft'),
  draft('b', 'in_review'),
  draft('c', 'in_review'),
  draft('d', 'published'),
];

describe('the Library’s Created filter', () => {
  const at = (id: string, createdAt: string) => ({ ...draft(id, 'draft'), createdAt });
  const now = Date.parse('2026-10-22T12:00:00Z');
  const list = [
    at('today', '2026-10-22T08:00:00Z'),
    at('week', '2026-10-16T12:00:00Z'),
    at('month', '2026-09-25T12:00:00Z'),
    at('old', '2026-06-01T12:00:00Z'),
  ];
  const ids = (range: Parameters<typeof draftsCreatedIn>[1]) =>
    draftsCreatedIn(list, range, now).map((d) => d.id);

  it('keeps the drafts created in the range, counted back from now', () => {
    expect(ids('all')).toEqual(['today', 'week', 'month', 'old']);
    expect(ids('7d')).toEqual(['today', 'week']);
    expect(ids('30d')).toEqual(['today', 'week', 'month']);
    expect(ids('90d')).toEqual(['today', 'week', 'month']);
  });
});

describe('the Library tabs', () => {
  it('counts every draft under All and each under its status', () => {
    expect(libraryTabCounts(drafts)).toEqual({
      all: 4,
      draft: 1,
      in_review: 2,
      ready: 0,
      published: 1,
      archived: 0,
    });
  });

  it('lists a tab’s drafts in their order, and every draft under All', () => {
    expect(draftsInTab(drafts, 'in_review').map((d) => d.id)).toEqual(['b', 'c']);
    expect(draftsInTab(drafts, 'ready')).toEqual([]);
    expect(draftsInTab(drafts, 'all')).toEqual(drafts);
  });

  it('keeps archived drafts under Archived only, with their status kept for Restore', () => {
    const shelved = { ...draft('e', 'published'), archivedAt: '2026-10-21T08:00:00Z' };
    const all = [...drafts, shelved];
    expect(libraryTabCounts(all)).toMatchObject({ all: 4, published: 1, archived: 1 });
    expect(draftsInTab(all, 'all').map((d) => d.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(draftsInTab(all, 'published').map((d) => d.id)).toEqual(['d']);
    expect(draftsInTab(all, 'archived')).toEqual([shelved]);
  });
});

describe('page types and labels', () => {
  it('names every page type, status and method', () => {
    const editor = messages.contentEditor;
    for (const type of PAGE_TYPES) expect(editor.pageTypes[type]).toBeTruthy();
    for (const status of DRAFT_STATUSES) {
      expect(editor.status[status]).toBeTruthy();
      expect(editor.library.tabs[status]).toBeTruthy();
    }
    expect(editor.method.create).toBeTruthy();
    expect(editor.method.optimize).toBeTruthy();
  });

  it('knows a stored key from anything else', () => {
    expect(isPageType('product_page')).toBe(true);
    expect(isPageType('landing')).toBe(false);
    expect(isPageType(null)).toBe(false);
  });

  it('opens a draft in the editor', () => {
    expect(contentEditorPath('d1')).toBe('/dashboard/content/editor/d1');
  });
});

describe('agentStateOf', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  it('reads the agent writing, failed, or done — a writing left long ago as failed', () => {
    expect(agentStateOf(null, null, now)).toBeNull();
    expect(agentStateOf('failed', '2026-10-21T11:59:00Z', now)).toBe('failed');
    expect(agentStateOf('writing', '2026-10-21T11:58:00Z', now)).toBe('writing');
    expect(agentStateOf('writing', new Date(now - WRITING_STALE_MS - 1).toISOString(), now)).toBe(
      'failed',
    );
    expect(agentStateOf('writing', null, now)).toBe('failed');
  });
});
