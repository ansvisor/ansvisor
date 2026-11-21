import { describe, expect, it } from 'vitest';
import { shownMentionEvidence } from './mention-evidence';

const row = (date: string, excerpt: string) => ({
  promptText: 'best seo tools',
  platform: 'chatgpt',
  date,
  mentionCount: 1,
  excerpt,
});

describe('shownMentionEvidence', () => {
  it('lists the newest first, each passage as plain text, and leaves the saved rows as they are', () => {
    const saved = [
      row('2026-11-02T10:00:00Z', '1\\. **Acme** leads'),
      row('2026-11-09T10:00:00Z', 'Acme, then [Rival](https://rival.example)'),
      row('2026-11-05T10:00:00Z', 'Acme'),
    ];
    expect(shownMentionEvidence(saved).map((r) => [r.date.slice(0, 10), r.excerpt])).toEqual([
      ['2026-11-09', 'Acme, then Rival'],
      ['2026-11-05', 'Acme'],
      ['2026-11-02', '1. Acme leads'],
    ]);
    expect(saved[0].excerpt).toBe('1\\. **Acme** leads');
  });
});
