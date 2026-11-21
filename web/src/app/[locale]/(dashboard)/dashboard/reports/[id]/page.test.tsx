import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { Report } from '@/lib/actions/reports';
import type { ReportBranding } from '@/lib/white-label/kit';
import { RoleContext } from '@/components/providers/role-provider';

/**
 * A report's page with a white label kit (00429): the kit's cover above the
 * report, and the PDF drawn and named with it; without one, as before. A kit
 * that couldn't be read makes no PDF in Ansvisor's look.
 */

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'r1' }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const getReport = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/reports', () => ({ getReport }));
const getReportBranding = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/white-label', () => ({ getReportBranding }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
/** The report and the kit of each PDF drawn. */
const drawn = vi.hoisted(() => [] as unknown[]);
vi.mock('./_report-pdf', () => ({
  reportPdf: async (report: unknown, branding: unknown) => {
    drawn.push({ report, branding });
    return new Blob(['%PDF']);
  },
}));
// jsdom draws no canvas: the logos here are PNGs, handed over as they are.
vi.mock('@/lib/white-label/pdf-image', () => ({ pdfImage: async (url: string | null) => url }));

const { chatPage } = vi.hoisted(() => ({ chatPage: vi.fn() }));
vi.mock('@/components/chat/panel/chat-panel-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatPageContext: chatPage,
}));

const { default: ReportDetailPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const report: Report = {
  id: 'r1',
  brandId: '22222222-2222-4222-8222-222222222222',
  title: 'October report',
  template: 'monthly',
  dateFrom: '2026-10-01',
  dateTo: '2026-10-31T00:00:00Z',
  createdAt: '2026-10-31T09:00:00Z',
  payload: { brandName: 'Northwind', summaryText: 'Visibility rose.' } as Report['payload'],
};

const kit: ReportBranding = {
  companyName: 'Acme Agency',
  accentColor: '#1d4ed8',
  footerText: 'acme.com',
  logo: 'data:image/png;base64,AAAA',
  clientLogo: 'data:image/png;base64,BBBB',
};

let container: HTMLDivElement;
let root: Root;
let downloaded: string[];

beforeEach(() => {
  vi.clearAllMocks();
  getReport.mockResolvedValue(report);
  getReportBranding.mockResolvedValue({ ok: true, branding: null });
  downloaded = [];
  drawn.length = 0;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloaded.push(this.download);
  });
  URL.createObjectURL = vi.fn(() => 'blob:report');
  URL.revokeObjectURL = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ReportDetailPage />
      </NextIntlClientProvider>,
    );
  });
}

async function download() {
  const button = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Download PDF'),
  )!;
  await act(async () => button.click());
}

describe('ReportDetailPage with white label', () => {
  it('stays as before without a kit: no cover, Ansvisor’s file name', async () => {
    await render();
    expect(getReportBranding).toHaveBeenCalledWith(report.brandId);
    expect(container.textContent).not.toContain('Prepared for');
    await download();
    expect(drawn[0]).toEqual({ report, branding: null });
    expect(downloaded).toEqual(['ansvisor_northwind_report_2026-10-31.pdf']);
  });

  it('shows the kit’s cover, and draws and names the PDF with it', async () => {
    getReportBranding.mockResolvedValue({ ok: true, branding: kit });
    await render();
    expect(container.textContent).toContain('Prepared for Northwind');
    expect([...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
      kit.logo,
      kit.clientLogo,
    ]);
    await download();
    expect(drawn[0]).toEqual({ report, branding: kit });
    expect(downloaded).toEqual(['acme-agency_northwind_report_2026-10-31.pdf']);
  });

  it('makes no PDF while the kit can’t be read, and says so', async () => {
    getReportBranding.mockResolvedValue({ ok: false, failure: 'failed' });
    await render();
    await download();
    expect(getReportBranding).toHaveBeenCalledTimes(2);
    expect(drawn).toEqual([]);
    expect(downloaded).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't load your white label kit, so the PDF wasn't made. Try again.",
    );
  });

  it('reads the kit again on download when the first read failed', async () => {
    getReportBranding
      .mockResolvedValueOnce({ ok: false, failure: 'failed' })
      .mockResolvedValueOnce({ ok: true, branding: kit });
    await render();
    await download();
    expect(downloaded).toEqual(['acme-agency_northwind_report_2026-10-31.pdf']);
  });
});

