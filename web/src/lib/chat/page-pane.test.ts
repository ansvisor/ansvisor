import { describe, expect, it } from 'vitest';
import {
  PAGE_PARAM,
  SPLIT_MIN,
  chatWithPageHref,
  draftOfEditorHref,
  openPageOf,
  withOpenPage,
} from './page-pane';

/**
 * Open here's address (W4-15): `?page={draftId}` names the page beside the
 * chat, a draft's id only; Close takes it out and keeps the rest.
 */

const DRAFT = 'aaaaaaaa-1111-4111-8111-111111111111';

describe('openPageOf', () => {
  it("takes a draft's id, in lower case", () => {
    expect(openPageOf(DRAFT)).toBe(DRAFT);
    expect(openPageOf(DRAFT.toUpperCase())).toBe(DRAFT);
  });

  it('opens nothing for none or anything else', () => {
    expect(openPageOf(null)).toBeNull();
    expect(openPageOf(undefined)).toBeNull();
    expect(openPageOf('')).toBeNull();
    expect(openPageOf('nope')).toBeNull();
    expect(openPageOf(`${DRAFT}x`)).toBeNull();
    expect(openPageOf(`/dashboard/content/editor/${DRAFT}`)).toBeNull();
    expect(openPageOf('../../settings')).toBeNull();
  });
});

describe('withOpenPage', () => {
  it('sets the page, keeping the rest of the query', () => {
    expect(PAGE_PARAM).toBe('page');
    expect(withOpenPage('', DRAFT)).toBe(`?page=${DRAFT}`);
    expect(withOpenPage('?from=%2Fdashboard%2Fmentions', DRAFT)).toBe(
      `?from=%2Fdashboard%2Fmentions&page=${DRAFT}`,
    );
  });

  it('takes it out for Close, leaving no empty ?', () => {
    expect(withOpenPage(`?page=${DRAFT}`, null)).toBe('');
    expect(withOpenPage(`?from=%2Fdashboard%2Fmentions&page=${DRAFT}`, null)).toBe(
      '?from=%2Fdashboard%2Fmentions',
    );
  });
});

describe('draftOfEditorHref', () => {
  it("reads the draft a page's Content Editor address names", () => {
    expect(draftOfEditorHref(`/dashboard/content/editor/${DRAFT}`)).toBe(DRAFT);
    expect(draftOfEditorHref(`/dashboard/content/editor/${DRAFT}?tab=chat`)).toBe(DRAFT);
  });

  it('reads none from another address, or one that is no draft id', () => {
    expect(draftOfEditorHref('/dashboard/content/editor/d1')).toBeNull();
    expect(draftOfEditorHref(`/dashboard/reports/${DRAFT}`)).toBeNull();
    expect(draftOfEditorHref(`https://x.test/dashboard/content/editor/${DRAFT}`)).toBeNull();
  });
});

describe('chatWithPageHref (W4-15b)', () => {
  const CHAT = '33333333-3333-4333-8333-333333333333';

  it("is the chat's full page with the page beside it, and the page it came from", () => {
    expect(chatWithPageHref(CHAT, DRAFT, '/dashboard/mentions?range=7d')).toBe(
      `/dashboard/chat/${CHAT}?from=%2Fdashboard%2Fmentions%3Frange%3D7d&page=${DRAFT}`,
    );
    const query = new URLSearchParams(
      chatWithPageHref(CHAT, DRAFT, '/dashboard/mentions').split('?')[1],
    );
    expect(openPageOf(query.get(PAGE_PARAM))).toBe(DRAFT);
    expect(query.get('from')).toBe('/dashboard/mentions');
  });

  it('names no page it came from without one', () => {
    expect(chatWithPageHref(CHAT, DRAFT)).toBe(`/dashboard/chat/${CHAT}?page=${DRAFT}`);
    expect(chatWithPageHref(CHAT, DRAFT, '')).toBe(`/dashboard/chat/${CHAT}?page=${DRAFT}`);
  });
});

it('needs 300px of chat and a 600px editor side by side (Teknik T1)', () => {
  expect(SPLIT_MIN).toBe(900);
});
