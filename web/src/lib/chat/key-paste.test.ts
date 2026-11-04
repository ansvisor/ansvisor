import { describe, expect, it } from 'vitest';
import { asksToAddKey, looksLikeApiKey, pastedKeyOf, withoutApiKeys } from './key-paste';

/** Pasted API keys in the composer (W4-05): found by shape, taken out, never sent. */

// Made-up keys in each provider's shape.
const ANTHROPIC = `sk-ant-api03-${'a1B2'.repeat(10)}`;
const OPENROUTER = `sk-or-v1-${'0f'.repeat(32)}`;
const OPENAI_PROJECT = `sk-proj-${'Xy9_'.repeat(12)}`;
const OPENAI = `sk-${'Q7x'.repeat(16)}`;
const GOOGLE = `AIza${'Sy0-'.repeat(9)}`;

describe('pastedKeyOf', () => {
  it('finds each provider’s key by its prefix', () => {
    expect(pastedKeyOf(`use ${ANTHROPIC} please`)).toEqual({
      provider: 'anthropic',
      key: ANTHROPIC,
    });
    expect(pastedKeyOf(OPENROUTER)?.provider).toBe('openrouter');
    expect(pastedKeyOf(`key: ${OPENAI_PROJECT}`)).toEqual({
      provider: 'openai',
      key: OPENAI_PROJECT,
    });
    expect(pastedKeyOf(OPENAI)?.provider).toBe('openai');
    expect(pastedKeyOf(GOOGLE)?.provider).toBe('google');
  });

  it('leaves ordinary words, slugs and short ids alone', () => {
    for (const text of [
      'Why did our sk-learn page drop?',
      'task-1234567890abcdefghij is done',
      'Compare AIza and AI Mode',
      'sk-short',
      'https://example.com/blog/ask-the-expert-about-seo-in-2026',
      'Open /sk-guide-to-ai-search-in-2026 in the editor',
      '',
    ]) {
      expect(looksLikeApiKey(text), text).toBe(false);
    }
  });
});

describe('withoutApiKeys', () => {
  it('takes every key out and keeps the rest of the message', () => {
    expect(withoutApiKeys(`Use my key ${ANTHROPIC} for Chat`)).toBe('Use my key for Chat');
    expect(withoutApiKeys(`${OPENAI}\nand ${GOOGLE} too`)).toBe('and too');
    expect(withoutApiKeys(OPENROUTER)).toBe('');
    expect(looksLikeApiKey(withoutApiKeys(`a ${OPENAI_PROJECT} b ${ANTHROPIC}`))).toBe(false);
  });

  it('leaves a message without a key as it is', () => {
    expect(withoutApiKeys('Why did ChatGPT visibility drop?')).toBe(
      'Why did ChatGPT visibility drop?',
    );
  });
});

describe('asksToAddKey (W4-06)', () => {
  it('finds a request to use or add the person’s own key', () => {
    for (const text of [
      'use my OpenAI key',
      'Can you use our Anthropic API key from now on?',
      'add my openrouter api key',
      'I want to connect my key',
    ]) {
      expect(asksToAddKey(text), text).toBe(true);
    }
  });

  it('leaves other questions about keys to Chat', () => {
    for (const text of [
      'Which keywords drive our citations?',
      'What is the key takeaway from last week?',
      'Use the key metrics from my report',
      'How do API keys work in Ansvisor?',
      // "Key" as a word of the question, not a key to add.
      'Add our key competitors to the brief',
      'Use our key topics to write an outline',
      'Use my key prompts and key pages for the report.',
      'Add my key takeaways.',
    ]) {
      expect(asksToAddKey(text), text).toBe(false);
    }
  });
});
