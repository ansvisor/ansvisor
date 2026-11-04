import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportCardPayload } from './payload';
import { SAMPLE_REPORT_CARD } from './sample';

/**
 * The report card's three pages, drawn as plain elements: the renderer's
 * parts are stand-ins here, so the document reads as a page would. The real
 * renderer's page count is checked in pdf-render.test.tsx.
 */

type Props = { children?: ReactNode };
vi.mock('@react-pdf/renderer', () => ({
  Document: ({ children, ...props }: Props & { author?: string; title?: string }) => (
    <div data-author={props.author ?? ''} data-title={props.title ?? ''}>
      {children}
    </div>
  ),
  Page: ({ children }: Props) => <section>{children}</section>,
  View: ({ children }: Props) => <div>{children}</div>,
  Text: ({
    children,
    render,
  }: Props & { render?: (p: { pageNumber: number; totalPages: number }) => string }) => (
    <span>{render ? render({ pageNumber: 1, totalPages: 3 }) : children}</span>
  ),
  Link: ({ children, src }: Props & { src: string }) => <a href={src}>{children}</a>,
  Svg: ({ children }: Props) => <span data-tick="1">{children}</span>,
  Path: () => null,
  StyleSheet: { create: <T,>(styles: T) => styles },
  Font: { register: () => {}, registerHyphenationCallback: () => {} },
  renderToBuffer: async () => new Uint8Array(),
}));

const { ReportCardPdfDocument } = await import('./pdf');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function draw(card: ReportCardPayload) {
  act(() => root.render(<ReportCardPdfDocument card={card} family="ReportCardInter-1" />));
  return [...container.querySelectorAll('section')].map((page) => page.textContent ?? '');
}

