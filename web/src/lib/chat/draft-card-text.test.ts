import { describe, expect, it } from 'vitest';
import { DRAFT_CARD_TEXT_MAX, draftCardText } from './draft-card-text';

describe('draftCardText', () => {
  it('reads a block a line, marks list items and drops tags', () => {
    expect(
      draftCardText(
        '<h2>Plans</h2><p>Every <b>plan</b> &amp; more.</p><ul><li>One</li><li>Two</li></ul>',
      ),
    ).toBe('Plans\nEvery plan & more.\n- One\n- Two');
  });

  it('cuts a very long page with a closing ellipsis', () => {
    const out = draftCardText(`<p>${'a'.repeat(DRAFT_CARD_TEXT_MAX + 10)}</p>`);
    expect(out).toHaveLength(DRAFT_CARD_TEXT_MAX);
    expect(out.endsWith('…')).toBe(true);
  });
});
