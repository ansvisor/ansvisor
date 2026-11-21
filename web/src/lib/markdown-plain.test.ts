import { describe, expect, it } from 'vitest';
import { markdownToPlainText } from './markdown-plain';

describe('markdownToPlainText', () => {
  it('reads escapes as their characters, and drops list, heading and quote marks', () => {
    expect(markdownToPlainText('1\\. **Ahrefs** is the best\n2\\. Semrush \\*new\\*')).toBe(
      '1. Ahrefs is the best 2. Semrush *new*',
    );
    expect(markdownToPlainText('## Top tools\n> Quoted\n- one\n* two')).toBe(
      'Top tools Quoted one two',
    );
  });

  it('keeps link and image words, and drops addresses, code ticks and table rules', () => {
    expect(
      markdownToPlainText(
        'See [Acme](https://acme.example) ![logo](x.png) at https://acme.example/x and `code`',
      ),
    ).toBe('See Acme logo at and code');
    expect(markdownToPlainText('| Tool | Score |\n|---|---:|\n| Acme | 9 |')).toBe(
      'Tool Score Acme 9',
    );
  });

  it('drops entity tags and folds whitespace', () => {
    expect(markdownToPlainText('  <Entity category="software" value="Acme"/>\n\n leads  ')).toBe(
      'Acme leads',
    );
  });
});
