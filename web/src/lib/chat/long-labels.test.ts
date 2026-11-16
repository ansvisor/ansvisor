// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { PAGE_LABEL_CHARS, messageScopeOf, startRunInput } = await import('./engine');

/**
 * A chip or an "Ask about this" label longer than 200 characters (G8 of the
 * Chat page-data audit, 2026-11-16): a prompt's text is up to 500, and the
 * Citations prompt filter and Prompts' Ask about this send it as a label.
 * The message must still send.
 */

const PROMPT = `Which ${'very '.repeat(80)}long CRM prompt is this?`;

describe('a long chip or reference label', () => {
  it('still sends the message', () => {
    expect(PROMPT.length).toBeGreaterThan(400);
    const parsed = startRunInput.safeParse({
      message: 'Why did this prompt drop?',
      context: {
        route: '/dashboard/citations',
        chips: [{ key: 'filter:prompt', label: PROMPT, value: PROMPT }],
      },
      references: [{ type: 'prompt', id: '11111111-1111-4111-8111-111111111111', label: PROMPT }],
    });
    expect(parsed.success).toBe(true);
    // Kept, cut to the label's 200 characters: what the run's scope and the stored message read.
    const { context, references } = parsed.data!;
    for (const label of [context!.chips[0].label, context!.chips[0].value!, references![0].label]) {
      expect(label).toHaveLength(PAGE_LABEL_CHARS);
      expect(label.endsWith('…')).toBe(true);
      expect(PROMPT.startsWith(label.slice(0, -1))).toBe(true);
    }
    expect(messageScopeOf(parsed.data!)).toMatchObject({
      context: { chips: [{ label: context!.chips[0].label }] },
      references: [{ label: references![0].label }],
    });
  });

  it('keeps a short label as it is, and still refuses one far past any prompt', () => {
    const short = startRunInput.parse({
      message: 'Hi',
      context: { chips: [{ key: 'page', label: 'Citations' }] },
    });
    expect(short.context!.chips[0].label).toBe('Citations');
    const huge = { key: 'page', label: 'x'.repeat(2_001) };
    expect(startRunInput.safeParse({ message: 'Hi', context: { chips: [huge] } }).success).toBe(
      false,
    );
  });

  it('never ends a cut label in half an emoji', () => {
    const emoji = `${'a'.repeat(PAGE_LABEL_CHARS - 2)}😀😀😀`;
    const parsed = startRunInput.parse({
      message: 'Hi',
      references: [{ type: 'prompt', id: 'p1', label: emoji }],
    });
    expect(parsed.references![0].label).toBe(`${'a'.repeat(PAGE_LABEL_CHARS - 2)}…`);
  });
});
