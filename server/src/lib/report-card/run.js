import logger from '../logger.js';
import { fetchPage } from '../safe-fetch.js';
import { detectSiteType, pageExcerpt } from '../site-type-detect.js';
import { competitorsIn, summarize } from './analyze.js';
import { reportCardLimits } from './config.js';
import { countryName, languageName } from './countries.js';
import { medianCpc } from './cpc.js';
import { askEngines } from './engines.js';
import { writeQuestions } from './questions.js';

/**
 * One report card, start to end (REPORT-CARD §7): the site's home page
 * read once, 25 questions written from it, each asked in the four engines
 * from the target country, the answers read, and the questions' keywords'
 * cost per click. Answers the PDF's figures (web lib/report-card/payload.ts)
 * and the questions with what each engine said, in short.
 *
 * Every cost is counted as it is spent, in `meter`, so a card that fails
 * halfway still says what it cost: the model calls from their tokens, the
 * engine answers and the keyword call at REPORT_CARD_ANSWER_USD and
 * REPORT_CARD_VOLUME_USD.
 */

/** What a card has cost so far, in dollars. */
export function costMeter() {
  const meter = { models: 0, answers: 0, keywords: 0 };
  return Object.assign(meter, {
    total: () => meter.models + meter.answers + meter.keywords,
  });
}

/** The home page's HTML, at the site and then with "www.", or null. */
async function readHome(site, fetcher) {
  for (const host of [site, `www.${site}`]) {
    try {
      const { html } = await fetcher(`https://${host}/`, { truncate: true, maxBytes: 512 * 1024 });
      return html;
    } catch {
      // The next host, or unread.
    }
  }
  return null;
}

/**
 * @param {{ companyName: string, domain: string, site: string, country: string, language: string, industry?: string|null, dealValue?: { amount: number, currency: string }|null }} card
 * `deadline` (epoch ms) bounds the engine answers, the long part (askEngines).
 * @returns {Promise<{ payload: object, questions: object[] }>}
 */
export async function buildReportCard(
  card,
  {
    meter = costMeter(),
    now = () => new Date(),
    limits = reportCardLimits(),
    fetcher = fetchPage,
    detect = detectSiteType,
    write = writeQuestions,
    ask = askEngines,
    competitors = competitorsIn,
    cpcOf = medianCpc,
    deadline = Infinity,
  } = {},
) {
  const { companyName, domain, site, country, language } = card;
  const dealValue = card.dealValue ?? null;
  const html = await readHome(site, fetcher);
  const excerpt = html ? pageExcerpt(html) : null;

  // The site's kind sets the revenue scenario's rates: read only when the
  // person gave a deal value, from the page already read.
  let siteType = null;
  if (dealValue) {
    const cached = async () => {
      if (!html) throw new Error('unread');
      return { html };
    };
    siteType =
      (await detect({ name: companyName, domain: site }, { fetcher: cached }))?.siteType ?? null;
  }

  const written = await write({
    companyName,
    site,
    countryName: countryName(country),
    languageName: languageName(language),
    excerpt,
    industry: card.industry ?? null,
  });
  meter.models += written.costUsd;
  const { questions } = written;

  const asked = await ask(questions, country, { deadline });
  meter.answers += asked.tasks * limits.answerUsd;
  const answered = asked.answers.filter((a) => typeof a.text === 'string' && a.text.trim());
  if (!answered.length) throw new Error('No engine answered');

  // The competitors each answer names: one model call per engine.
  const named = new Map();
  const about = excerpt ? excerpt.slice(0, 600) : null;
  for (const engine of asked.engines) {
    const rows = answered
      .filter((a) => a.engine === engine)
      .map((a) => ({ index: a.question, question: questions[a.question].text, text: a.text }));
    if (!rows.length) continue;
    try {
      const found = await competitors(rows, {
        companyName,
        site,
        about,
        audience: written.audience ?? 'buyers',
      });
      meter.models += found.costUsd;
      for (const [index, names] of found.byAnswer) named.set(`${index}:${engine}`, names);
    } catch (err) {
      // The card goes on without that engine's competitors.
      logger.warn({ engine, err: err.message }, '[report-card] competitors not read');
    }
  }

  const figures = summarize(questions, asked.answers, named, {
    companyName,
    site,
    domain,
    engines: asked.engines,
  });

  const keywords = await cpcOf(
    questions.map((q) => q.keyword),
    { country, language },
  );
  if (keywords.called) meter.keywords += limits.volumeUsd;

  const payload = {
    companyName,
    domain: site,
    country: { code: country, name: countryName(country) },
    language: languageName(language),
    audience: written.audience ?? 'buyers',
    siteType,
    generatedAt: now().toISOString(),
    questionCount: questions.length,
    engines: figures.engines.filter((e) => e.answers > 0),
    competitors: figures.competitors,
    citedSites: figures.citedSites,
    ownCitations: figures.ownCitations,
    missedQuestions: figures.missedQuestions,
    missedCount: figures.missedCount,
    cpc: keywords.cpc,
    dealValue,
  };

  // The questions as asked, with each engine's answer in short: named or
  // not, the competitors it named and the sites it cited.
  const kept = questions.map((q, index) => ({
    ...q,
    answers: Object.fromEntries(
      asked.answers
        .filter((a) => a.question === index)
        .map((a) => [
          a.engine,
          a.text === null
            ? { missing: a.missing }
            : {
                named: figures.namedAnswers.has(`${index}:${a.engine}`),
                competitors: named.get(`${index}:${a.engine}`) ?? [],
                cited: [...new Set(a.citations.map((c) => c?.url).filter(Boolean))].slice(0, 10),
              },
        ]),
    ),
  }));

  return { payload, questions: kept };
}

/** Why a card failed, in plain words for the admin view. */
export function failureReason(err) {
  const message = String(err?.message ?? err ?? 'Unknown error');
  return message.replace(/\s+/g, ' ').slice(0, 300);
}
