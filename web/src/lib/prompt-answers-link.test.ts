import { describe, expect, it } from 'vitest';
import { PROMPT_ANSWERS_ANCHOR, promptAnswersHref } from './prompt-answers-link';

describe('promptAnswersHref', () => {
  it('opens the prompt page on its AI answers', () => {
    expect(promptAnswersHref('p1')).toBe('/dashboard/prompts/p1#ai-answers');
    expect(PROMPT_ANSWERS_ANCHOR).toBe('ai-answers');
  });
});
