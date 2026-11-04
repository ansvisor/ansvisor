import logger from '../logger.js';
import { fetchPage } from '../safe-fetch.js';
import { detectSiteType, pageExcerpt } from '../site-type-detect.js';
import { brandKey, citedHosts, competitorsIn, summarize } from './analyze.js';
import { reportCardLimits } from './config.js';
import { countryName, languageName } from './countries.js';
import { keywordFigures, keywordKey, medianCpc } from './cpc.js';
import { askEngines } from './engines.js';
import { pickQuestions, writeQuestions } from './questions.js';
import { sortNames } from './names.js';
import { siteOutline } from './site.js';

/**
 * One report card, start to end (REPORT-CARD §7): the site's home page
 * read once, its main products found and candidate questions written from
 * it, their keywords' search volume and cost per click looked up in one
 * call, the 15 to 20 that match the site best kept, each asked in the
 * engines from the target country, and the answers read. Answers the PDF's figures (web lib/report-card/payload.ts)
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
    sort = sortNames,
    figuresOf = keywordFigures,
  } = {},
) {
  const { companyName, domain, site, country, language } = card;
  const dealValue = card.dealValue ?? null;
  const html = await readHome(site, fetcher);
  const excerpt = html ? pageExcerpt(html) : null;
  const outline = siteOutline(html, site);

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
    country,
    countryName: countryName(country),
    languageName: languageName(language),
    excerpt,
    outline,
    industry: card.industry ?? null,
    now: now(),
  });
  meter.models += written.costUsd;

  // The candidates' keywords' searches a month and cost per click, in one
  // call: the questions kept are the best-matched and most searched.
  const keywords = await figuresOf(
    written.candidates.map((q) => q.keyword),
    { country, language },
  );
  if (keywords.called) meter.keywords += limits.volumeUsd;
  const questions = pickQuestions(written.candidates, keywords.figures);
  if (!questions.length) throw new Error('No question matched the site');
  const products = written.products ?? [];

  const asked = await ask(questions, country);
  meter.answers += asked.tasks * limits.answerUsd;
  const answered = asked.answers.filter((a) => typeof a.text === 'string' && a.text.trim());
  if (!answered.length) throw new Error('No engine answered');

  // The competitors each answer names, and the other businesses: one model
  // call per engine.
  const read = new Map();
  const readOthers = new Map();
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
      for (const [index, names] of found.byAnswer) read.set(`${index}:${engine}`, names);
      for (const [index, rest] of found.others ?? []) readOthers.set(`${index}:${engine}`, rest);
    } catch (err) {
      // The card goes on without that engine's competitors.
      logger.warn({ engine, err: err.message }, '[report-card] competitors not read');
    }
  }

  // Every name and cited site sorted once for the whole card, so a brand is
  // a competitor, a marketplace or something else on every row; without
  // that call, each answer's reading stands.
  const { named, others, siteKinds } = await sortCard(read, readOthers, asked.answers, {
    sort,
    meter,
    company: { companyName, site, about, audience: written.audience ?? 'buyers' },
  });

  const figures = summarize(
    questions,
    asked.answers,
    named,
    { companyName, site, domain, engines: asked.engines },
    { others, siteKinds },
  );

  // Page 4: every question, what each engine did with it, and the brand
  // its answers named most.
  const questionRows = questions.map((q, index) => {
    const counts = new Map();
    const marks = {};
    for (const engine of asked.engines) {
      const answer = asked.answers.find((a) => a.question === index && a.engine === engine);
      if (!answer || typeof answer.text !== 'string') {
        marks[engine] = 'none';
        continue;
      }
      marks[engine] = figures.namedAnswers.has(`${index}:${engine}`) ? 'named' : 'missed';
      for (const name of named.get(`${index}:${engine}`) ?? []) {
        const merged = figures.competitorName(name);
        counts.set(merged, (counts.get(merged) ?? 0) + 1);
      }
    }
    const instead = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      text: q.text,
      textEn: q.textEn,
      product: q.product ?? null,
      volume: q.volume ?? null,
      fit: q.fit ?? 'core',
      named: marks,
      instead,
    };
  });

  const payload = {
    companyName,
    domain: site,
    country: { code: country, name: countryName(country) },
    language: languageName(language),
    audience: written.audience ?? 'buyers',
    siteType,
    generatedAt: now().toISOString(),
    questionCount: questions.length,
    // The main products or categories the questions were written from.
    products: products.map((p) => ({ name: p.name, nameEn: p.nameEn, url: p.url })),
    engines: figures.engines.filter((e) => e.answers > 0),
    competitors: figures.competitors,
    marketplaces: figures.marketplaces,
    otherNames: figures.otherNames,
    citedSites: figures.citedSites,
    ownCitations: figures.ownCitations,
    missedQuestions: figures.missedQuestions,
    missedCount: figures.missedCount,
    questionRows,
    cpc: medianCpc(
      questions.map((q) => q.keyword),
      keywords.figures,
    ),
    dealValue,
  };

  // The questions as asked, with each engine's answer in short: named or
  // not, the competitors it named and the sites it cited.
  const kept = questions.map((q, index) => ({
    ...q,
    volume: keywords.figures.get(keywordKey(q.keyword))?.volume ?? null,
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
                others: others.get(`${index}:${a.engine}`) ?? [],
                cited: [...new Set(a.citations.map((c) => c?.url).filter(Boolean))].slice(0, 10),
              },
        ]),
    ),
  }));

  return { payload, questions: kept };
}

/**
 * Each answer's names sorted by the card's one names-and-sites call: the
 * competitors, the marketplaces and others, and each cited site's kind.
 */
async function sortCard(read, readOthers, answers, { sort, meter, company }) {
  const tally = new Map();
  const count = (name, kind) => {
    const key = brandKey(name);
    if (!key) return;
    const entry = tally.get(key) ?? { name, kind, answers: 0 };
    entry.answers += 1;
    tally.set(key, entry);
  };
  for (const names of read.values()) for (const name of names) count(name, 'competitor');
  for (const rest of readOthers.values()) for (const o of rest) count(o.name, o.kind);
  const listed = [...tally.values()].sort((a, b) => b.answers - a.answers);

  let kinds = new Map();
  let siteKinds = new Map();
  try {
    const sorted = await sort(listed, citedHosts(answers), company);
    meter.models += sorted.costUsd;
    kinds = sorted.names;
    siteKinds = sorted.sites;
  } catch (err) {
    logger.warn({ err: err.message }, '[report-card] names and sites not sorted');
  }

  const named = new Map();
  const others = new Map();
  for (const key of new Set([...read.keys(), ...readOthers.keys()])) {
    const all = [
      ...(read.get(key) ?? []).map((name) => ({ name, kind: 'competitor' })),
      ...(readOthers.get(key) ?? []),
    ].map((n) => ({ name: n.name, kind: kinds.get(brandKey(n.name)) ?? n.kind }));
    named.set(
      key,
      all.filter((n) => n.kind === 'competitor').map((n) => n.name),
    );
    others.set(
      key,
      all.filter((n) => n.kind !== 'competitor'),
    );
  }
  return { named, others, siteKinds };
}

/** Why a card failed, in plain words for the admin view. */
export function failureReason(err) {
  const message = String(err?.message ?? err ?? 'Unknown error');
  return message.replace(/\s+/g, ' ').slice(0, 300);
}
