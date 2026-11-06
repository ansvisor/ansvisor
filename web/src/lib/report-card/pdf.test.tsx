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

  it('page 1: a one-time snapshot, the products, Starter’s engines first and the questions missed', () => {
    const [status] = draw(SAMPLE_REPORT_CARD);
    expect(status).toContain('How visible is Brewline Coffee in AI answers?');
    expect(status).toContain('A one-time snapshot: we asked each question once, on Nov 4, 2026.');
    expect(status).toContain('How we understood brewlinecoffee.example: you sell');
    expect(status).toContain('Whole bean coffee');
    // The headline's base spelled out: 25 questions in Starter's two engines.
    expect(status).toContain(
      'named in 8 of 50 answers: 25 questions × 2 engines (ChatGPT and Microsoft Copilot)',
    );
    expect(status).toContain('in 5 AI engines: 122 answers (3 got no answer)');
    // The competitor and the citations are counted over the headline's answers.
    expect(status).toContain('named in 21 of the same 50 answers');
    expect(status).toContain('of the same 50 answers cite a page of yours');
    expect(status).toContain('competitors and sites are counted over the same answers');
    expect(status).toContain('In Ansvisor Growth: Google’s AI engines, measured too.');
    expect(status).toContain('6 of 25 · 24%');
    expect(status).toContain('Brewline Coffee (you)');
    expect(status).toContain('ridgelineroasters.example (competitor)');
    expect(status).toContain('Marketplaces also named: Bean Market');
    expect(status).toContain(
      'Your first step: Answer “where to buy fresh roasted coffee beans online” on your site',
    );
    expect(status).toContain('Where AI names others, not you');
    expect(status).toContain(
      'Named instead: Ridgeline Roasters, Harborline Beans and Copper Kettle Coffee',
    );
    expect(status).not.toContain('Your starting point');
    // One trial invitation, on page 4 only.
    expect(status).not.toMatch(/free trial/i);
  });

  it('states one visibility figure on every page: the headline’s engines', () => {
    const pages = draw(SAMPLE_REPORT_CARD);
    // ChatGPT 6 of 25 and Microsoft Copilot 2 of 25.
    expect(pages[0]).toContain('named in 8 of 50 answers');
    expect(pages[0]).toContain('Brewline Coffee (you)8 answers');
    expect(pages[1]).toContain('in 8 of the 50 answers from ChatGPT and Microsoft Copilot');
    expect(pages[2]).toContain('Your site is cited in 2 of 50 answers.');
    for (const page of pages) expect(page).not.toMatch(/\d+ of (all |the )?122 answers/);
  });

  it('page 1 says how many got no answer instead of 25 questions × 2 engines over 49 answers', () => {
    const [status] = draw({
      ...SAMPLE_REPORT_CARD,
      engines: SAMPLE_REPORT_CARD.engines.map((e) =>
        e.engine === 'chatgpt-web' ? { ...e, answers: 24 } : e,
      ),
    });
    expect(status).toContain(
      'named in 8 of 49 answers from ChatGPT and Microsoft Copilot (1 question got no answer from one engine)',
    );
    expect(status).not.toContain('25 questions × 2 engines');
  });

  it('page 1 calls a zero the starting point, and points at the pages AI already reads', () => {
    const [status] = draw({
      ...SAMPLE_REPORT_CARD,
      engines: SAMPLE_REPORT_CARD.engines.map((e) => ({ ...e, named: 0 })),
      ownCitations: 2,
    });
    expect(status).toContain('Your starting point');
    expect(status).toContain(
      'ChatGPT and Microsoft Copilot don’t name you yet, but AI already reads your site: it cited your pages in 2 answers',
    );
  });

  it('page 2 is the question grid, by product, with searches and who is named instead', () => {
    const [, questions] = draw(SAMPLE_REPORT_CARD);
    expect(questions).toContain('The 25 questions, and what each engine said');
    expect(questions).toContain(
      'Named in 6 of the 25 questions: in 8 of the 50 answers from ChatGPT and Microsoft Copilot.',
    );
    expect(questions).toContain('Whole bean coffee · 14 questions · brewlinecoffee.example/beans');
    expect(questions).toContain('2,900');
    expect(questions).toContain('a need your buyers also have');
    expect(questions).toContain('Lighter columns: Google’s engines, in Growth');
    expect(questions).toContain('CopilotGemini');
    expect(questions).toContain('Ridgeline Roasters');
  });

  it('page 3 is three findings with week one, the sites by kind and how work gets done', () => {
    const [, , plan] = draw(SAMPLE_REPORT_CARD);
    expect(plan).toContain('Three findings, and what you’d do in week one');
    expect(plan.match(/Week one/g)).toHaveLength(3);
    expect(plan).toContain('In Ansvisor · Content Editor');
    expect(plan).toContain('Guides and comparisons');
    expect(plan).toContain('coffeereview.example');
    expect(plan).toContain('Left out: ridgelineroasters.example and beanmarket.example.');
    expect(plan).toContain('You approve each step');
    expect(plan).toContain('Or let agents publish on their own');
    expect(plan).toContain('“where to buy fresh roasted coffee beans online”');
    // No feature catalogue, no trial invitation.
    expect(plan).not.toMatch(/free trial|Help article/i);
  });

  it('page 4 prices the brand’s own demand, offers Starter and holds the only trial link', () => {
    const [, , , value] = draw(SAMPLE_REPORT_CARD);
    expect(value).toContain('Your questions’ keywords get 18,580 Google searches a month');
    expect(value).toContain('$1.85 (19 of 25 keywords had one)');
    expect(value).toContain('5% of those searches');
    expect(value).toContain('$1,719');
    expect(value).toContain('Ansvisor Starter is $49 a month.');
    expect(value).toContain('Ansvisor Starter · $49/month');
    expect(value).toContain('or $470 a year, paid yearly: 20% off');
    expect(value).toContain('Tracks ChatGPT and Google Gemini every day');
    expect(value).toContain('Growth, $249/month or $2,390 a year (20% off)');
    expect(value).toContain('A revenue scenario');
    expect(value).toContain('Measure your own questions');
    expect(value).toContain('Starter tracks 50 prompts every day');
    expect(value).toContain('Scenarios, not a forecast or a guarantee.');
    expect(value).not.toMatch(/will (grow|earn|rise)|guaranteed/i);
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      'https://app.ansvisor.com/en/sign-up?utm_source=report-card&utm_medium=pdf',
    ]);
  });

  it('page 4 prices nothing without enough ad data, or with a median too high to trust', () => {
    const [, , , none] = draw({ ...SAMPLE_REPORT_CARD, cpc: null, dealValue: null });
    expect(none).toContain('Not enough ad data for your questions in the United States');
    expect(none).not.toContain('A revenue scenario');
    const [, , , odd] = draw({ ...SAMPLE_REPORT_CARD, cpc: { usd: 150, keywords: 8 } });
    expect(odd).toContain('look wrong (a median of $150.00 from 8 keywords)');
    const [, , , b2b] = draw({ ...SAMPLE_REPORT_CARD, cpc: { usd: 47.1, keywords: 8 } });
    expect(b2b).toContain('$43,756');
    expect(b2b).toContain('Scenarios, not a forecast: what these visits would cost');
  });

  it('page 4 says so when clicks cost less than Starter, instead of a saving', () => {
    const [, , , value] = draw({ ...SAMPLE_REPORT_CARD, cpc: { usd: 0.04, keywords: 8 } });
    expect(value).toContain('Clicks are cheap in your market');
    expect(value).not.toContain('Buying them');
  });

  it('has no question page for a card without its questions', () => {
    expect(draw({ ...SAMPLE_REPORT_CARD, questionRows: undefined })).toHaveLength(3);
  });

  it('speaks of a publisher’s readers in the method note', () => {
    const [status] = draw({ ...SAMPLE_REPORT_CARD, audience: 'readers' });
    expect(status).toContain('questions a reader might ask');
  });

  it('speaks of deals, in their currency, for a B2B site', () => {
    const [, , , value] = draw({
      ...SAMPLE_REPORT_CARD,
      siteType: 'b2b',
      dealValue: { amount: 12_000, currency: 'EUR' },
    });
    expect(value).toContain('Your average deal value: €12,000.');
    expect(value).toContain('0.5% to 1% of AI visits become a deal');
  });

  it('draws a Turkish card in Turkish, with its amounts in dollars', () => {
    const pages = draw({
      ...SAMPLE_REPORT_CARD,
      country: { code: 'TR', name: 'Türkiye' },
      language: 'Turkish',
    });
    expect(pages[0]).toContain('Brewline Coffee, yapay zekâ yanıtlarında ne kadar görünür?');
    expect(pages[0]).toContain('Tek seferlik bir ölçüm');
    expect(pages[0]).toContain('Ansvisor ile hazırlandı · www.ansvisor.com');
    // One base for the headline, the competitor and the citations.
    expect(pages[0]).toContain('50 yanıtın 8 tanesinde adınız geçiyor: 25 soru × 2 motor');
    expect(pages[0]).toContain('aynı 50 yanıtın 21 tanesinde geçiyor');
    expect(pages[0]).not.toContain('tüm motorlardaki');
    expect(pages[1]).toContain('25 soru ve her motorun yanıtı');
    expect(pages[2]).toContain('Üç bulgu ve ilk haftada yapacaklarınız');
    expect(pages[3]).toContain('Starter ayda $49.');
    expect(pages[3]).not.toMatch(/₺|USD =/);
    expect(pages[3]).toContain('Kendi sorularınızı ölçün');
    expect(pages.join(' ')).not.toMatch(/How visible|Week one|Start a free trial/);
  });
});
