import { describe, expect, it } from 'vitest';
import { DRAFT_CHIP, openDraftOf } from './editor-page';

const DRAFT = '33333333-3333-4333-8333-333333333333';
const ROUTE = `/dashboard/content/editor/${DRAFT}`;

describe('the page open in the editor beside the chat (W4-14)', () => {
  it('reads the draft chip sent from the editor’s own page', () => {
    expect(
      openDraftOf({
        context: { route: ROUTE, chips: [{ key: DRAFT_CHIP, label: 'This draft', value: DRAFT }] },
      } as never),
    ).toBe(DRAFT);
  });

  it('reads none without the chip, from another page, or with a value that isn’t an id', () => {
    expect(openDraftOf(null)).toBeNull();
    expect(openDraftOf({ context: { route: ROUTE, chips: [] } })).toBeNull();
    expect(
      openDraftOf({
        context: {
          route: '/dashboard/content/library',
          chips: [{ key: DRAFT_CHIP, value: DRAFT }],
        },
      }),
    ).toBeNull();
    expect(
      openDraftOf({ context: { route: ROUTE, chips: [{ key: DRAFT_CHIP, value: 'not-an-id' }] } }),
    ).toBeNull();
  });
});
