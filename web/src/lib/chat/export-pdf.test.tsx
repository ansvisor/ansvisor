// @vitest-environment node
import { Font } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { pdfText } from '@/lib/testing/pdf-text';
import type { ExportAnswer } from './export';
import { answerPdf } from './export-pdf';

/**
 * Inter's "i" is drawn from a dotless "ı" and a dot. The renderer kept the
 * fonts of one PDF for the next, that "ı" without its letter once a PDF had
 * drawn an "i": every later PDF lost its "ı"s, and the letter before each
 * one ("K" of "Kış"). Each PDF has its fonts of its own now.
 */

const ENGLISH = {
  question: 'Which gift boxes ship this winter?',
  markdown: 'Brewline Coffee whole bean subscriptions and gift boxes',
};
const TURKISH = {
  question: 'Kış için hangi kayak merkezleri iyi?',
  markdown: 'Kış sporları ve kayak turları için en iyi merkezler hangileri? ığüşöç İĞÜŞÖÇ',
};

const answer = (text: { question: string; markdown: string }): ExportAnswer => ({
  ...text,
  generatedAt: '2026-11-04T09:00:00Z',
  timezone: 'UTC',
  stamp: 'Generated Nov 4, 2026',
});

/** Text without spaces or line breaks: a line may wrap anywhere. */
const squash = (text: string) => text.replace(/\s+/g, '');

/** Whether the PDF shows the question (bold) and the answer (regular), every letter of both. */
function expectLetters(pdf: Uint8Array, text: { question: string; markdown: string }) {
  const shown = squash(pdfText(pdf));
  expect(shown).toContain(squash(text.question));
  expect(shown).toContain(squash(text.markdown));
}

describe('answerPdf', () => {
  it('keeps every letter of a PDF drawn after another one, and leaves no font behind', async () => {
    const families = Font.getRegisteredFontFamilies().length;
    expectLetters(await answerPdf(answer(ENGLISH)), ENGLISH);
    expectLetters(await answerPdf(answer(TURKISH)), TURKISH);
    expect(Font.getRegisteredFontFamilies()).toHaveLength(families);
  }, 30_000);

  it('keeps every letter of PDFs drawn at the same time', async () => {
    const [english, turkish] = await Promise.all([
      answerPdf(answer(ENGLISH)),
      answerPdf(answer(TURKISH)),
    ]);
    expectLetters(english, ENGLISH);
    expectLetters(turkish, TURKISH);
  }, 30_000);
});
