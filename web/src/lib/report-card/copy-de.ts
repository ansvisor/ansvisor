import type { CardCopy, TargetKind } from './copy';
import { countryIn, languageIn, percentIn } from './copy-names';

/**
 * The report card in German, when the form chooses it (owner decision
 * 2026-11-09), with "Sie". A country never follows a preposition whose
 * article must agree with it ("in den USA", "in der Türkei"): it stands
 * after "Land:". Ansvisor's product, feature and button names stay in
 * English, as the app shows them (owner decision 2026-11-08).
 */

const LOCALE = 'de-DE';
const pc = (n: number) => percentIn(LOCALE, n);

/** "A", "A und B", "A, B und C". */
export function listDe(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} und ${items[items.length - 1]}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The answers a base falls short of its questions × engines by: the
 * product is printed only when every question was answered.
 */
const noAnswer = (missing: number) =>
  missing === 1 ? 'eine Engine ließ 1 Frage unbeantwortet' : `${missing}-mal keine Antwort`;

interface TargetStep {
  title: (company: string, domain: string) => string;
  detail: (cited: number, answers: number) => string;
  week: (company: string, domain: string) => string;
}

export const de: CardCopy = {
  locale: LOCALE,
  list: listDe,
  countryName: (country) => countryIn('de', country),
  country: (country) => countryIn('de', country),
  language: (english) => languageIn('de', english),
  document: (company) => `KI-Sichtbarkeitsbericht: ${company}`,
  footer: (page, pages) => `${page} / ${pages}`,
  brand: 'Erstellt mit Ansvisor · www.ansvisor.com',
  engines: {
    count: (n) => plural(n, 'KI-Engine', 'KI-Engines'),
    /** As "unter …" takes it: "den drei Engines". */
    the: (n) => `den ${{ 2: 'zwei', 3: 'drei', 4: 'vier', 5: 'fünf' }[n] ?? n} Engines`,
  },

  // ─── Seite 1 ───────────────────────────────────────────────────────────────
  status: {
    eyebrow: 'Kostenloser KI-Sichtbarkeitsbericht',
    trial: 'Kostenlos testen',
    title: (company) => `Wie sichtbar ist ${company} in KI-Antworten?`,
    subtitle: (domain, country, language, date) =>
      `${domain} · ${country}, auf ${language} · ${date}`,
    oneTime: (date) =>
      `Eine einmalige Momentaufnahme: Jede Frage wurde am ${date} einmal gestellt. KI-Antworten ändern sich von Tag zu Tag; in Ansvisor werden die Fragen täglich gestellt.`,
    understood: (domain, readers) =>
      readers
        ? `So haben wir ${domain} verstanden: eine Publikation über`
        : `So haben wir ${domain} verstanden: Sie verkaufen`,
    understoodNote: 'Die Fragen auf Seite 2 beziehen sich darauf.',
    kpiVisibility: 'KI-Sichtbarkeit',
    kpiVisibilitySub: (engines, named, answers, questions, engineCount) => {
      const missing = questions * engineCount - answers;
      if (missing === 0) {
        return `in ${named} von ${answers} Antworten genannt: ${questions} Fragen × ${plural(engineCount, 'Engine', 'Engines')} (${engines})`;
      }
      return `in ${named} von ${answers} Antworten aus ${engines} genannt${missing > 0 ? ` (${noAnswer(missing)})` : ''}`;
    },
    kpiQuestions: 'Gestellte Fragen',
    kpiQuestionsSub: (engines, answers, unanswered) =>
      `in ${plural(engines, 'KI-Engine', 'KI-Engines')}: ${plural(answers, 'Antwort', 'Antworten')}${unanswered > 0 ? ` (${unanswered} ohne Antwort)` : ''}`,
    kpiLeader: 'Top-Wettbewerber',
    kpiLeaderNone: 'Keiner genannt',
    kpiLeaderSub: (answers, total) => `in ${answers} derselben ${total} Antworten genannt`,
    kpiLeaderNoneSub: 'in diesen Antworten',
    kpiCited: 'Ihre Website zitiert',
    kpiCitedSub: (total) => `von denselben ${total} Antworten mit einer Ihrer Seiten als Quelle`,
    startTitle: 'Ihr Ausgangspunkt',
    startCited: (engines, cited) =>
      `${engines} nennen Sie noch nicht, aber die KI liest Ihre Website bereits: sie hat Ihre Seiten in ${plural(cited, 'Antwort', 'Antworten')} zitiert, ohne Ihren Namen zu nennen. Hier setzen Sie an.`,
    startNone: (engines) =>
      `${engines} nennen Sie noch nicht. Jede Marke in KI-Antworten hat hier angefangen: Die Schritte auf Seite 3 sind Ihre erste Woche.`,
    firstStep: 'Ihr erster Schritt:',
    byEngine: 'Sichtbarkeit nach Engine',
    engineValue: (named, answers, pct) => `${named} von ${answers} · ${pc(pct)}`,
    growthBand: (starter) =>
      `In Ansvisor Growth: die KI-Engines von Google, ebenfalls gemessen. Starter verfolgt ${starter}; Growth ergänzt diese.`,
    whoNamed: 'Wen die KI nennt',
    noCompetitor: 'Kein Wettbewerber wurde genannt.',
    you: (name) => `${name} (Sie)`,
    answersCount: (n) => plural(n, 'Antwort', 'Antworten'),
    sitesCited: 'Von der KI am häufigsten zitiert',
    noSites: 'Keine Websites zitiert.',
    siteTag: { own: ' (Sie)', competitor: ' (Wettbewerber)', marketplace: ' (Marktplatz)' },
    alsoMarketplaces: (names) => `Ebenfalls genannte Marktplätze: ${names}`,
    alsoOthers: (names) => `Weitere genannte Unternehmen: ${names}`,
    missedTitle: 'Wo die KI andere nennt, nicht Sie',
    missedSub: (missed, total) =>
      `Bei ${missed} von ${total} Fragen nannte Sie keine Antwort. Die fünf, die Ihre Wettbewerber am häufigsten gewinnen:`,
    missedInstead: (names) => `Stattdessen genannt: ${names}`,
    missedNone: 'Keine Antwort nannte eine andere Marke.',
    measured: (questions, readers, engines, country, date) =>
      `Methode: ${questions} Fragen, die ${readers ? 'ein Leser' : 'ein Kunde'} stellen könnte, je einmal gestellt in ${engines} (Land: ${country}), am ${date}. Sichtbarkeit ist der Anteil der Antworten, die Sie mit Namen oder Website nennen; Wettbewerber und Websites werden über dieselben Antworten gezählt. Alle Fragen stehen auf Seite 2.`,
  },

  // ─── Erkenntnisse (Seiten 1 und 3) ─────────────────────────────────────────
  wins: {
    question: {
      title: (question) => `Beantworten Sie „${question}“ auf Ihrer Website`,
      detailNames: (names, company) => `Die KI nennt dafür ${names}, nicht ${company}.`,
      detailNone: (company) => `Keine der Antworten darauf nennt ${company}.`,
      week: (page) =>
        page
          ? `Schreiben Sie eine Seite, die die Frage direkt beantwortet: die Frage als Überschrift, die Antwort im ersten Absatz. Verlinken Sie sie von ${page}.`
          : 'Schreiben Sie eine Seite, die die Frage direkt beantwortet: die Frage als Überschrift, die Antwort im ersten Absatz.',
    },
    target: {
      guide: {
        title: (company, domain) => `Lassen Sie ${company} auf ${domain} listen oder bewerten`,
        detail: (cited, answers) =>
          `Ein Ratgeber, den die KI in ${cited} von ${answers} Antworten zu Ihrem Markt zitiert. Ein Eintrag oder eine Bewertung dort gibt ihr eine Quelle, die Sie nennt.`,
        week: (company, domain) =>
          `Suchen Sie die Seite auf ${domain}, die Unternehmen wie ${company} vergleicht, und bitten Sie um Aufnahme oder Bewertung.`,
      },
      publication: {
        title: (_company, domain) =>
          `Bieten Sie ${domain} eine Story oder einen Expertenkommentar an`,
        detail: (cited, answers) =>
          `Eine Publikation, die die KI in ${cited} von ${answers} Antworten zu Ihrem Markt zitiert. Ein Artikel oder Zitat dort ist eine Quelle, der sie vertraut.`,
        week: (_company, domain) =>
          `Schicken Sie der Redaktion von ${domain} einen kurzen Vorschlag: eine Zahl oder Geschichte, die nur Ihr Unternehmen hat.`,
      },
      official: {
        title: (company, domain) => `Prüfen Sie, ob ${domain} ${company} korrekt führt`,
        detail: (cited, answers) =>
          `Eine offizielle Quelle, die die KI in ${cited} von ${answers} Antworten zitiert. Ihre Registrierungen, Mitgliedschaften und Lizenzen dort sind Fakten, die sie wiederholt.`,
        week: (_company, domain) =>
          `Suchen Sie Ihren Eintrag auf ${domain}, und korrigieren oder ergänzen Sie ihn.`,
      },
      community: {
        title: (_company, domain) => `Beantworten Sie auf ${domain} Fragen zu Ihrem Markt`,
        detail: (cited, answers) =>
          `Eine Community, die die KI in ${cited} von ${answers} Antworten zitiert. Hilfreiche, offene Antworten Ihres Teams werden zitiert.`,
        week: (_company, domain) =>
          `Beantworten Sie auf ${domain} zwei offene Fragen zu Ihrem Markt, erkennbar als Ihr Team.`,
      },
      reviews: {
        title: (company, domain) =>
          `Lesen und beantworten Sie, was Kunden auf ${domain} über ${company} sagen`,
        detail: (cited, answers) =>
          `Eine Bewertungsseite, die die KI in ${cited} von ${answers} Antworten zitiert. Was Kunden dort schreiben und wie Sie antworten, liest sie über Sie.`,
        week: (_company, domain) =>
          `Antworten Sie auf die neuesten Bewertungen und Beschwerden auf ${domain}, und vervollständigen Sie Ihr Profil.`,
      },
      other: {
        title: (company, domain) => `Sorgen Sie dafür, dass ${domain} ${company} erwähnt`,
        detail: (cited, answers) =>
          `Die KI zitiert die Website in ${cited} von ${answers} Antworten zu Ihrem Markt. Eine Erwähnung oder ein Eintrag dort bringt Sie in ihr Blickfeld.`,
        week: (_company, domain) =>
          `Finden Sie heraus, wie Unternehmen auf ${domain} erwähnt werden, und fragen Sie an.`,
      },
    } as Record<TargetKind | 'other', TargetStep>,
    ownName: {
      title: 'Nennen Sie Ihren Namen, wo die KI Sie schon liest',
      detail: (cited, company) =>
        `Die KI hat Ihre Seiten in ${plural(cited, 'Antwort', 'Antworten')} zitiert, ohne ${company} zu nennen.`,
      week: 'Sagen Sie auf den Seiten, die die KI zitiert, wer Sie sind: Ihr Markenname im Titel, im ersten Satz und in den Zwischenüberschriften.',
    },
    ownPages: {
      title: 'Machen Sie Ihre Seiten leicht zitierbar',
      detail: (cited, answers) => `Ihre Website wird in ${cited} von ${answers} Antworten zitiert.`,
      week: 'Wählen Sie die drei Seiten, die die KI zitieren soll: die Antwort in den ersten Absatz, dazu eine kurze FAQ mit den Fragen dieses Berichts.',
    },
    gap: {
      title: (rival) => `Schließen Sie die Lücke zu ${rival}`,
      detail: (rival, rivalNamed, company, named) =>
        `${rival} wird in ${plural(rivalNamed, 'Antwort', 'Antworten')} genannt, ${company} in ${named}.`,
      week: (rival) =>
        `Öffnen Sie die Seite von ${rival} zu einer Frage, die ${rival} gewinnt, und notieren Sie, was dort steht und bei Ihnen fehlt.`,
    },
    weakest: {
      title: (engine) => `Sehen Sie sich an, was ${engine} über Ihren Markt sagt`,
      detail: (named, answers, engines) =>
        `In ${named} von ${answers} Antworten genannt: der niedrigste Wert unter ${engines}.`,
      week: (engine) =>
        `Stellen Sie ${engine} selbst drei Fragen aus diesem Bericht, und notieren Sie die zitierten Websites.`,
    },
    keep: {
      title: (company) => `Sichern Sie die Position von ${company}`,
      detail: (named, answers) =>
        `Die KI nennt Sie in ${named} von ${answers} Antworten, in jeder Engine ähnlich oft.`,
      week: 'Verfolgen Sie die Fragen dieses Berichts täglich: Antworten ändern sich mit jedem Engine-Update.',
    },
  },

  // ─── Seite 2 ───────────────────────────────────────────────────────────────
  questions: {
    eyebrow: 'Was wir gefragt haben',
    title: (n) => `Die ${n} Fragen und was jede Engine antwortete`,
    subtitle: (domain, country, language, products) =>
      products
        ? `Aus den wichtigsten Produkten auf ${domain} formuliert, ausgewählt nach Nähe zu Ihrem Angebot und Suchvolumen, und auf ${language} gestellt (Land: ${country}).`
        : `Auf ${language} gestellt (Land: ${country}).`,
    summaryNone: (company, answers, total, engines, engineCount) => {
      const missing = total * engineCount - answers;
      const base =
        missing === 0
          ? `${total} Fragen × ${plural(engineCount, 'Engine', 'Engines')}`
          : missing > 0
            ? noAnswer(missing)
            : null;
      return `${company} wurde in keiner der ${total} Fragen genannt: ${plural(answers, 'Antwort', 'Antworten')} von ${engines}${base ? ` (${base})` : ''}.`;
    },
    summary: (named, answers, questions, total, engines) =>
      `In ${questions} von ${total} Fragen genannt: in ${named} von ${answers} Antworten von ${engines}.`,
    legendNamed: 'Nennt Sie',
    legendMissed: 'Antwort ohne Ihren Namen',
    legendNone: 'Keine Antwort',
    colQuestion: 'Frage',
    colSearches: 'Suchen/Mon.',
    colInstead: 'Stattdessen',
    ranges: ['10–100', '100–1K', '1K–10K', '10K–100K', '100K+'],
    low: 'Niedrig',
    searchesNote: (low) =>
      `Suchen/Mon.: monatliche Google-Suchen nach dem Keyword der Frage in Ihrem Land, als Googles Spanne. ${low ? 'Niedrig: zu wenige Suchen, als dass Google eine Zahl nennt. Fragen' : 'Fragen'} an die KI sind länger als Google-Suchen, daher unterschätzt das Volumen eines Keywords sie.`,
    groupCount: (n) => plural(n, 'Frage', 'Fragen'),
    related: 'ein Bedarf, den Ihre Kunden auch haben',
    growthKey: 'Hellere Spalten: Googles Engines, in Growth',
  },

  // ─── Seite 3 ───────────────────────────────────────────────────────────────
  plan: {
    eyebrow: 'Ihr Plan',
    title: 'Drei Erkenntnisse und was Sie in Woche 1 tun würden',
    subtitle: (company) =>
      `Nach festen Regeln aus den Ergebnissen von ${company} ausgewählt: was der Bericht fand, der erste Schritt dazu und wo Ansvisor hilft.`,
    finding: 'Erkenntnis',
    weekOne: 'Woche 1',
    inAnsvisor: 'In Ansvisor',
    feature: {
      contentEditor: 'Content Editor',
      citations: 'Citations',
      siteAudit: 'Site Audit',
      competitors: 'Competitors',
      brandVisibility: 'Visibility',
    },
    targetsTitle: 'Wohin die KI schaut: Websites, auf denen Sie erscheinen können',
    targetsSub:
      'Die Websites, die die KI in Ihren Antworten zitiert, sortiert danach, was Sie dort tun können.',
    targetKind: {
      guide: 'Ratgeber und Vergleiche',
      publication: 'Publikationen',
      official: 'Offizielle Quellen',
      community: 'Communitys',
      reviews: 'Bewertungen',
      other: 'Von der KI zitiert',
    },
    targetsNone: 'Keine zitiert',
    targetsLeftOut: (names) =>
      `Ausgelassen: ${names}. Die Website eines Wettbewerbers oder ein Marktplatz ist kein Ort für einen Eintrag.`,
    howTitle: 'Wie die Arbeit erledigt wird',
    approveTitle: 'Sie geben jeden Schritt frei',
    approveBody:
      'Agenten starten in „Ask me first“ oder „Auto, ask before changes“: Ein Lauf, der etwas ändern würde, zeigt „Needs you“ und wartet auf Ihren Klick. Nichts schaltet sich von selbst ein, und jede Änderung steht im Activity log, mit Undo. In jedem Plan.',
    autoTitle: 'Oder Agenten veröffentlichen selbst',
    autoBody:
      'In Full auto, mit zwei Schaltern, die ein Admin aktiviert, senden oder veröffentlichen gewählte Agenten Seiten ohne Klick in Ihr CMS, 1 bis 20 pro Tag. Eine Seite, die Quality oder Ihre Markenfakten nicht besteht, wartet weiter auf Sie. In Growth.',
    examplePrompt: 'Ein Prompt, den Ansvisor täglich für Sie verfolgen würde:',
  },

  // ─── Seite 4 ───────────────────────────────────────────────────────────────
  value: {
    eyebrow: 'Was es wert ist',
    title: 'Was KI-Besuche wert sind, und die Pläne für diesen Bericht',
    subtitle:
      'KI-Besuche zum Preis derselben Klicks in Google Ads, beide Pläne im Vergleich, und wie Ansvisor hilft.',
    demand: (searches, country, keywords) =>
      `Die Keywords Ihrer Fragen haben rund ${searches} Google-Suchen pro Monat (${country}; ${keywords} mit Volumen).`,
    cpcLine: (cpc, keywords, total) =>
      `Median-CPC dieser Keywords in Google Ads: ${cpc} (${keywords} von ${total} hatten einen).`,
    colShare: 'Wenn die KI Ihnen schickt',
    colVisits: 'KI-Besuche pro Monat',
    colAds: 'Gleiche Klicks in Ads, pro Monat',
    colYear: 'Pro Jahr',
    share: (pct) => `${pc(pct)} dieser Suchen`,
    buying: 'Kaufen',
    buyingBody: (visits, ads, year) =>
      `${visits} Besuche pro Monat kosten in Google Ads rund ${ads}, jeden Monat: ${year} im Jahr.`,
    earning: 'Verdienen',
    earningBody: (plan, price) =>
      `Ansvisor ${plan}: ${price} pro Monat. Von der KI zitierte Seiten bringen Besuche, solange sie zitiert werden.`,
    cheap: (ads, plan, price) =>
      `Klicks sind in Ihrem Markt günstig: Diese Besuche kosten in Ads rund ${ads} pro Monat, weniger als ${plan} für ${price}. Was Werbung nicht kaufen kann: die Marke zu sein, die die KI empfiehlt, wenn Ihre Kunden fragen.`,
    slow: 'KI-Besuche wachsen über Monate: Der erste Monat ist Einrichtung und erste Seiten, noch keine Besuche.',
    noAds: (country) =>
      `Nicht genug Anzeigendaten für Ihre Fragen (Land: ${country}): Dieser Bericht bewertet keine Besuche.`,
    oddAds: (cpc, keywords) =>
      `Die gefundenen Anzeigenpreise für Ihre Keywords wirken fehlerhaft (Median ${cpc} aus ${plural(keywords, 'Keyword', 'Keywords')}): Dieser Bericht bewertet keine Besuche.`,
    tableNote:
      'Szenarien, keine Prognose: was diese Besuche als Anzeigen kosten würden, wenn KI-Antworten sie Ihnen schickten.',
    revenueTitle: 'Ein Umsatzszenario',
    revenue: (kind, value, low, high) =>
      `Ihr durchschnittlicher ${kind === 'order' ? 'Bestellwert' : 'Auftragswert'}: ${value}. Annahme: ${low} bis ${high} der KI-Besuche ${kind === 'order' ? 'bestellen' : 'werden zum Auftrag'}, nicht besser als andere Besuche.`,
    revenueRow: (visits, low, high) => `${visits} KI-Besuche pro Monat: ${low}–${high} pro Monat`,
    scenarios:
      'Szenarien, keine Prognose oder Garantie. AI Traffic in Ansvisor misst Ihre echten KI-Besuche, sobald es eingerichtet ist.',
    planTitle: 'Die Pläne für diesen Bericht',
    planName: (plan) => `Ansvisor ${plan}`,
    starterTag: 'Passt zu diesem Bericht',
    growthTag: 'Mit Googles Engines',
    perMonth: (price) => `${price}/Monat`,
    yearly: (price) => `oder ${price}/Jahr (jährlich, −${pc(20)})`,
    starterMatch: (engines, headed) =>
      headed
        ? `Verfolgt ${engines} täglich: die Engines, die die Sichtbarkeit dieses Berichts zählt.`
        : `Verfolgt ${engines} täglich.`,
    growthAdds: (engines, banded) =>
      banded
        ? `Verfolgt zusätzlich ${engines} täglich: das Growth-Band auf Seite 1.`
        : `Verfolgt zusätzlich ${engines} täglich.`,
    googleEngines: 'Google AI Overviews und Google AI Mode',
    planLimits: (prompts, brands) =>
      `${prompts} Prompts täglich verfolgt, ${plural(brands, 'Marke', 'Marken')}.`,
    aiIncluded: 'KI-Nutzung inklusive.',
    aiMore: (times) =>
      `${times}× die KI-Nutzung: jeden Monat mehr Content-Chancen, Entwürfe, Agentenläufe und Vorschläge.`,
    siteAudits: (pages) => `Site Audit: ${pages} Seiten pro Monat.`,
    starterAgents: 'Chat und Agent Center mit Agenten, die vor jeder Änderung fragen.',
    growthAgents: 'Full auto: Ihre gewählten Agenten veröffentlichen selbst.',
    mcpRead: 'MCP: Ihre Ansvisor-Daten aus KI-Tools lesen.',
    mcpReadWrite: 'MCP: Ihre Ansvisor-Daten aus KI-Tools lesen und schreiben.',
    workTitle: 'Ansvisor erledigt die Arbeit mit Ihnen',
    work: [
      {
        title: 'Chat',
        body: 'Antwortet aus Ihren eigenen Ansvisor-Daten, bereitet die Arbeit der ersten Woche aus diesem Bericht vor und liest Ihre Dateien.',
      },
      {
        title: 'Agent Center',
        body: 'Einsatzbereite Agenten und über 700 Skills: sie erledigen Routinearbeit für Ihre KI-Sichtbarkeit nach Zeitplan oder wenn sich etwas ändert.',
      },
      {
        title: 'MCP',
        body: 'Nutzen Sie Ihre Ansvisor-Daten in Claude, ChatGPT, Cursor und anderen KI-Tools.',
      },
    ],
    ctaTitle: 'Messen Sie Ihre eigenen Fragen',
    ctaBody: (prompts, engines, questions) =>
      `Starten Sie den kostenlosen Test: Starter verfolgt täglich ${prompts} Prompts in ${engines}, genug für die ${questions} Fragen dieses Berichts und ${Math.max(prompts - questions, 0)} eigene.`,
    steps: (domain, questions, country) => [
      `Fügen Sie ${domain} als Marke hinzu: Der Einrichtungsassistent dauert meist nur wenige Minuten.`,
      `Verfolgen Sie die ${questions} Fragen dieses Berichts als Prompts (Land: ${country}), und ergänzen Sie eigene.`,
      'Öffnen Sie nach dem ersten Lauf das Action Center: die nächsten Schritte, nach Priorität.',
    ],
    button: 'Jetzt kostenlos testen',
  },
};
