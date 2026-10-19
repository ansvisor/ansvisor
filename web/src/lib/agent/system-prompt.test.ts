import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt } from './system-prompt';

describe('buildAgentSystemPrompt', () => {
  const now = new Date('2026-10-08T00:00:00.000Z');

  it('uses the conversation brand for unqualified questions', () => {
    const prompt = buildAgentSystemPrompt(now, {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Acme',
    });

    expect(prompt).toContain("The conversation's default brand is **Acme**");
    expect(prompt).toContain('id: `11111111-1111-1111-1111-111111111111`');
    expect(prompt).toContain('Use this brand for questions that do not name a brand explicitly.');
    expect(prompt).toContain(
      'If the user explicitly asks about another brand, use that brand instead.',
    );
    expect(prompt).toContain('Do not call list_brands just to resolve the default brand.');
  });

  it('falls back to brand selection when there is no conversation brand', () => {
    const prompt = buildAgentSystemPrompt(now);

    expect(prompt).toContain('This conversation has no default brand.');
    expect(prompt).toContain('resolve the available brands with `list_brands`');
    expect(prompt).toContain(
      "If there is no default brand and the user doesn't name one, call list_brands.",
    );
  });
});
