import { NextResponse } from 'next/server';
import { internalSecretMatches } from '@/lib/chat/internal-call';
import { reportCardPayloadSchema } from '@/lib/report-card/payload';
import { reportCardPdf } from '@/lib/report-card/pdf';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/internal/report-card/pdf `{ card }`
 *
 * The free AI visibility report card's PDF (REPORT-CARD §1, §7), drawn
 * from its figures for the API server, which e-mails it: the server's
 * report card queue calls it with `Authorization: Bearer ${CRON_SECRET}`,
 * never a browser. 401 without the secret, 422 for figures the card can't
 * be drawn from; else the PDF. Nothing is kept: the server keeps the
 * figures, and asks again to send a card again.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const secret = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!internalSecretMatches(process.env.CRON_SECRET, secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { card?: unknown } | null;
  const card = reportCardPayloadSchema.safeParse(body?.card);
  if (!card.success) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 422 });
  }
  const pdf = await reportCardPdf(card.data);
  return new Response(Buffer.from(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
  });
}
