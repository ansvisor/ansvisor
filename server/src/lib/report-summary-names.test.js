import { describe, expect, it } from 'vitest';
import { engineOrModelName, namedSnapshot, referrerName } from './report-summary-names.js';

describe('engineOrModelName', () => {
  it('names an engine, and an API model by its engine', () => {
    expect(engineOrModelName('gemini-web')).toBe('Gemini');
    expect(engineOrModelName('gpt-5-chat-latest')).toBe('ChatGPT API');
    expect(engineOrModelName('claude-sonnet-5')).toBe('Claude API');
    expect(engineOrModelName('gemini-2.5-pro')).toBe('Gemini API');
  });

  it('keeps what it does not know', () => {
    expect(engineOrModelName('new-engine')).toBe('new-engine');
    expect(engineOrModelName('')).toBe('');
    expect(engineOrModelName(null)).toBeNull();
  });
});

describe('referrerName', () => {
  it('names an AI referrer as AI Traffic does', () => {
    expect(referrerName('gemini.google.com')).toBe('Gemini');
    expect(referrerName('example.com')).toBe('example.com');
  });
});

describe('namedSnapshot', () => {
  it('leaves the snapshot it was given alone', () => {
    const snapshot = { mentionEvidence: [{ platform: 'gemini-web' }] };
    const named = namedSnapshot(snapshot);
    expect(named.mentionEvidence[0].platform).toBe('Gemini');
    expect(snapshot.mentionEvidence[0].platform).toBe('gemini-web');
  });

  it('passes a snapshot without engine fields through', () => {
    expect(namedSnapshot({ brandName: 'B', visibilityRate: { score: 1 } })).toEqual({
      brandName: 'B',
      visibilityRate: { score: 1 },
    });
  });
});
