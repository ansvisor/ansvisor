import { describe, expect, it } from 'vitest';
import { lastingPreference, rememberOffer, type RememberFacts } from './offer';

/**
 * "Remember this?" (CHAT-14 item 9, W4-33): the line offered under an
 * answer: the writing model's flag, else the person's own lasting
 * preference; never an explicit "remember", a question, a line memory
 * can't keep or one already saved; once a conversation, for a person
 * watching who can save it.
 */

const facts = (over: Partial<RememberFacts> = {}): RememberFacts => ({
  question: 'From now on, write blog posts in US English.',
  flagged: null,
  canSave: true,
  attended: true,
  handled: false,
  offeredBefore: false,
  existing: [],
  ...over,
});

describe('lastingPreference', () => {
  it('finds the sentence that sets how to work from now on, in English, Turkish and German', () => {
    expect(lastingPreference('Thanks! From now on, write blog posts in US English.')).toBe(
      'From now on, write blog posts in US English',
    );
    expect(lastingPreference('Always use sentence-case headings')).toBe(
      'Always use sentence-case headings',
    );
    expect(lastingPreference('Never mention competitors by name in drafts.')).toBe(
      'Never mention competitors by name in drafts',
    );
    expect(lastingPreference('Bundan sonra raporları PDF olarak gönder.')).toBe(
      'Bundan sonra raporları PDF olarak gönder',
    );
    expect(lastingPreference('Ab jetzt bitte auf Deutsch antworten.')).toBe(
      'Ab jetzt bitte auf Deutsch antworten',
    );
  });

  it('finds none in a question, a one-off request, an explicit remember, or a line memory can’t keep', () => {
    expect(lastingPreference('Why does ChatGPT always cite rival.example?')).toBeNull();
    expect(lastingPreference('Write a pricing FAQ for /pricing')).toBeNull();
    expect(lastingPreference('Remember that we always use US English')).toBeNull();
    expect(lastingPreference('Bunu hatırla: her zaman kısa yaz')).toBeNull();
    expect(lastingPreference('From now on, email drafts to cihan@example.com')).toBeNull();
  });
});

describe('rememberOffer', () => {
  it('offers the model’s line first, else the message’s own preference', () => {
    expect(rememberOffer(facts({ flagged: '  Blog posts use US English ' }))).toBe(
      'Blog posts use US English',
    );
    expect(rememberOffer(facts())).toBe('From now on, write blog posts in US English');
    // A flag memory can't keep falls back to the message.
    expect(rememberOffer(facts({ flagged: 'Call me on +1 555 123 4567' }))).toBe(
      'From now on, write blog posts in US English',
    );
  });

  it('offers nothing when it can’t be saved, nobody is watching, it was handled, or offered before', () => {
    expect(rememberOffer(facts({ canSave: false }))).toBeNull();
    expect(rememberOffer(facts({ attended: false }))).toBeNull();
    expect(rememberOffer(facts({ handled: true }))).toBeNull();
    expect(rememberOffer(facts({ offeredBefore: true }))).toBeNull();
    expect(
      rememberOffer(facts({ question: 'Remember that we write in US English', flagged: 'x y' })),
    ).toBeNull();
  });

  it('offers nothing already saved, nor for a message with no lasting preference', () => {
    expect(
      rememberOffer(facts({ existing: ['from now on, write blog posts in US English'] })),
    ).toBeNull();
    expect(rememberOffer(facts({ question: 'How are we doing on ChatGPT?' }))).toBeNull();
  });
});
