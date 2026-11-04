import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_REPORT_CARD } from '@/lib/report-card/sample';

/** The report card's PDF for the API server: its secret, the card's figures, the PDF back. */

const reportCardPdf = vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]));
vi.mock('@/lib/report-card/pdf', () => ({
  reportCardPdf: (...args: unknown[]) => reportCardPdf(...(args as [])),
}));

const { POST } = await import('./route');

const call = (body: unknown, secret: string | null = 'cron-secret') =>
  POST(
    new Request('http://localhost/api/internal/report-card/pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  reportCardPdf.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/internal/report-card/pdf', () => {
  it('draws the card for the server, as a PDF', async () => {
    const res = await call({ card: SAMPLE_REPORT_CARD });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    );
    expect(reportCardPdf).toHaveBeenCalledWith(SAMPLE_REPORT_CARD);
  });

  it('refuses a call without the secret, or a wrong one', async () => {
    expect((await call({ card: SAMPLE_REPORT_CARD }, null)).status).toBe(401);
    expect((await call({ card: SAMPLE_REPORT_CARD }, 'guess')).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await call({ card: SAMPLE_REPORT_CARD }, '')).status).toBe(401);
    expect(reportCardPdf).not.toHaveBeenCalled();
  });

  it('refuses figures the card can’t be drawn from', async () => {
    const res = await call({ card: { ...SAMPLE_REPORT_CARD, engines: [] } });
    expect(res.status).toBe(422);
    expect(reportCardPdf).not.toHaveBeenCalled();
  });
});
