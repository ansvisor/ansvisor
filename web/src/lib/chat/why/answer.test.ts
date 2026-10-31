// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

/**
 * The evidence drawer's passage (CHAT-22 §1 item 4): a short cut of the
 * engine's answer around the brand's first mention, the name marked.
 */

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { passageAround } = await import('./answer');

describe('passageAround', () => {
  it('marks every mention of the name, whatever its case', () => {
    expect(passageAround('Acme and  lumora.\nACME again.', 'acme')).toEqual([
      { text: 'Acme', mark: true },
      { text: ' and lumora. ', mark: false },
      { text: 'ACME', mark: true },
      { text: ' again.', mark: false },
    ]);
  });

  it('cuts a long answer around the first mention, with an ellipsis each side', () => {
    const text = `${'a '.repeat(300)}Acme is cited.${' b'.repeat(300)}`;
    const passage = passageAround(text, 'Acme');
    expect(passage[0]).toEqual({ text: '…', mark: false });
    expect(passage.at(-1)).toEqual({ text: '…', mark: false });
    expect(passage.filter((p) => p.mark).map((p) => p.text)).toEqual(['Acme']);
    expect(passage.map((p) => p.text).join('').length).toBeLessThanOrEqual(322);
  });

  it('shows the start, unmarked, when the brand isn’t named', () => {
    const passage = passageAround(`Lumora leads. ${'x'.repeat(400)}`, 'Acme');
    expect(passage).toHaveLength(2);
    expect(passage[0].text.startsWith('Lumora leads.')).toBe(true);
    expect(passage.some((p) => p.mark)).toBe(false);
    expect(passageAround('Lumora leads.', '')).toEqual([{ text: 'Lumora leads.', mark: false }]);
  });
});
