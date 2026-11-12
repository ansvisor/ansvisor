import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportLanguage } from './copy';
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

function draw(card: ReportCardPayload, language: ReportLanguage | null = null) {
  act(() =>
    root.render(
      <ReportCardPdfDocument card={card} family="ReportCardInter-1" language={language} />,
    ),
  );
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

  it('page 1: a small trial button, a one-time snapshot, the products, Starter’s engines first and the questions missed', () => {
    const [status] = draw(SAMPLE_REPORT_CARD);
    expect(status).toContain('How visible is Brewline Coffee in AI answers?');
    expect(status).toContain('A one-time snapshot: we asked each question once, on Nov 4, 2026.');
    expect(status).toContain('How we understood brewlinecoffee.example: you sell');
    expect(status).toContain('Whole bean coffee');
    // The headline's base spelled out: 25 questions in Starter's two engines.
    expect(status).toContain(
      'named in 8 of 50 answers: 25 questions × 2 engines (ChatGPT and Google Gemini)',
    );
    expect(status).toContain('in 4 AI engines: 97 answers (3 got no answer)');
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
    // A small button in the header; the invitation itself is on page 4.
    expect(status).toContain('Start free trial');
    expect(status).not.toContain('Measure your own questions');
  });

  it('states one visibility figure on every page: the headline’s engines', () => {
    const pages = draw(SAMPLE_REPORT_CARD);
    // ChatGPT 6 of 25 and Google Gemini 2 of 25.
    expect(pages[0]).toContain('named in 8 of 50 answers');
    expect(pages[0]).toContain('Brewline Coffee (you)8 answers');
    expect(pages[1]).toContain('in 8 of the 50 answers from ChatGPT and Google Gemini');
    expect(pages[2]).toContain('Your site is cited in 2 of 50 answers.');
    for (const page of pages) expect(page).not.toMatch(/\d+ of (all |the )?97 answers/);
  });

  it('page 1 says how many got no answer instead of 25 questions × 2 engines over 49 answers', () => {
    const [status] = draw({
      ...SAMPLE_REPORT_CARD,
      engines: SAMPLE_REPORT_CARD.engines.map((e) =>
        e.engine === 'chatgpt-web' ? { ...e, answers: 24 } : e,
      ),
    });
    expect(status).toContain(
      'named in 8 of 49 answers from ChatGPT and Google Gemini (1 question got no answer from one engine)',
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
      'ChatGPT and Google Gemini don’t name you yet, but AI already reads your site: it cited your pages in 2 answers',
    );
  });

  it('page 2 is the question grid, by product, with searches and who is named instead', () => {
    const [, questions] = draw(SAMPLE_REPORT_CARD);
    expect(questions).toContain('Searches/mo');
    expect(questions).toContain('The 25 questions, and what each engine said');
    expect(questions).toContain(
      'Named in 6 of the 25 questions: in 8 of the 50 answers from ChatGPT and Google Gemini.',
    );
    expect(questions).toContain('Whole bean coffee · 14 questions · brewlinecoffee.example/beans');
    // Keyword Planner's ranges, never an exact count: 2,900 searches is 1K–10K.
    expect(questions).toContain('1K–10K');
    expect(questions).toContain('10–100');
    expect(questions).not.toContain('2,900');
    expect(questions).toContain('a need your buyers also have');
    expect(questions).toContain('Lighter columns: Google’s engines, in Growth');
    expect(questions).toContain('ChatGPTGeminiAI Overv.');
    expect(questions).toContain('Ridgeline Roasters');
  });

  it('page 2 shows Low, never 0, for a keyword Google gave 0 or no searches for', () => {
    const rows = SAMPLE_REPORT_CARD.questionRows ?? [];
    const [, questions] = draw({
      ...SAMPLE_REPORT_CARD,
      questionRows: rows.map((row, i) => ({ ...row, volume: i === 0 ? 0 : row.volume })),
    });
    // Question 1's 0 and question 25's unknown both read Low.
    expect(questions.match(/Low/g)).toHaveLength(3);
    expect(questions).toContain('best coffee beans for espresso at homeLow');
    expect(questions).toContain('coffee sampler gift boxLow');
    expect(questions).toContain(
      'Searches/mo: Google searches a month for the question’s keyword in your country, as Google’s range. Low: too few searches for Google to report; questions people ask AI are longer than Google searches',
    );
    const [, measured] = draw({
      ...SAMPLE_REPORT_CARD,
      questionRows: rows.map((row) => ({ ...row, volume: row.volume ?? 50 })),
    });
    expect(measured).not.toContain('Low');
    expect(measured).toContain('as Google’s range. Questions people ask AI are longer');
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

  it('page 4 prices the brand’s own demand, sets Starter beside Growth, and ends on the trial button', () => {
    const [, , , value] = draw(SAMPLE_REPORT_CARD);
    // 18,580 searches, said as roughly as Google gives them.
    expect(value).toContain('Your questions’ keywords get about 19,000 Google searches a month');
    expect(value).toContain('$1.85 (19 of 25 keywords had one)');
    expect(value).toContain('5% of those searches');
    expect(value).toContain('$1,719');
    expect(value).toContain('Ansvisor Starter is $49 a month.');
    expect(value).toContain('A revenue scenario');
    // Two plan cards drawn alike: Starter, then Growth.
    expect(value).toContain('The plans for this card');
    expect(value).toContain(
      'Ansvisor StarterMatches this card$49/monthor $470 a year, paid yearly: 20% off',
    );
    expect(value).toContain(
      'Ansvisor GrowthAdds Google’s engines$249/monthor $2,390 a year, paid yearly: 20% off',
    );
    expect(value).toContain(
      'Tracks ChatGPT and Google Gemini every day: the engines this card’s visibility counts.',
    );
    expect(value).toContain('50 prompts tracked every day, 1 brand.');
    expect(value).toContain('AI usage included.');
    expect(value).toContain('Site Audit: 100 pages a month.');
    expect(value).toContain(
      'Chat, and Agents in the Action Center: agents that ask before every change.',
    );
    expect(value).toContain('MCP: read your Ansvisor data from AI tools.');
    expect(value).toContain(
      'Adds Google AI Overviews and Google AI Mode every day: the Growth band on page 1.',
    );
    expect(value).toContain('200 prompts tracked every day, 4 brands.');
    expect(value).toContain('5× the AI usage: more content opportunities and drafts');
    expect(value).toContain('Site Audit: 500 pages a month.');
    expect(value).toContain('Full auto: the agents you choose publish on their own.');
    expect(value).toContain('MCP: read and write your Ansvisor data from AI tools.');
    // AI usage is never in dollars or tokens; no Growth footnote left.
    expect(value).not.toMatch(/\$(5|25) |tokens|Growth, \$249/);
    // Chat, Agent Center and MCP, with no plan's figures repeated.
    expect(value).toContain('Ansvisor does the work with you');
    expect(value).toContain('ChatAnswers from your own Ansvisor data');
    expect(value).toContain('AgentsReady-to-use agents and more than 700 skills');
    expect(value).toContain('MCPUse your Ansvisor data from Claude, ChatGPT, Cursor');
    expect(value).toContain('Measure your own questions');
    expect(value).toContain('Starter tracks 50 prompts every day');
    expect(value).toContain('Start your free trial');
    expect(value).toContain('Scenarios, not a forecast or a guarantee.');
    expect(value).not.toMatch(/will (grow|earn|rise)|guaranteed/i);
    // Page 1's small button and page 4's, each marked with its page.
    const links = [...container.querySelectorAll('a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      [
        'Start free trial',
        'https://app.ansvisor.com/en/sign-up?utm_source=report-card&utm_medium=pdf&utm_content=page1',
      ],
      [
        'Start your free trial',
        'https://app.ansvisor.com/en/sign-up?utm_source=report-card&utm_medium=pdf&utm_content=page4',
      ],
    ]);
  });

  it('page 4 doesn’t point at a Growth band an older card hasn’t got', () => {
    const [, , , value] = draw({ ...SAMPLE_REPORT_CARD, mainEngines: undefined });
    expect(value).toContain('Adds Google AI Overviews and Google AI Mode every day.');
    expect(value).toContain('Tracks ChatGPT and Google Gemini every day.');
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

  it('writes the revenue scenario’s percentages the Turkish way on a Turkish card', () => {
    const [, , , value] = draw({
      ...SAMPLE_REPORT_CARD,
      country: { code: 'TR', name: 'Türkiye' },
      language: 'Turkish',
      siteType: 'b2b',
      dealValue: { amount: 12_000, currency: 'EUR' },
    });
    expect(value).toContain('%0,5 ile %1 arası');
    expect(value).not.toContain('1% ile');
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
    expect(pages[1]).toContain('Aylık arama');
    expect(pages[1]).toContain('1\u00a0B–10\u00a0B');
    expect(pages[1]).toContain('Düşük');
    expect(pages[1]).toContain('Düşük: Google’ın sayı vermeyeceği kadar az arama;');
    expect(pages[3]).toContain('Starter ayda $49.');
    expect(pages[3]).not.toMatch(/₺|USD =/);
    expect(pages[3]).toContain('ayda yaklaşık 19.000 kez Google’da aranıyor');
    expect(pages[3]).toContain('Ansvisor StarterBu karneye uyanaylık $49');
    expect(pages[3]).toContain('Ansvisor GrowthGoogle motorlarını ekleraylık $249');
    expect(pages[3]).toContain('Yapay zekâ kullanımı dahil.');
    expect(pages[3]).toContain('5 kat yapay zekâ kullanımı');
    expect(pages[3]).toContain('Ansvisor işi sizinle birlikte yapar');
    // Ansvisor's feature names stay in English, as the app shows them.
    expect(pages[2]).toContain('Ansvisor’da · Content Editor');
    expect(pages[2]).toContain('her değişiklik Activity log’da');
    expect(pages[2]).toContain('Full auto modunda');
    expect(pages[3]).toContain('Chat ve her değişiklikten önce soran ajanlarıyla Agents.');
    expect(pages[3]).toContain('Site Audit: ayda 100 sayfa.');
    expect(pages[3]).toContain('Full auto: seçtiğiniz ajanlar kendi başına yayınlar.');
    expect(pages[3]).toContain('ChatKendi Ansvisor verilerinizden');
    expect(pages[3]).toContain('AgentsKullanıma hazır ajanlar ve 700’den fazla skill');
    expect(pages[3]).toContain('Action Center’ı açın');
    expect(pages[3]).toContain('Ansvisor’daki AI Traffic');
    expect(pages.join(' ')).not.toMatch(
      /Sohbet|Ajan Merkezi|Aksiyon Merkezi|Site Denetimi|Tam otomatik|Yapay Zekâ Trafiği|İçerik Editörü|beceri/,
    );
    expect(pages[3]).toContain('Kendi sorularınızı ölçün');
    expect(pages[0]).toContain('Ücretsiz deneyin');
    expect(pages[3]).toContain('Ücretsiz denemeyi başlatın');
    expect(pages.join(' ')).not.toMatch(/How visible|Week one|Start a free trial/);
  });
  it('writes the card in the language the request chose, naming the country in it', () => {
    const fr = draw(SAMPLE_REPORT_CARD, 'fr');
    expect(fr[0]).toContain(
      'Quelle visibilité pour Brewline Coffee dans les réponses de l’IA\u202f?',
    );
    expect(fr[0]).toContain('brewlinecoffee.example · États-Unis, en anglais · 4 nov. 2026');
    expect(fr[0]).toContain('16\u00a0%');
    expect(fr[1]).toContain('posées en anglais (pays\u00a0: États-Unis)');
    expect(fr[2]).toContain('Dans Ansvisor · Content Editor');
    expect(fr[3]).toContain('Commencer votre essai gratuit');
    expect(fr.join(' ')).not.toMatch(/How visible|Week one|Start your free trial/);
    // A Turkish card in German, and an American card in Turkish: the language wins.
    const de = draw({ ...SAMPLE_REPORT_CARD, country: { code: 'TR', name: 'Türkiye' } }, 'de');
    expect(de[0]).toContain('Wie sichtbar ist Brewline Coffee in KI-Antworten?');
    expect(de[0]).toContain('Türkei, auf Englisch');
    const tr = draw(SAMPLE_REPORT_CARD, 'tr');
    expect(tr[0]).toContain('Amerika Birleşik Devletleri, İngilizce');
    expect(tr[0]).toContain('%16');
  });
});
