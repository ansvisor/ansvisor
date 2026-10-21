import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import {
  DRAFT_STATUSES,
  PAGE_TYPES,
  WRITING_STALE_MS,
  aeoScoreText,
  agentStateOf,
  contentEditorPath,
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
  scoreBefore: null,
  scoreAfter: null,
  agentState: null,
  updatedAt: '2026-10-20T10:00:00Z',
});

const drafts = [
  draft('a', 'draft'),
  draft('b', 'in_review'),
  draft('c', 'in_review'),
  draft('d', 'published'),
];

describe('the Library tabs', () => {
  it('counts every draft under All and each under its status', () => {
    expect(libraryTabCounts(drafts)).toEqual({
      all: 4,
      draft: 1,
      in_review: 2,
      ready: 0,
      published: 1,
    });
  });

  it('lists a tab’s drafts in their order, and every draft under All', () => {
    expect(draftsInTab(drafts, 'in_review').map((d) => d.id)).toEqual(['b', 'c']);
    expect(draftsInTab(drafts, 'ready')).toEqual([]);
    expect(draftsInTab(drafts, 'all')).toBe(drafts);
  });
});

describe('aeoScoreText', () => {
  it('shows before → after once the changes are scored', () => {
    expect(aeoScoreText(62, 78)).toBe('62 → 78');
  });

  it('shows the one score there is, or nothing', () => {
    expect(aeoScoreText(54, null)).toBe('54');
    expect(aeoScoreText(null, 81)).toBe('81');
    expect(aeoScoreText(70, 70)).toBe('70');
    expect(aeoScoreText(null, null)).toBeNull();
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