describe('ReportDetailPage › Competitor Leaderboard sample (RP-07)', () => {
  const entry = (name: string, score: number, visiblePrompts: number) => ({
    name,
    isOwnBrand: false,
    avgVisibilityScore: 0,
    visibilityRate: Math.round((visiblePrompts / 308) * 1000) / 10,
    visiblePrompts,
    promptCount: 308,
    change: null,
    score,
    scoreChange: null,
    mentionAnswers: 0,
    citationAnswers: 0,
    totalMentions: 0,
    totalCitations: 0,
  });
  const ranked: Report = {
    ...report,
    payload: {
      ...report.payload,
      // The audit's case: GeoGenie scored 10.3 from one prompt.
      competitors: [
        entry('GeoGenie', 10.3, 1),
        entry('Opttab', 11, 14),
        entry('Cognizo', 10.6, 93),
      ] as unknown as Report['payload']['competitors'],
    },
  };

  it('names its metric and lists a brand under the sample last, as Low sample', async () => {
    getReport.mockResolvedValue(ranked);
    await render();
    expect(container.textContent).toContain('Ranked by Visibility score');
    const rows = [...container.querySelectorAll('tbody tr')].map(
      (tr) => tr.querySelector('td')!.textContent,
    );
    expect(rows).toEqual(['Opttab', 'Cognizo', 'GeoGenieLow sample']);
  });
});

describe('ReportDetailPage › sections that could not be gathered (RP-06)', () => {
  const gapped: Report = {
    ...report,
    payload: { ...report.payload, missingSections: ['trend', 'citationEvidence'] },
  };

  async function renderAs(role: 'admin' | 'analyst') {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <RoleContext.Provider value={{ role }}>
            <ReportDetailPage />
          </RoleContext.Provider>
        </NextIntlClientProvider>,
      );
    });
  }

  it('never names the gap in the report a client reads', async () => {
    getReport.mockResolvedValue(gapped);
    await renderAs('analyst');
    expect(container.textContent).toContain('Visibility rose.');
    expect(container.textContent).not.toContain('gathered');
    expect(container.textContent).not.toContain('Citation Evidence');
  });

  it('shows an Admin a quiet note outside the report itself', async () => {
    getReport.mockResolvedValue(gapped);
    await renderAs('admin');
    const note = [...container.querySelectorAll('p')].find((p) =>
      p.textContent?.includes('Only Admins see this'),
    )!;
    expect(note.textContent).toContain('Trend, Citation Evidence');
    expect(container.querySelector('#report-root')?.contains(note)).toBe(false);
  });
});

