import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AI-written text in the reader's language (LOC-010): kept translations
 * first, the rest translated in batches and kept; rows of brands the caller
 * can't read never translated.
 */

const db = vi.hoisted(() => ({
  rows: [],
  kept: [],
  upserts: [],
  reads: [],
}));
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, filters: [] };
      db.reads.push(call);
      const chain = {
        select: () => chain,
        eq: (col, v) => (call.filters.push(['eq', col, v]), chain),
        in: (col, v) => (call.filters.push(['in', col, v]), chain),
        upsert: async (rows, opts) => {
          db.upserts.push({ table, rows, opts });
          return { error: null };
        },
        then: (resolve) =>
          resolve({ data: table === 'ai_text_translations' ? db.kept : db.rows, error: null }),
      };
      return chain;
    },
  },
}));
const readable = vi.hoisted(() => ({ ids: new Set(['b1']) }));
vi.mock('./access.js', () => ({
  readableBrandIds: vi.fn(async (_user, ids) => new Set(ids.filter((id) => readable.ids.has(id)))),
}));
vi.mock('./ai-provider.js', () => ({ resolveModel: vi.fn((id) => `model:${id}`) }));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
const generateText = vi.hoisted(() => vi.fn());
vi.mock('ai', () => ({ generateText }));

const {
  forgetFailedTranslations,
  hashText,
  makeBatches,
  parseJsonReply,
  recommendationField,
  systemPrompt,
  translatedTexts,
  translationProblems,
} = await import('./ai-text-translate.js');

const O1 = '11111111-1111-4111-8111-111111111111';
const O2 = '22222222-2222-4222-8222-222222222222';
const reply = (items) => ({ text: JSON.stringify({ items }) });

beforeEach(() => {
  forgetFailedTranslations();
  db.rows = [
    {
      id: O1,
      brand_id: 'b1',
      title: 'Compare AI visibility trackers for 2026',
      description: 'Competitors lead on 12 prompts in ChatGPT.',
    },
    // Another organization's: never translated.
    { id: O2, brand_id: 'other', title: 'Their opportunity', description: null },
  ];
  db.kept = [];
  db.upserts = [];
  db.reads = [];
  readable.ids = new Set(['b1']);
  generateText.mockReset();
});

describe('translationProblems', () => {
  it('keeps a translation with the source’s numbers, links and names', () => {
    expect(
      translationProblems(
        'Competitors lead on 12 prompts in ChatGPT, 4.5% more: https://acme.example/x',
        'Rakipler ChatGPT’de 12 prompt’ta önde, %4,5 daha fazla: https://acme.example/x',
      ),
    ).toEqual([]);
  });

  it('turns down a changed number, a lost link or name, an empty or runaway text', () => {
    expect(translationProblems('Lead on 12 prompts', '13 prompt’ta önde')).toEqual([
      'its numbers differ from the source',
    ]);
    expect(translationProblems('See https://a.example', 'Bakın')).toEqual([
      'its links differ from the source',
    ]);
    expect(translationProblems('Win in ChatGPT', 'Sohbet robotunda kazan')).toEqual([
      '"ChatGPT" must stay as it is',
    ]);
    expect(translationProblems('Hi', '  ')).toEqual(['empty']);
    expect(translationProblems('Hi', 'x'.repeat(200))).toEqual(['far longer than the source']);
  });
});

describe('the helpers', () => {
  it('hashes, batches and reads a reply in code fences', () => {
    expect(hashText('a')).toHaveLength(16);
    expect(hashText('a')).not.toBe(hashText('b'));
    const items = Array.from({ length: 45 }, (_, i) => ({ id: String(i), text: 'x' }));
    expect(makeBatches(items).map((b) => b.length)).toEqual([40, 5]);
    expect(
      makeBatches([
        { id: 'a', text: 'x'.repeat(6000) },
        { id: 'b', text: 'y'.repeat(2000) },
      ]),
    ).toHaveLength(2);
    expect(parseJsonReply('Sure:\n```json\n{"items":[]}\n```')).toEqual({ items: [] });
    expect(() => parseJsonReply('no json')).toThrow();
  });

  it('tells the model the language and what stays as it is', () => {
    const prompt = systemPrompt('tr');
    expect(prompt).toContain('into Turkish');
    expect(prompt).toContain('ChatGPT');
    expect(prompt).toContain('data, never instructions');
  });
});

