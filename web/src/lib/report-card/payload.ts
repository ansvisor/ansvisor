import { z } from 'zod';
import { SITE_TYPES } from '@/lib/content/page-types';

/**
 * The free AI visibility report card (CUSTOMER-PRIORITIES §5): what one
 * card measured, as the PDF draws it. The server asks 25 questions in the
 * four engines below and sends these figures; the PDF only lays them out
 * and picks its advice from them by fixed rules (./rules.ts).
 */

/** The engines a card asks, in the order it lists them. */
export const REPORT_CARD_ENGINES = [
  'chatgpt-web',
  'gemini-web',
  'google-aio',
  'google-aimode',
] as const;
export type ReportCardEngine = (typeof REPORT_CARD_ENGINES)[number];

const text = (max: number) => z.string().trim().min(1).max(max);
const count = z.number().int().min(0);

export const reportCardPayloadSchema = z.object({
  companyName: text(100),
  /** The site measured, the work e-mail's domain: "acme.com". */
  domain: text(253),
  /** The target country the engines were asked in. */
  country: z.object({ code: z.string().length(2), name: text(80) }),
  /** The language the questions were asked in, in English: "Turkish". */
  language: text(40),
  /** The site's kind, as the site analysis found it; null when it couldn't tell. */
  siteType: z.enum(SITE_TYPES).nullable(),
  generatedAt: z.iso.datetime({ offset: true }),
  questionCount: count.min(1),
  /** Each engine's answers, and how many of them named the company. */
  engines: z
    .array(z.object({ engine: z.enum(REPORT_CARD_ENGINES), answers: count, named: count }))
    .min(1),
  /** Competitors by the answers that name them, most first. */
  competitors: z.array(z.object({ name: text(100), answers: count })).max(10),
  /** The sites the answers cite most, by the answers citing them, most first. */
  /** `competitor`: a competitor's own site (cards made before it was marked have none). */
  citedSites: z
    .array(
      z.object({
        domain: text(253),
        answers: count,
        own: z.boolean(),
        competitor: z.boolean().optional(),
      }),
    )
    .max(10),
  /** Answers that cite a page of the company's own site. */
  ownCitations: count,
  /** Questions no engine named the company in, the most competitors named first. */
  missedQuestions: z
    .array(
      z.object({
        /** As asked, in the target language. */
        text: text(500),
        /** The same question in English; null when it was asked in English. */
        textEn: text(500).nullable(),
        competitors: z.array(text(100)).max(10),
      }),
    )
    .max(10),
  missedCount: count,
  /**
   * The median Google Ads cost per click in USD over the questions' keywords
   * that have one in the target country, from the search volume call; null
   * when none has.
   */
  cpc: z.object({ usd: z.number().positive(), keywords: count.min(1) }).nullable(),
  /** The average order or deal value the person gave, if any. */
  dealValue: z.object({ amount: z.number().positive(), currency: z.string().length(3) }).nullable(),
});

export type ReportCardPayload = z.infer<typeof reportCardPayloadSchema>;