describe('ReportDetailPage › Site Audit Score', () => {
  const auditCard = () =>
    [...container.querySelectorAll('[data-slot="card"]')].find((c) =>
      c.textContent?.startsWith('Site Audit Score'),
    );

  it('shows the score in points, and the change since the same page’s audit before', async () => {
    getReport.mockResolvedValue({
      ...report,
      payload: {
        ...report.payload,
        auditScore: {
          url: 'https://shop.com/bags',
          totalScore: 64,
          previousScore: 60,
          auditedAt: '2026-10-30T00:00:00Z',
          scale: 100,
        },
      },
    });
    await render();
    const card = auditCard()!;
    expect(card.textContent).toContain('64+4');
    expect(card.textContent).not.toContain('%');
    expect(card.textContent).toContain('https://shop.com/bags');
  });

  it('shows the score’s range from the page’s own audits, and says what it means', async () => {
    getReport.mockResolvedValue({
      ...report,
      payload: {
        ...report.payload,
        auditScore: {
          url: 'https://shop.com/bags',
          totalScore: 64,
          previousScore: 62,
          auditedAt: '2026-10-30T00:00:00Z',
          scale: 100,
          range: { plusMinus: 2, low: 62, high: 66, audits: 5 },
        },
      },
    });
    await render();
    const card = auditCard()!;
    expect(card.querySelector('[data-slot="score-range"]')?.textContent).toBe('± 2');
    expect(card.textContent).toContain('64± 2+2');
    expect(card.textContent).toContain(
      "This page's last 5 audits scored 62 to 66, changes to the page included.",
    );
  });

  it('says the audits scored the same when the range is ± 0', async () => {
    getReport.mockResolvedValue({
      ...report,
      payload: {
        ...report.payload,
        auditScore: {
          url: 'https://shop.com/bags',
          totalScore: 64,
          previousScore: 64,
          auditedAt: '2026-10-30T00:00:00Z',
          scale: 100,
          range: { plusMinus: 0, low: 64, high: 64, audits: 3 },
        },
      },
    });
    await render();
    const card = auditCard()!;
    expect(card.querySelector('[data-slot="score-range"]')?.textContent).toBe('± 0');
    expect(card.textContent).toContain("This page's last 3 audits all scored 64.");
  });

  it('shows no range on a report saved before it, or with too few audits', async () => {
    for (const range of [undefined, null]) {
      getReport.mockResolvedValue({
        ...report,
        payload: {
          ...report.payload,
          auditScore: {
            url: 'https://shop.com/bags',
            totalScore: 64,
            previousScore: 60,
            auditedAt: '2026-10-30T00:00:00Z',
            scale: 100,
            ...(range === undefined ? {} : { range }),
          },
        },
      });
      await render();
      const card = auditCard()!;
      expect(card.textContent).toContain('64+4');
      expect(card.textContent).not.toContain('±');
    }
  });

  it('shows a report saved on the 0–1 scale as about that many points, with no change', async () => {
    getReport.mockResolvedValue({
      ...report,
      payload: {
        ...report.payload,
        auditScore: {
          url: 'https://shop.com/bags',
          totalScore: 0.6,
          previousScore: 0.5,
          auditedAt: '2026-10-30T00:00:00Z',
        },
      },
    });
    await render();
    const card = auditCard()!;
    expect(card.textContent).toContain('~60');
    expect(card.textContent).not.toContain('0.6');
    expect(card.textContent).not.toMatch(/[+-]\d/);
    expect(card.textContent).not.toContain('±');
  });
});

describe('ReportDetailPage › AI-sourced pipeline (#2140)', () => {
  const pipelineCard = () =>
    [...container.querySelectorAll('[data-slot="card"]')].find((c) =>
      c.textContent?.startsWith('AI-sourced pipeline'),
    );

  it('shows HubSpot’s contacts, deals and revenue, by engine and page', async () => {
    getReport.mockResolvedValue({
      ...report,
      payload: {
        ...report.payload,
        aiPipeline: {
          currency: 'USD',
          syncedAt: '2026-10-31T06:00:00Z',
          totals: {
            contacts: 128,
            contactsPrev: 100,
            deals: 23,
            wonDeals: 9,
            wonRevenue: 62300,
            wonRevenuePrev: 50000,
            openDeals: 14,
            openPipeline: 184500,
          },
          byEngine: [
            {
              source: 'chatgpt.com',
              contacts: 71,
              deals: 13,
              wonDeals: 5,
              wonRevenue: 38900,
              openPipeline: 96000,
            },
          ],
          byPage: [
            {
              page: 'https://acme.test/pricing',
              contacts: 34,
              deals: 9,
              wonRevenue: 24100,
              topSource: 'chatgpt.com',
            },
          ],
          hubspotNative: { contacts: 12, deals: 2, wonRevenue: 4000 },
        },
      },
    });
    await render();
    const card = pipelineCard()!;
    expect(card.textContent).toContain('From HubSpot');
    expect(card.textContent).toContain('AI-sourced contacts128+28%');
    expect(card.textContent).toContain('Open pipeline$184,500');
    expect(card.textContent).toContain('Won revenue$62,300+25%');
    expect(card.textContent).toContain('ChatGPT71 contacts · $38,900');
    expect(card.textContent).toContain('https://acme.test/pricing$24,100');
    expect(card.textContent).toContain('HubSpot also counts 12 contacts');
  });

  it('shows nothing on a report without it', async () => {
    getReport.mockResolvedValue(report);
    await render();
    expect(pipelineCard()).toBeUndefined();
  });
});

