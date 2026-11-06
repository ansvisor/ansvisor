// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * The product tour's words (owner decision 2026-11-06): scripted from the
 * Help articles, short, and in the person's answer language — translated
 * once by the small model and kept for everyone, English on any failure.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
const model = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: model.generateText,
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const {
  TOUR_SCRIPT_KEYS,
  checkedTexts,
  endTurn,
  englishScript,
  firstRunLine,
  jsonIn,
  scriptHash,
  topicTurn,
  tourTexts,
} = await import('./tour-script');

/** The English script with every text in "German": the model's answer. */
const german = () =>
  Object.fromEntries(Object.entries(englishScript()).map(([key, text]) => [key, `DE ${text}`]));

beforeEach(() => {
  db.tables = {};
  db.failures = {};
  model.generateText.mockReset();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the English script', () => {
  it('has every line, each a text of its own', () => {
    const texts = englishScript();
    expect(Object.keys(texts)).toEqual(TOUR_SCRIPT_KEYS);
    for (const [key, text] of Object.entries(texts)) expect(text.trim(), key).not.toBe('');
  });

  it('explains each page in three to five numbered points and one more line', () => {
    const texts = englishScript();
    for (const topic of ['visibility', 'prompts', 'positions', 'content', 'connections']) {
      const body = texts[`body.${topic}`];
      const points = body.split('\n').filter((line) => /^\d\. /.test(line));
      expect(points.length, topic).toBeGreaterThanOrEqual(3);
      expect(points.length, topic).toBeLessThanOrEqual(5);
      expect(body.split('\n').at(-1), topic).not.toMatch(/^\d\. /);
    }
  });

  it('writes the turn the person asked for: a topic, Next or everything, and the end', () => {
    const texts = englishScript();
    expect(topicTurn(texts, 'visibility', 'topic')).toEqual({
      question: 'Show me Visibility',
      answer: texts['body.visibility'],
    });
    expect(topicTurn(texts, 'content', 'next').question).toBe('Next: Content');
    expect(topicTurn(texts, 'visibility', 'everything').question).toBe('Show me everything');
    // Next never leads to the first topic: its own line stands in.
    expect(topicTurn(texts, 'visibility', 'next').question).toBe('Show me Visibility');
    expect(endTurn(texts)).toEqual({ question: 'End the tour', answer: texts.endLine });
    expect(texts.endLine).toContain('**Ask Chat**');
  });

  it('hashes the texts, so a changed text is a new translation', () => {
    const texts = englishScript();
    expect(scriptHash(texts)).toMatch(/^[0-9a-f]{64}$/);
    expect(scriptHash({ ...texts })).toBe(scriptHash(texts));
    expect(scriptHash({ ...texts, endLine: 'Bye.' })).not.toBe(scriptHash(texts));
  });
});

describe('checkedTexts and jsonIn', () => {
  it('keeps a translation with every key, each a text', () => {
    const english = englishScript();
    expect(checkedTexts(german(), english)).toEqual(german());
    expect(checkedTexts({ ...german(), extra: 'x' }, english)).toBeNull();
    const short: Record<string, string> = german();
    delete short.endLine;
    expect(checkedTexts(short, english)).toBeNull();
    expect(checkedTexts({ ...german(), endLine: '  ' }, english)).toBeNull();
    expect(checkedTexts({ ...german(), endLine: 'x'.repeat(5000) }, english)).toBeNull();
    expect(checkedTexts(null, english)).toBeNull();
  });

  it('reads the JSON object in an answer, fenced or not', () => {
    expect(jsonIn('```json\n{"a": "b"}\n```')).toEqual({ a: 'b' });
    expect(jsonIn('{"a": "b"}')).toEqual({ a: 'b' });
    expect(jsonIn('no object here')).toBeNull();
    expect(jsonIn('{broken')).toBeNull();
  });
});

describe('tourTexts', () => {
  it('answers English for English and for "Same as my question", with no model', async () => {
    await expect(tourTexts(null)).resolves.toEqual(englishScript());
    await expect(tourTexts('en')).resolves.toEqual(englishScript());
    expect(model.generateText).not.toHaveBeenCalled();
    expect(db.log).toEqual([]);
  });

  it('translates once by the small model and keeps it for everyone', async () => {
    model.generateText.mockResolvedValue({ text: JSON.stringify(german()) });
    await expect(tourTexts('de')).resolves.toEqual(german());
    expect(model.generateText).toHaveBeenCalledTimes(1);
    const call = model.generateText.mock.calls[0][0];
    expect(call.system).toContain('German');
    expect(call.system).toContain('stay in English');
    expect(JSON.parse(call.prompt)).toEqual(englishScript());
    expect(db.tables.chat_tour_translations).toEqual([
      expect.objectContaining({
        lang: 'de',
        source_hash: scriptHash(englishScript()),
        texts: german(),
        model: 'anthropic/claude-haiku-5.5',
      }),
    ]);

    // The next person reads it: no model.
    await expect(tourTexts('de')).resolves.toEqual(german());
    expect(model.generateText).toHaveBeenCalledTimes(1);
  });

  it('asks the model once for two people at the same time', async () => {
    model.generateText.mockResolvedValue({ text: JSON.stringify(german()) });
    await Promise.all([tourTexts('de'), tourTexts('de')]);
    expect(model.generateText).toHaveBeenCalledTimes(1);
  });

  it('translates again for a text that changed since', async () => {
    db.tables.chat_tour_translations = [
      { lang: 'de', source_hash: 'f'.repeat(64), texts: german(), model: 'old' },
    ];
    model.generateText.mockResolvedValue({ text: JSON.stringify(german()) });
    await tourTexts('de');
    expect(model.generateText).toHaveBeenCalledTimes(1);
  });

  it('stays in English without a key, on a bad answer, a failed call or a failed read', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expect(tourTexts('tr')).resolves.toEqual(englishScript());
    expect(model.generateText).not.toHaveBeenCalled();

    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    model.generateText.mockResolvedValueOnce({ text: '{"everything": "Hepsi"}' });
    await expect(tourTexts('tr')).resolves.toEqual(englishScript());
    model.generateText.mockRejectedValueOnce(new Error('overloaded'));
    await expect(tourTexts('tr')).resolves.toEqual(englishScript());
    expect(db.tables.chat_tour_translations ?? []).toEqual([]);

    db.failures.chat_tour_translations = { message: 'down' };
    await expect(tourTexts('tr')).resolves.toEqual(englishScript());
  });
});

describe('firstRunLine', () => {
  it('says about when the first results are in, in minutes, then hours, or without a time', () => {
    const texts = englishScript();
    expect(texts['firstRun.minutes']).toContain('{n}');
    expect(firstRunLine(texts, { minutes: 14.4 })).toBe(
      'Your first results are still coming in (about 14 min); this page fills in as they arrive.',
    );
    expect(firstRunLine(texts, { minutes: 150 })).toBe(
      'Your first results are still coming in (about 3 h); this page fills in as they arrive.',
    );
    expect(firstRunLine(texts, { minutes: null })).toBe(
      'Your first results are still coming in; this page fills in as they arrive.',
    );
  });

  it('keeps no translation that lost its {n}', () => {
    const english = englishScript();
    const lost = { ...german(), 'firstRun.minutes': 'DE ohne Zahl' };
    expect(checkedTexts(lost, english)).toBeNull();
  });
});
