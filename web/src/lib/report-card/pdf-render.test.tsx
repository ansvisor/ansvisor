// @vitest-environment node
import { describe, expect, it } from 'vitest';
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
