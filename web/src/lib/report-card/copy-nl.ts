import type { CardCopy, TargetKind } from './copy';
import { countryIn, languageIn, percentIn } from './copy-names';

/**
 * The report card in Dutch, when the form chooses it (owner decision
 * 2026-11-09), with "je". A country never follows a preposition whose
 * article must agree with it ("in de Verenigde Staten", "op de
 * Filipijnen"): it stands after "land:". Ansvisor's product, feature and
 * button names stay in English, as the app shows them (owner decision
 * 2026-11-08).
 */

const LOCALE = 'nl-NL';
const pc = (n: number) => percentIn(LOCALE, n);

/** "A", "A en B", "A, B en C". */
export function listNl(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} en ${items[items.length - 1]}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The answers a base falls short of its questions × engines by: the
 * product is printed only when every question was answered.
 */
const noAnswer = (missing: number) =>
  missing === 1 ? 'een engine gaf op 1 vraag geen antwoord' : `${missing} keer geen antwoord`;

interface TargetStep {
  title: (company: string, domain: string) => string;
  detail: (cited: number, answers: number) => string;
  week: (company: string, domain: string) => string;
}

export const nl: CardCopy = {
  locale: LOCALE,
  list: listNl,
  countryName: (country) => countryIn('nl', country),
  country: (country) => countryIn('nl', country),
  language: (english) => languageIn('nl', english),
  document: (company) => `AI-zichtbaarheidsrapport: ${company}`,
  footer: (page, pages) => `${page} / ${pages}`,
  brand: 'Gemaakt met Ansvisor · www.ansvisor.com',
  engines: {
    count: (n) => plural(n, 'AI-engine', 'AI-engines'),
    the: (n) => `de ${{ 2: 'twee', 3: 'drie', 4: 'vier', 5: 'vijf' }[n] ?? n} engines`,
  },

  // ─── Pagina 1 ──────────────────────────────────────────────────────────────
  status: {
    eyebrow: 'Gratis AI-zichtbaarheidsrapport',
    trial: 'Gratis proberen',
    title: (company) => `Hoe zichtbaar is ${company} in AI-antwoorden?`,
    subtitle: (domain, country, language, date) =>
      `${domain} · ${country}, in het ${language} · ${date}`,
    oneTime: (date) =>
      `Een momentopname: we stelden elke vraag één keer, op ${date}. AI-antwoorden veranderen van dag tot dag; in Ansvisor worden de vragen elke dag gesteld.`,
    understood: (domain, readers) =>
      readers
        ? `Zo begrepen we ${domain}: een publicatie over`
        : `Zo begrepen we ${domain}: je verkoopt`,
    understoodNote: 'De vragen op pagina 2 gaan hierover.',
    kpiVisibility: 'AI-zichtbaarheid',
    kpiVisibilitySub: (engines, named, answers, questions, engineCount) => {
      const missing = questions * engineCount - answers;
      if (missing === 0) {
        return `genoemd in ${named} van ${answers} antwoorden: ${questions} vragen × ${plural(engineCount, 'engine', 'engines')} (${engines})`;
      }
      return `genoemd in ${named} van ${answers} antwoorden van ${engines}${missing > 0 ? ` (${noAnswer(missing)})` : ''}`;
    },
    kpiQuestions: 'Gestelde vragen',
    kpiQuestionsSub: (engines, answers, unanswered) =>
      `in ${plural(engines, 'AI-engine', 'AI-engines')}: ${plural(answers, 'antwoord', 'antwoorden')}${unanswered > 0 ? ` (${unanswered} zonder antwoord)` : ''}`,
    kpiLeader: 'Grootste concurrent',
    kpiLeaderNone: 'Geen genoemd',
    kpiLeaderSub: (answers, total) => `genoemd in ${answers} van dezelfde ${total} antwoorden`,
    kpiLeaderNoneSub: 'in deze antwoorden',
    kpiCited: 'Je website geciteerd',
    kpiCitedSub: (total) => `van dezelfde ${total} antwoorden, met een pagina van jou als bron`,
    startTitle: 'Je vertrekpunt',
    startCited: (engines, cited) =>
      `${engines} noemen je nog niet, maar AI leest je website al: het citeerde je pagina’s in ${plural(cited, 'antwoord', 'antwoorden')} zonder je naam te noemen. Daar begin je.`,
    startNone: (engines) =>
      `${engines} noemen je nog niet. Elk merk in AI-antwoorden begon hier: de stappen op pagina 3 zijn je eerste week.`,
    firstStep: 'Je eerste stap:',
    byEngine: 'Zichtbaarheid per engine',
    engineValue: (named, answers, pct) => `${named} van ${answers} · ${pc(pct)}`,
    growthBand: (starter) =>
      `In Ansvisor Growth: de AI-engines van Google, ook gemeten. Starter volgt ${starter}; Growth voegt deze toe.`,
    whoNamed: 'Wie AI noemt',
    noCompetitor: 'Er werd geen concurrent genoemd.',
    you: (name) => `${name} (jij)`,
    answersCount: (n) => plural(n, 'antwoord', 'antwoorden'),
    sitesCited: 'Websites die AI het vaakst citeert',
    noSites: 'Er werden geen websites geciteerd.',
    siteTag: { own: ' (jij)', competitor: ' (concurrent)', marketplace: ' (marktplaats)' },
    alsoMarketplaces: (names) => `Ook genoemde marktplaatsen: ${names}`,
    alsoOthers: (names) => `Andere genoemde bedrijven: ${names}`,
    missedTitle: 'Waar AI anderen noemt, en jou niet',
    missedSub: (missed, total) =>
      `${missed} van de ${total} vragen kregen geen antwoord dat jou noemt. De vijf die je concurrenten het vaakst winnen:`,
    missedInstead: (names) => `In jouw plaats genoemd: ${names}`,
    missedNone: 'Geen enkel antwoord noemde een ander merk.',
    measured: (questions, readers, engines, country, date) =>
      `Zo hebben we gemeten: ${questions} vragen die een ${readers ? 'lezer' : 'klant'} zou kunnen stellen, elk één keer gesteld in ${engines} (land: ${country}), op ${date}. Zichtbaarheid is het aandeel antwoorden dat je noemt, met je naam of je website; concurrenten en websites worden over dezelfde antwoorden geteld. Alle vragen staan op pagina 2.`,
  },

  // ─── De bevindingen (pagina’s 1 en 3) ──────────────────────────────────────
  wins: {
    question: {
      title: (question) => `Beantwoord “${question}” op je website`,
      detailNames: (names, company) => `AI noemt hiervoor ${names}, en niet ${company}.`,
      detailNone: (company) => `Geen van de antwoorden hierop noemt ${company}.`,
      week: (page) =>
        page
          ? `Schrijf één pagina die de vraag direct beantwoordt, met de vraag als kop en het antwoord in de eerste alinea, en link ernaar vanaf ${page}.`
          : 'Schrijf één pagina die de vraag direct beantwoordt, met de vraag als kop en het antwoord in de eerste alinea.',
    },
    target: {
      guide: {
        title: (company, domain) => `Laat ${company} vermelden of beoordelen op ${domain}`,
        detail: (cited, answers) =>
          `Een gids die AI citeert in ${cited} van ${answers} antwoorden over je markt. Een vermelding of review daar geeft AI een bron die jou noemt.`,
        week: (company, domain) =>
          `Zoek de pagina op ${domain} die bedrijven zoals ${company} vergelijkt, en vraag om opname of een beoordeling.`,
      },
      publication: {
        title: (_company, domain) => `Pitch ${domain} een verhaal of een expertreactie`,
        detail: (cited, answers) =>
          `Een publicatie die AI citeert in ${cited} van ${answers} antwoorden over je markt. Een artikel of quote daar is een bron die AI vertrouwt.`,
        week: (_company, domain) =>
          `Stuur de redactie van ${domain} één korte pitch: een cijfer of verhaal dat alleen jouw bedrijf heeft.`,
      },
      official: {
        title: (company, domain) => `Zorg dat ${domain} ${company} correct vermeldt`,
        detail: (cited, answers) =>
          `Een officiële bron die AI citeert in ${cited} van ${answers} antwoorden. Je registraties, lidmaatschappen en vergunningen daar zijn feiten die AI herhaalt.`,
        week: (_company, domain) =>
          `Zoek jezelf op ${domain} op, en corrigeer of vul je vermelding aan.`,
      },
      community: {
        title: (_company, domain) => `Beantwoord vragen over je markt op ${domain}`,
        detail: (cited, answers) =>
          `Een community die AI citeert in ${cited} van ${answers} antwoorden. Behulpzame, open antwoorden van je team worden daar geciteerd.`,
        week: (_company, domain) =>
          `Beantwoord op ${domain} twee open vragen over je markt, namens je team en met vermelding daarvan.`,
      },
      reviews: {
        title: (company, domain) =>
          `Lees en beantwoord wat klanten op ${domain} over ${company} zeggen`,
        detail: (cited, answers) =>
          `Een reviewsite die AI citeert in ${cited} van ${answers} antwoorden. Wat klanten daar schrijven, en hoe jij reageert, is wat AI over je leest.`,
        week: (_company, domain) =>
          `Reageer op de nieuwste reviews en klachten op ${domain}, en maak je profiel compleet.`,
      },
      other: {
        title: (company, domain) => `Zorg dat ${company} genoemd wordt op ${domain}`,
        detail: (cited, answers) =>
          `AI citeert deze site in ${cited} van ${answers} antwoorden over je markt. Een vermelding daar zet je in het zicht.`,
        week: (_company, domain) =>
          `Zoek uit hoe bedrijven op ${domain} vermeld worden, en vraag erom.`,
      },
    } as Record<TargetKind | 'other', TargetStep>,
    ownName: {
      title: 'Noem je naam waar AI je al leest',
      detail: (cited, company) =>
        `AI citeerde je pagina’s in ${plural(cited, 'antwoord', 'antwoorden')} zonder ${company} te noemen.`,
      week: 'Zeg op de pagina’s die AI citeert wie je bent: je merknaam in de titel, de eerste zin en de tussenkoppen.',
    },
    ownPages: {
      title: 'Maak je pagina’s makkelijk te citeren',
      detail: (cited, answers) =>
        `Je website wordt geciteerd in ${cited} van ${answers} antwoorden.`,
      week: 'Kies de drie pagina’s die AI zou moeten citeren: het antwoord in de eerste alinea, en een korte FAQ met de vragen uit dit rapport.',
    },
    gap: {
      title: (rival) => `Verklein de afstand tot ${rival}`,
      detail: (rival, rivalNamed, company, named) =>
        `${rival} wordt genoemd in ${plural(rivalNamed, 'antwoord', 'antwoorden')}, ${company} in ${named}.`,
      week: (rival) =>
        `Open de pagina van ${rival} voor een vraag die ${rival} wint, en noteer wat daar staat en bij jou ontbreekt.`,
    },
    weakest: {
      title: (engine) => `Bekijk wat ${engine} over je markt zegt`,
      detail: (named, answers, engines) =>
        `Je wordt genoemd in ${named} van ${answers} antwoorden: het laagste van ${engines}.`,
      week: (engine) =>
        `Stel ${engine} zelf drie vragen uit dit rapport, en noteer de websites die het citeert.`,
    },
    keep: {
      title: (company) => `Houd ${company} waar het staat`,
      detail: (named, answers) =>
        `AI noemt je in ${named} van ${answers} antwoorden, in elke engine ongeveer even vaak.`,
      week: 'Volg de vragen uit dit rapport elke dag: antwoorden veranderen wanneer engines worden bijgewerkt.',
    },
  },

  // ─── Pagina 2 ──────────────────────────────────────────────────────────────
  questions: {
    eyebrow: 'Wat we vroegen',
    title: (n) => `De ${n} vragen en wat elke engine antwoordde`,
    subtitle: (domain, country, language, products) =>
      products
        ? `Geschreven op basis van de belangrijkste producten op ${domain}, gekozen op hoe goed ze aansluiten bij wat je verkoopt en hoe vaak erop gezocht wordt, en gesteld in het ${language} (land: ${country}).`
        : `Gesteld in het ${language} (land: ${country}).`,
    summaryNone: (company, answers, total, engines, engineCount) => {
      const missing = total * engineCount - answers;
      const base =
        missing === 0
          ? `${total} vragen × ${plural(engineCount, 'engine', 'engines')}`
          : missing > 0
            ? noAnswer(missing)
            : null;
      return `${company} werd in geen van de ${total} vragen genoemd: ${plural(answers, 'antwoord', 'antwoorden')} van ${engines}${base ? ` (${base})` : ''}.`;
    },
    summary: (named, answers, questions, total, engines) =>
      `Genoemd in ${questions} van de ${total} vragen: in ${named} van de ${answers} antwoorden van ${engines}.`,
    legendNamed: 'Noemt jou',
    legendMissed: 'Antwoord zonder jou',
    legendNone: 'Geen antwoord',
    colQuestion: 'Vraag',
    colSearches: 'Zoekvolume',
    colInstead: 'In jouw plaats',
    ranges: ['10–100', '100–1K', '1K–10K', '10K–100K', '100K+'],
    low: 'Laag',
    searchesNote: (low) =>
      `Zoekvolume: maandelijkse Google-zoekopdrachten naar het zoekwoord van de vraag in je land, als bereik van Google. ${low ? 'Laag: te weinig zoekopdrachten voor Google om een getal te geven. Vragen' : 'Vragen'} aan AI zijn langer dan Google-zoekopdrachten, dus het volume van een zoekwoord onderschat ze.`,
    groupCount: (n) => plural(n, 'vraag', 'vragen'),
    related: 'een behoefte die je klanten ook hebben',
    growthKey: 'Lichtere kolommen: engines van Google, in Growth',
  },

  // ─── Pagina 3 ──────────────────────────────────────────────────────────────
  plan: {
    eyebrow: 'Je plan',
    title: 'Drie bevindingen en wat je in week 1 zou doen',
    subtitle: (company) =>
      `Met vaste regels gekozen uit de resultaten van ${company}: wat het rapport vond, de eerste stap en waar Ansvisor helpt.`,
    finding: 'Bevinding',
    weekOne: 'Week 1',
    inAnsvisor: 'In Ansvisor',
    feature: {
      contentEditor: 'Content Editor',
      citations: 'Citations',
      siteAudit: 'Site Audit',
      competitors: 'Competitors',
      brandVisibility: 'Visibility',
    },
    targetsTitle: 'Waar AI kijkt: websites waar je op kunt komen',
    targetsSub: 'De websites die AI in je antwoorden citeert, gesorteerd op wat je er kunt doen.',
    targetKind: {
      guide: 'Gidsen en vergelijkingen',
      publication: 'Publicaties',
      official: 'Officiële bronnen',
      community: 'Community’s',
      reviews: 'Reviews',
      other: 'Door AI geciteerd',
    },
    targetsNone: 'Geen geciteerd',
    targetsLeftOut: (names) =>
      `Weggelaten: ${names}. De website van een concurrent of een marktplaats is geen plek om op te komen.`,
    howTitle: 'Hoe het werk gebeurt',
    approveTitle: 'Jij keurt elke stap goed',
    approveBody:
      'Agents starten in “Ask me first” of “Auto, ask before changes”: een run die iets zou wijzigen toont “Needs you” en wacht op je klik. Niets gaat vanzelf aan, en elke wijziging staat in het Activity log, met Undo. In elk plan.',
    autoTitle: 'Of laat agents zelf publiceren',
    autoBody:
      'In Full auto, met twee schakelaars die een Admin aanzet, sturen of publiceren gekozen agents pagina’s naar je CMS zonder klik, 1 tot 20 per dag. Een pagina die niet door Quality of je merkfeiten komt, wacht nog steeds op jou. In Growth.',
    examplePrompt: 'Een prompt die Ansvisor elke dag voor je zou volgen:',
  },

  // ─── Pagina 4 ──────────────────────────────────────────────────────────────
  value: {
    eyebrow: 'Wat het waard is',
    title: 'Wat AI-bezoeken waard zijn, en de plannen voor dit rapport',
    subtitle:
      'AI-bezoeken tegen de prijs van dezelfde klikken in Google Ads, de twee plannen naast elkaar, en hoe Ansvisor helpt.',
    demand: (searches, country, keywords) =>
      `De zoekwoorden van je vragen: zo’n ${searches} Google-zoekopdrachten per maand (${country}; ${keywords} met volume).`,
    cpcLine: (cpc, keywords, total) =>
      `Hun mediane kosten per klik in Google Ads: ${cpc} (${keywords} van de ${total} zoekwoorden hadden die).`,
    colShare: 'Als AI je stuurde',
    colVisits: 'AI-bezoeken per maand',
    colAds: 'Zelfde klikken in Ads, per maand',
    colYear: 'Per jaar',
    share: (pct) => `${pc(pct)} van die zoekopdrachten`,
    buying: 'Kopen',
    buyingBody: (visits, ads, year) =>
      `${visits} bezoeken per maand kosten in Google Ads zo’n ${ads}, elke maand: ${year} per jaar.`,
    earning: 'Verdienen',
    earningBody: (plan, price) =>
      `Ansvisor ${plan} kost ${price} per maand. Een pagina die AI citeert, stuurt bezoeken zolang ze geciteerd blijft.`,
    cheap: (ads, plan, price) =>
      `Klikken zijn goedkoop in je markt: deze bezoeken zouden in Ads zo’n ${ads} per maand kosten, minder dan ${plan} voor ${price}. Wat advertenties niet kunnen kopen: het merk zijn dat AI aanraadt als je klanten het vragen.`,
    slow: 'AI-bezoeken groeien over maanden: de eerste maand is inrichten en de eerste pagina’s, nog geen bezoeken.',
    noAds: (country) =>
      `Niet genoeg advertentiedata voor je vragen (land: ${country}): dit rapport waardeert geen bezoeken.`,
    oddAds: (cpc, keywords) =>
      `De gevonden advertentieprijzen voor je zoekwoorden lijken niet te kloppen (een mediaan van ${cpc} uit ${plural(keywords, 'zoekwoord', 'zoekwoorden')}): dit rapport waardeert geen bezoeken.`,
    tableNote:
      'Scenario’s, geen voorspelling: wat deze bezoeken als advertenties zouden kosten als AI-antwoorden ze naar je stuurden.',
    revenueTitle: 'Een omzetscenario',
    revenue: (kind, value, low, high) =>
      `Je gemiddelde ${kind === 'order' ? 'orderwaarde' : 'dealwaarde'}: ${value}. Aanname: ${low} tot ${high} van de AI-bezoeken ${kind === 'order' ? 'bestelt' : 'wordt een deal'}, niet beter dan andere bezoeken.`,
    revenueRow: (visits, low, high) => `${visits} AI-bezoeken per maand: ${low}–${high} per maand`,
    scenarios:
      'Scenario’s, geen voorspelling of garantie. AI Traffic in Ansvisor meet je echte AI-bezoeken zodra het is ingericht.',
    planTitle: 'De plannen voor dit rapport',
    planName: (plan) => `Ansvisor ${plan}`,
    starterTag: 'Past bij dit rapport',
    growthTag: 'Met de engines van Google',
    perMonth: (price) => `${price}/maand`,
    yearly: (price) => `of ${price}/jaar (jaarlijks, −${pc(20)})`,
    starterMatch: (engines, headed) =>
      headed
        ? `Volgt ${engines} elke dag: de engines die de zichtbaarheid van dit rapport telt.`
        : `Volgt ${engines} elke dag.`,
    growthAdds: (engines, banded) =>
      banded
        ? `Volgt ook ${engines} elke dag: de Growth-band op pagina 1.`
        : `Volgt ook ${engines} elke dag.`,
    googleEngines: 'Google AI Overviews en Google AI Mode',
    planLimits: (prompts, brands) =>
      `${prompts} prompts per dag gevolgd, ${plural(brands, 'merk', 'merken')}.`,
    aiIncluded: 'AI-gebruik inbegrepen.',
    aiMore: (times) =>
      `${times}× het AI-gebruik: elke maand meer contentkansen, concepten, agent-runs en suggesties.`,
    siteAudits: (pages) => `Site Audit: ${pages} pagina’s per maand.`,
    starterAgents: 'Chat, en Agents met agents die vóór elke wijziging vragen.',
    growthAgents: 'Full auto: de agents die je kiest publiceren zelf.',
    mcpRead: 'MCP: lees je Ansvisor-data vanuit AI-tools.',
    mcpReadWrite: 'MCP: lees en schrijf je Ansvisor-data vanuit AI-tools.',
    workTitle: 'Ansvisor doet het werk met je',
    work: [
      {
        title: 'Chat',
        body: 'Antwoordt vanuit je eigen Ansvisor-data, bereidt het werk van week 1 uit dit rapport voor en leest de bestanden die je toevoegt.',
      },
      {
        title: 'Agents',
        body: 'Kant-en-klare agents en meer dan 700 skills: ze doen routinewerk voor AI-zichtbaarheid volgens een schema of als er iets verandert.',
      },
      {
        title: 'MCP',
        body: 'Gebruik je Ansvisor-data vanuit Claude, ChatGPT, Cursor en andere AI-tools.',
      },
    ],
    ctaTitle: 'Meet je eigen vragen',
    ctaBody: (prompts, engines, questions) =>
      `Start de gratis proefperiode: Starter volgt elke dag ${prompts} prompts in ${engines}, dus de ${questions} vragen uit dit rapport passen erin, plus ${Math.max(prompts - questions, 0)} van jezelf.`,
    steps: (domain, questions, country) => [
      `Voeg ${domain} toe als merk: de installatiewizard duurt meestal een paar minuten.`,
      `Volg de ${questions} vragen uit dit rapport als prompts (land: ${country}), en voeg je eigen toe.`,
      'Open na de eerste run het Action Center: de volgende stappen, op prioriteit.',
    ],
    button: 'Start je gratis proefperiode',
  },
};