describe('ReportDetailPage › KPIs and leaderboard (RP-01, RP-02)', () => {
  const insights = {
    avgVisibilityScore: 2.3,
    visibilityChange: 0.4,
    totalMentions: 120,
    mentionsChange: null,
    totalCitations: 40,
    citationsChange: null,
    positiveSentimentPct: 60,
    sentimentChange: null,
  };
  const competitor = (name: string, isOwnBrand: boolean) => ({
    name,
    isOwnBrand,
    score: isOwnBrand ? 15.5 : 11,
    scoreChange: isOwnBrand ? 1.2 : null,
    change: isOwnBrand ? 9 : null,
    visibilityRate: 36.4,
    visiblePrompts: 112,
    promptCount: 308,
    avgVisibilityScore: 2.3,
    totalMentions: 120,
    totalCitations: 40,
  });
  const kpiCards = () =>
    [...container.querySelectorAll('[data-slot="card"]')]
      .map((c) => c.textContent ?? '')
      .filter((text) => /^(Visibility score|Prompts with a mention|Avg\. Score)/.test(text));

  it('shows the score out of 100 and the prompt share, and no Avg. Score', async () => {
    getReport.mockResolvedValue({
      ...report,
      payload: {
        ...report.payload,
        insights,
        visibilityRate: { score: 15.5, ratePct: 36.4, visiblePrompts: 112, promptCount: 308 },
      },
    });
    await render();
    expect(kpiCards()).toEqual([
      'Visibility score15.5/100',
      'Prompts with a mention36.4%112 of 308 prompts',
    ]);
    expect(container.textContent).not.toContain('2.3%');
  });

  it('names the leaderboard’s column for the score, and shows the score’s change', async () => {
    getReport.mockResolvedValue({
      ...report,
      payload: {
        ...report.payload,
        competitors: [competitor('Northwind', true), competitor('Rival', false)],
      },
    });
    await render();
    const table = container.querySelector('table')!;
    expect(table.querySelector('thead')!.textContent).toContain('Visibility score');
    const own = table.querySelector('tbody tr')!.textContent!;
    expect(own).toContain('15.5112 of 308 prompts with a mention');
    expect(own).toContain('+1.2');
    expect(own).not.toContain('+9');
  });
});

describe('ReportDetailPage › numbers (GL-04)', () => {
  it('writes counts with thousands separators', async () => {
    getReport.mockResolvedValue({
      ...report,
      payload: {
        ...report.payload,
        insights: {
          avgVisibilityScore: 2.3,
          visibilityChange: null,
          totalMentions: 10262,
          mentionsChange: null,
          totalCitations: 1371,
          citationsChange: null,
          positiveSentimentPct: 60,
          sentimentChange: null,
        },
        queryFanout: [{ query: 'espresso beans', engines: ['chatgpt-web'], timesSearched: 2048 }],
        queryFanoutEngines: [
          { engine: 'chatgpt-web', distinctQueries: 1200, answersWithFanout: 3400 },
        ],
        aiTraffic: {
          totalVisits: 12500,
          change: null,
          platformBreakdown: [{ platform: 'chatgpt.com', visits: 11000 }],
          topPages: [{ url: 'https://shop.com/', visits: 5400 }],
        },
      },
    });
    await render();
    const text = container.textContent!;
    expect(text).toContain('Mentions10,262');
    expect(text).toContain('1,371');
    expect(text).toContain('2,048');
    expect(text).toContain('1,200 distinct sub-queries across 3,400 answers');
    expect(text).toContain('12,500');
    expect(text).toContain('11,000');
    expect(text).toContain('5,400');
    expect(text).not.toMatch(/10262|1371|2048|12500|11000|5400/);
  });
});

describe("what Chat's side panel sees (the owner's plan, step 9's detail pages)", () => {
  it('holds the saved report open by its id, with the days it covers, and no rows', async () => {
    await render();
    expect(chatPage.mock.lastCall![0]).toEqual({
      pageName: 'October report',
      dateRange: { from: '2026-10-01', to: '2026-10-31', label: '2026-10-01 – 2026-10-31' },
      view: { open: { ref: 'r1', label: 'October report' } },
    });
  });

  it('says nothing while it reads', async () => {
    getReport.mockReturnValue(new Promise(() => {}));
    await render();
    expect(chatPage.mock.lastCall![0]).toBeNull();
  });

  it('says nothing for a report it can’t find', async () => {
    getReport.mockResolvedValue(null);
    await render();
    expect(chatPage.mock.lastCall![0]).toBeNull();
  });
});
