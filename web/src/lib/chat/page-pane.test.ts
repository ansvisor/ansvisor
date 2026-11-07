import { describe, expect, it } from 'vitest';
import { PAGE_PARAM, SPLIT_MIN, openPageOf, withOpenPage } from './page-pane';

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

it('needs 300px of chat and a 600px editor side by side (Teknik T1)', () => {
  expect(SPLIT_MIN).toBe(900);
});