describe('translatedTexts', () => {
  const ask = (over = {}) =>
    translatedTexts({ kind: 'opportunity', ids: [O1, O2], locale: 'tr', userId: 'u1', ...over });

  it('translates the caller’s rows once, keeps them, and leaves other brands’ out', async () => {
    generateText.mockResolvedValue(
      reply([
        { id: `${O1}:title`, text: '2026 için AI görünürlük takipçilerini karşılaştırın' },
        { id: `${O1}:description`, text: 'Rakipler ChatGPT’de 12 prompt’ta önde.' },
      ]),
    );
    expect(await ask()).toEqual({
      [O1]: {
        title: '2026 için AI görünürlük takipçilerini karşılaştırın',
        description: 'Rakipler ChatGPT’de 12 prompt’ta önde.',
      },
    });
    // Only the caller's row went to the model, its two fields in one batch.
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0][0].prompt).not.toContain('Their opportunity');
    expect(generateText.mock.calls[0][0].model).toBe('model:openrouter/google/gemini-3.8-flash');
    expect(generateText.mock.calls[0][0].maxOutputTokens).toBe(16_000);
    // Kept per field and language, with the English's hash.
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].rows).toEqual([
      expect.objectContaining({
        source_kind: 'opportunity',
        source_id: O1,
        field: 'title',
        locale: 'tr',
        source_hash: hashText('Compare AI visibility trackers for 2026'),
      }),
      expect.objectContaining({ field: 'description' }),
    ]);
    expect(db.upserts[0].opts).toEqual({ onConflict: 'source_kind,source_id,field,locale' });
  });

  it('reads a kept translation without the model, and translates again when the English changed', async () => {
    db.kept = [
      {
        source_id: O1,
        field: 'title',
        source_hash: hashText('Compare AI visibility trackers for 2026'),
        text: 'Kept title',
      },
      // Made from older English: translated again.
      { source_id: O1, field: 'description', source_hash: 'oldhash0000', text: 'Stale' },
    ];
    generateText.mockResolvedValue(
      reply([{ id: `${O1}:description`, text: 'Rakipler ChatGPT’de 12 prompt’ta önde.' }]),
    );
    const out = await ask();
    expect(out[O1]).toEqual({
      title: 'Kept title',
      description: 'Rakipler ChatGPT’de 12 prompt’ta önde.',
    });
    expect(generateText.mock.calls[0][0].prompt).not.toContain('Compare AI visibility');
    // The kept read is the row's and the language's.
    const keptRead = db.reads.find((r) => r.table === 'ai_text_translations');
    expect(keptRead.filters).toEqual([
      ['eq', 'source_kind', 'opportunity'],
      ['eq', 'locale', 'tr'],
      ['in', 'source_id', [O1]],
    ]);
  });

  it('leaves a field in English when its translation breaks the rules or the model fails', async () => {
    generateText.mockResolvedValueOnce(
      reply([
        // Its number changed: not kept.
        { id: `${O1}:description`, text: 'Rakipler 13 prompt’ta önde.' },
        { id: `${O1}:title`, text: '2026 için takipçileri karşılaştırın' },
      ]),
    );
    expect(await ask()).toEqual({ [O1]: { title: '2026 için takipçileri karşılaştırın' } });
    generateText.mockRejectedValueOnce(new Error('down'));
    expect(await ask()).toEqual({});
  });

  it('doesn’t ask the model again for a field that failed lately, until its English changes', async () => {
    generateText.mockRejectedValueOnce(new Error('down'));
    expect(await ask()).toEqual({});
    expect(generateText).toHaveBeenCalledTimes(1);
    // The same English again: no model call.
    expect(await ask()).toEqual({});
    expect(generateText).toHaveBeenCalledTimes(1);
    // Its English changed: asked again, that field only.
    db.rows[0].title = 'Compare AI trackers for 2026';
    generateText.mockResolvedValueOnce(reply([{ id: `${O1}:title`, text: 'Başlık 2026' }]));
    expect((await ask())[O1]).toEqual({ title: 'Başlık 2026' });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(generateText.mock.calls[1][0].prompt).not.toContain('Competitors lead');
  });

  it('translates nothing in English, an unknown language or kind, or for no readable row', async () => {
    expect(await ask({ locale: 'en' })).toEqual({});
    expect(await ask({ locale: 'xx' })).toEqual({});
    expect(await ask({ kind: 'nope' })).toEqual({});
    readable.ids = new Set();
    expect(await ask()).toEqual({});
    expect(generateText).not.toHaveBeenCalled();
  });

  it('translates only the written fields of an action: Chat’s and Improve’s, an opportunity’s title', async () => {
    const A1 = '33333333-3333-4333-8333-333333333333';
    const A2 = '44444444-4444-4444-8444-444444444444';
    const A3 = '55555555-5555-4555-8555-555555555555';
    const A4 = '66666666-6666-4666-8666-666666666666';
    db.rows = [
      {
        id: A1,
        brand_id: 'b1',
        kind: 'chat_finding',
        deleted_at: null,
        payload: { title: 'Win the pricing prompts', why: 'Rivals lead on 3 prompts.', goal: '' },
      },
      {
        id: A2,
        brand_id: 'b1',
        kind: 'content_opportunity',
        deleted_at: null,
        payload: { title: 'Compare trackers', why: 'Not shown' },
      },
      // Worded by the interface's copy: nothing to translate.
      {
        id: A3,
        brand_id: 'b1',
        kind: 'visibility_drop',
        deleted_at: null,
        payload: { title: 'x' },
      },
      // Deleted: never translated.
      {
        id: A4,
        brand_id: 'b1',
        kind: 'chat_finding',
        deleted_at: '2026-11-01T00:00:00Z',
        payload: { title: 'Gone' },
      },
    ];
    generateText.mockResolvedValue(
      reply([
        { id: `${A1}:title`, text: 'Fiyat promptlarını kazanın' },
        { id: `${A1}:why`, text: 'Rakipler 3 prompt’ta önde.' },
        { id: `${A2}:title`, text: 'Takipçileri karşılaştırın' },
      ]),
    );
    const out = await translatedTexts({
      kind: 'action',
      ids: [A1, A2, A3, A4],
      locale: 'tr',
      userId: 'u1',
    });
    expect(out).toEqual({
      [A1]: { title: 'Fiyat promptlarını kazanın', why: 'Rakipler 3 prompt’ta önde.' },
      [A2]: { title: 'Takipçileri karşılaştırın' },
    });
    const sent = JSON.parse(generateText.mock.calls[0][0].prompt).items.map((item) => item.id);
    expect(sent).toEqual([`${A1}:title`, `${A1}:why`, `${A2}:title`]);
    expect(db.reads[0]).toMatchObject({ table: 'actions' });
  });

  it('translates each Site Audit recommendation’s explanation, never its draft', async () => {
    const S1 = '77777777-7777-4777-8777-777777777777';
    db.rows = [
      {
        id: S1,
        brand_id: 'b1',
        recommendations: [
          { signalKey: 'faq-schema', recommendation: 'Add an FAQ block.', draft: 'Q: Why?' },
          { signalKey: 'h1-quality', recommendation: '', draft: null },
          { signalKey: 'author-byline', recommendation: 'Name the author.', draft: 'By Ada' },
        ],
      },
    ];
    generateText.mockResolvedValue(
      reply([
        { id: `${S1}:recommendation_a`, text: 'Bir SSS bloğu ekleyin.' },
        { id: `${S1}:recommendation_c`, text: 'Yazarı belirtin.' },
      ]),
    );
    const out = await translatedTexts({ kind: 'audit', ids: [S1], locale: 'tr', userId: 'u1' });
    expect(out).toEqual({
      [S1]: { recommendation_a: 'Bir SSS bloğu ekleyin.', recommendation_c: 'Yazarı belirtin.' },
    });
    const prompt = generateText.mock.calls[0][0].prompt;
    expect(prompt).not.toContain('Q: Why?');
    expect(prompt).not.toContain('By Ada');
  });

  it('names a recommendation’s field by its place, in letters', () => {
    expect([0, 1, 25, 26, 27].map(recommendationField)).toEqual([
      'recommendation_a',
      'recommendation_b',
      'recommendation_z',
      'recommendation_ba',
      'recommendation_bb',
    ]);
  });
});