describe('ReportCardPdfDocument', () => {
  it('has four pages, as Ansvisor', () => {
    const pages = draw(SAMPLE_REPORT_CARD);
    expect(pages).toHaveLength(4);
    const doc = container.firstElementChild as HTMLElement;
    expect(doc.dataset.author).toBe('Ansvisor');
    expect(doc.dataset.title).toBe('AI visibility report card: Brewline Coffee');
    for (const page of pages) expect(page).toContain('Generated with Ansvisor · www.ansvisor.com');
  });

  it('page 1 shows the score, each engine, the top three competitors, the cited sites and three things to do', () => {
    const [results] = draw(SAMPLE_REPORT_CARD);
    expect(results).toContain('How visible is Brewline Coffee in AI answers?');
    expect(results).toContain('18%');
    expect(results).toContain('named in 18 of 100 answers');
    for (const engine of ['ChatGPT', 'Google Gemini', 'Google AI Overviews', 'Google AI Mode']) {
      expect(results).toContain(engine);
    }
    expect(results).toContain('7 of 25 · 28%');
    expect(results).toContain('Ridgeline Roasters');
    expect(results).toContain('Harborline Beans');
    expect(results).not.toContain('Sunday Grind');
    expect(results).toContain('Brewline Coffee (you)');
    expect(results).toContain('coffeereview.example');
    expect(results).toContain('brewlinecoffee.example (you)');
    expect(results).toContain('3 things to do now');
    expect(results).toContain('in the United States, in English');
    expect(results).toContain('All 25 questions are on page 4.');
  });

  it('page 2 is the action plan with a trial link', () => {
    const [, plan] = draw(SAMPLE_REPORT_CARD);
    expect(plan).toContain('What’s in Ansvisor and how you can use it');
    expect(plan).toContain('Ansvisor · Brand Visibility');
    expect(plan).toContain('What each feature does is quoted from its Help article');
    expect(plan).toContain('Start your free trial');
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain(
      'https://app.ansvisor.com/en/sign-up?utm_source=report-card&utm_medium=pdf',
    );
  });

  it('page 3 sets buying the visits against earning them, and says how AI answers lead to searches', () => {
    const [, , outcomes] = draw(SAMPLE_REPORT_CARD);
    expect(outcomes).toContain('Maximize your visibility in AI answers');
    expect(outcomes).toContain('Buying these visits vs earning them');
    expect(outcomes).toContain('$1.85');
    expect(outcomes).toContain('Ads a month');
    expect(outcomes).toContain('Ads a year');
    expect(outcomes).not.toMatch(/×|vs Starter|vs Growth/);
    expect(outcomes).toContain('1,000 AI visits a month ≈ $1,850 in Google Ads, every month.');
    expect(outcomes).toContain('Ad clicks stop when the budget stops. Over 12 months: ≈ $22,200');
    expect(outcomes).toContain('Ansvisor Growth is $249 a month.');
    expect(outcomes).toContain(
      'can keep sending visits month after month, for as long as they’re cited',
    );
    expect(outcomes).toContain('Over 12 months: $2,988, or $2,390 paid yearly.');
    expect(outcomes).toContain('AI answers can lead to Google searches for your name');
    expect(outcomes).toContain('with Search Console connected');
    expect(outcomes).toContain('$470 a year');
    expect(outcomes).toContain('A revenue scenario');
    expect(outcomes).toContain('Assumption: 1% of visits place an order (range 1%–3%)');
    expect(outcomes).toContain('$380–$1,140');
    expect(outcomes).toContain('Scenarios, not a forecast or a guarantee.');
    expect(outcomes).not.toMatch(/ChatGPT ads|will (grow|earn|rise)|guaranteed/i);
  });

  it('page 4 lists every question, with a tick where an engine named the company', () => {
    const pages = draw(SAMPLE_REPORT_CARD);
    const questions = pages[3];
    expect(questions).toContain('The 25 questions we asked');
    expect(questions).toContain('Named in 18 of 100 answers: 14 of the 25 questions.');
    // The key above the table: a tick, a dash and n/a, each with its meaning.
    expect(questions).toContain('Named–Not namedn/aNo answer');
    expect(questions).toContain('best coffee beans for espresso at home');
    expect(questions).toContain('best coffee beans under 20 dollars');
    expect(questions).toContain('Named instead');
    expect(questions).toContain('Ridgeline Roasters');
    // 7 + 4 + 5 + 2 answers named Brewline: one tick each, and one in the key.
    const ticks = container.querySelectorAll('section')[3].querySelectorAll('[data-tick]');
    expect(ticks).toHaveLength(19);
  });

  it('has no page 4 for a card without its questions', () => {
    expect(draw({ ...SAMPLE_REPORT_CARD, questionRows: undefined })).toHaveLength(3);
  });

  it('says there is not enough ad data without a cost per click, and leaves revenue out without a deal value', () => {
    const [, , outcomes] = draw({ ...SAMPLE_REPORT_CARD, cpc: null, dealValue: null });
    expect(outcomes).toContain('Not enough ad data for your topics in the United States.');
    expect(outcomes).not.toContain('Google Ads a month');
    expect(outcomes).not.toContain('A revenue scenario');
    expect(outcomes).toContain('How to get the revenue line');
    expect(outcomes).toContain('Ansvisor Growth');
    expect(outcomes).toContain('Scenarios, not a forecast or a guarantee.');
  });

  it('has no value table when fewer than five keywords had a cost per click', () => {
    const [, , outcomes] = draw({ ...SAMPLE_REPORT_CARD, cpc: { usd: 28.27, keywords: 2 } });
    expect(outcomes).toContain('Not enough ad data for your topics in the United States.');
    expect(outcomes).not.toContain('$28.27');
  });

  it('shows how to get the revenue line only without a deal value', () => {
    const [, , withDeal] = draw(SAMPLE_REPORT_CARD);
    expect(withDeal).not.toContain('How to get the revenue line');
  });

  it('speaks of a publisher’s readers in the method note', () => {
    const [results] = draw({ ...SAMPLE_REPORT_CARD, audience: 'readers' });
    expect(results).toContain('questions a reader might ask');
    const [buyers] = draw(SAMPLE_REPORT_CARD);
    expect(buyers).toContain('questions a buyer might ask');
  });

  it('speaks of deals, in their currency, for a B2B site', () => {
    const [, , outcomes] = draw({
      ...SAMPLE_REPORT_CARD,
      siteType: 'b2b',
      dealValue: { amount: 12_000, currency: 'EUR' },
    });
    expect(outcomes).toContain('Your average deal value: €12,000.');
    expect(outcomes).toContain('0.5% of visits become a deal (range 0.5%–1%)');
  });
});
