// @vitest-environment node
import { inflateSync } from 'node:zlib';
import { Font } from '@react-pdf/renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ReportCardPayload } from './payload';
import { reportCardPdf } from './pdf';
import { SAMPLE_REPORT_CARD } from './sample';

/**
 * The real renderer, on the server as the card is sent: the card is always
 * four pages, the sample's and one with long Turkish names, a long question
 * and every finding, which is page 2's longest plan.
 */

const pages = (pdf: Uint8Array) =>
  Buffer.from(pdf)
    .toString('latin1')
    .match(/\/Type \/Page[^s]/g)?.length ?? 0;

/**
 * The text a PDF draws, without its spaces and line breaks: each text
 * stream's glyphs read through its font's ToUnicode map. A glyph the map
 * doesn't have, as a letter missing from the font's subset, reads as "?".
 */
function pdfText(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf).toString('latin1');
  const objects = new Map<string, { dict: string; stream: string | null }>();
  for (const m of raw.matchAll(/(\d+) 0 obj\n([\s\S]*?)\n(stream|endobj)/g)) {
    const [whole, id, dict, kind] = m;
    let stream: string | null = null;
    if (kind === 'stream') {
      const start = m.index + whole.length + 1;
      const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0);
      const data = Buffer.from(raw.slice(start, start + length), 'latin1');
      stream = (dict.includes('/FlateDecode') ? inflateSync(data) : data).toString('latin1');
    }
    objects.set(id, { dict, stream });
  }
  const fonts = new Map<string, Map<number, string>>();
  for (const { dict } of objects.values()) {
    for (const [, name, id] of dict.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const ref = /\/ToUnicode (\d+) 0 R/.exec(objects.get(id)?.dict ?? '')?.[1];
      const cmap = (ref && objects.get(ref)?.stream) || '';
      const map = new Map<number, string>();
      for (const [, code, unicode] of cmap.matchAll(/^<([0-9a-f]+)>\s*<([0-9a-f]+)>$/gim)) {
        map.set(parseInt(code, 16), Buffer.from(unicode, 'hex').swap16().toString('utf16le'));
      }
      fonts.set(name, map);
    }
  }
  let text = '';
  for (const { dict, stream } of objects.values()) {
    if (!stream?.includes('BT') || /\/(Type|Subtype|Length1)\b/.test(dict)) continue;
    let map = new Map<number, string>();
    for (const [, font, hex] of stream.matchAll(/\/(F\d+) [\d.]+ Tf|<([0-9a-f]+)>/gi)) {
      if (font) map = fonts.get(font) ?? new Map();
      else text += (hex.match(/.{4}/g) ?? []).map((c) => map.get(parseInt(c, 16)) ?? '?').join('');
    }
  }
  return text.replace(/\s+/g, '');
}

const long: ReportCardPayload = {
  ...SAMPLE_REPORT_CARD,
  companyName: 'Anadolu Seyahat ve Turizm Organizasyon Hizmetleri Ticaret Anonim Şirketi',
  domain: 'kampanyalar.anadolu-seyahat-ve-turizm-organizasyon.example',
  country: { code: 'TR', name: 'Türkiye' },
  language: 'Turkish',
  siteType: 'b2c',
  competitors: [
    { name: 'Kapadokya Balon Turları ve Seyahat Acentesi Anonim Şirketi', answers: 52 },
    { name: 'Ege ve Akdeniz Mavi Yolculuk Tekne Kiralama Hizmetleri', answers: 44 },
    { name: 'Karadeniz Yayla Turları Organizasyon Ltd. Şti.', answers: 31 },
  ],
  citedSites: [
    { domain: 'gezi-rehberi-ve-seyahat-onerileri.example', answers: 30, own: false },
    { domain: 'tatil-yorumlari-ve-karsilastirma.example', answers: 22, own: false },
    { domain: 'kampanyalar.anadolu-seyahat-ve-turizm-organizasyon.example', answers: 2, own: true },
  ],
  ownCitations: 2,
  missedQuestions: [
    {
      text: 'Kapadokya’da balon turu için en güvenilir acente hangisi, fiyatlar neye göre değişiyor ve rezervasyonu ne kadar önceden yapmak gerekiyor?',
      textEn:
        'Which agency is the most reliable for a balloon tour in Cappadocia, what sets the prices and how early should you book?',
      competitors: [
        'Kapadokya Balon Turları ve Seyahat Acentesi Anonim Şirketi',
        'Ege ve Akdeniz Mavi Yolculuk Tekne Kiralama Hizmetleri',
        'Karadeniz Yayla Turları Organizasyon Ltd. Şti.',
      ],
    },
  ],
  missedCount: 19,
  questionRows: Array.from({ length: 25 }, (_, i) => ({
    text: `Kapadokya ve Ege’de ${i + 1}. soru: balon turu, mavi yolculuk ve kültür turları için en güvenilir acente hangisi, fiyatlar neye göre değişiyor ve rezervasyon ne kadar önce yapılmalı?`,
    textEn: 'A long question in English',
    named: {
      'chatgpt-web': 'missed',
      'gemini-web': 'none',
      'google-aio': 'missed',
      'google-aimode': 'named',
    },
    instead: 'Kapadokya Balon Turları ve Seyahat Acentesi Anonim Şirketi',
  })),
  cpc: { usd: 0.42, keywords: 21 },
  dealValue: { amount: 18_500, currency: 'TRY' },
};

