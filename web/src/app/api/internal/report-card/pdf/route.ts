import { NextResponse } from 'next/server';
import { z } from 'zod';
import { internalSecretMatches } from '@/lib/chat/internal-call';
import { REPORT_LANGUAGES } from '@/lib/report-card/copy';
import { reportCardPayloadSchema } from '@/lib/report-card/payload';
import { reportCardPdf } from '@/lib/report-card/pdf';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** The language the request chose; none or null: by the card's country. */
const languageSchema = z.enum(REPORT_LANGUAGES).nullish();

/**
 * POST /api/internal/report-card/pdf `{ card, language? }`
 *
 * The free AI visibility report card's PDF (REPORT-CARD §1, §7), drawn
 * from its figures for the API server, which e-mails it: the server's
 * report card queue calls it with `Authorization: Bearer ${CRON_SECRET}`,
 * never a browser. `language` is the one the form chose (en, tr, fr, es,
 * de, pt, it or nl); without it the card's country decides, Turkish for
 * Türkiye and English elsewhere. 401 without the secret, 422 for figures
 * the card can't be drawn from or a language it isn't written in; else the
 * PDF. Nothing is kept: the server keeps the figures, and asks again to
 * send a card again.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const secret = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!internalSecretMatches(process.env.CRON_SECRET, secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as {
    card?: unknown;
    language?: unknown;
  } | null;
  const card = reportCardPayloadSchema.safeParse(body?.card);
  const language = languageSchema.safeParse(body?.language);
  if (!card.success || !language.success) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 422 });
  }
  const pdf = await reportCardPdf(card.data, { language: language.data ?? null });
  return new Response(Buffer.from(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
  });
}