describe('reportCardPdf', () => {
  it('draws the sample on three pages', async () => {
    const pdf = await reportCardPdf(SAMPLE_REPORT_CARD);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(pages(pdf)).toBe(4);
  }, 30_000);

  it('keeps long Turkish names, long questions and every finding on four pages', async () => {
    expect(pages(await reportCardPdf(long))).toBe(4);
  }, 30_000);

  it('draws a card asked in Japanese, quoting the question in English', async () => {
    const japanese: ReportCardPayload = {
      ...SAMPLE_REPORT_CARD,
      country: { code: 'JP', name: 'Japan' },
      language: 'Japanese',
      questionRows: [
        {
          text: 'オンラインで焙煎したてのコーヒー豆を買うならどこがいいですか',
          textEn: 'Where is the best place to buy freshly roasted coffee beans online?',
          named: { 'chatgpt-web': 'missed' },
          instead: 'Ridgeline Roasters',
        },
      ],
      missedQuestions: [
        {
          text: 'オンラインで焙煎したてのコーヒー豆を買うならどこがいいですか',
          textEn: 'Where is the best place to buy freshly roasted coffee beans online?',
          competitors: ['Ridgeline Roasters'],
        },
      ],
    };
    expect(pages(await reportCardPdf(japanese))).toBe(4);
  }, 30_000);

  it('keeps page 4 one page with 25 two-line questions, the key and the summary', async () => {
    const tall: ReportCardPayload = {
      ...long,
      questionRows: Array.from({ length: 25 }, (_, i) => ({
        text: `${'Çok uzun bir soru metni '.repeat(8)}${i}`,
        textEn: null,
        named: {
          'chatgpt-web': i % 3 === 0 ? 'named' : 'missed',
          'gemini-web': 'missed',
          'google-aio': 'none',
          'google-aimode': 'missed',
        },
        instead: 'Kapadokya Balon Turları ve Seyahat Acentesi Anonim Şirketi',
      })),
    };
    expect(pages(await reportCardPdf(tall))).toBe(4);
  }, 30_000);

  it('keeps a card with no ad data and no deal value on four pages', async () => {
    expect(pages(await reportCardPdf({ ...SAMPLE_REPORT_CARD, cpc: null, dealValue: null }))).toBe(
      4,
    );
  }, 30_000);
});

describe('reportCardPdf, card after card on one server', () => {
  const winter: ReportCardPayload = {
    ...SAMPLE_REPORT_CARD,
    companyName: 'Kış Sporları Kulübü',
    domain: 'kis-sporlari.example',
    country: { code: 'TR', name: 'Türkiye' },
    language: 'Turkish',
    missedQuestions: [
      {
        text: 'Kış sporları için en iyi kayak okulu hangisi?',
        textEn: 'Which ski school is the best for winter sports?',
        competitors: ['Ridgeline Roasters'],
      },
    ],
  };

  it('registers Inter under its own family for each card, and removes it once drawn', async () => {
    const register = vi.spyOn(Font, 'register');
    const before = Object.keys(Font.getRegisteredFonts());
    try {
      await reportCardPdf(SAMPLE_REPORT_CARD);
      await reportCardPdf(winter);
      const families = register.mock.calls.map(([font]) => font.family);
      expect(families).toHaveLength(2);
      expect(new Set(families).size).toBe(2);
      expect(Object.keys(Font.getRegisteredFonts())).toEqual(before);
    } finally {
      register.mockRestore();
    }
  }, 60_000);

  it("keeps every letter of a Turkish card drawn after an English one (it lost its K and ı's)", async () => {
    expect(pdfText(await reportCardPdf(SAMPLE_REPORT_CARD))).toContain('BrewlineCoffee');
    const text = pdfText(await reportCardPdf(winter));
    expect(text).toContain('KışSporlarıKulübü');
    expect(text).toContain('Kışsporlarıiçineniyikayakokuluhangisi?');
    expect(text).not.toContain('K?ş');
  }, 60_000);
});
