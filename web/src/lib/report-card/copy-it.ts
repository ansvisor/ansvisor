import type { CardCopy, TargetKind } from './copy';
import { countryIn, languageIn, percentIn } from './copy-names';

/**
 * The report card in Italian, when the form chooses it (owner decision
 * 2026-11-09), with "tu". A country never follows a preposition that must
 * agree with it ("negli Stati Uniti", "in Italia"): it stands after
 * "paese:". Ansvisor's product, feature and button names stay in English,
 * as the app shows them (owner decision 2026-11-08).
 */

const LOCALE = 'it-IT';
const pc = (n: number) => percentIn(LOCALE, n);

/** "A", "A e B", "A, B e C". */
export function listIt(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "8 risposte su 50". */
const of = (n: number, total: number) => `${plural(n, 'risposta', 'risposte')} su ${total}`;

/**
 * The answers a base falls short of its questions × engines by: the
 * product is printed only when every question was answered.
 */
const noAnswer = (missing: number) =>
  missing === 1 ? 'un motore non ha risposto a 1 domanda' : `${missing} risposte mancanti`;

interface TargetStep {
  title: (company: string, domain: string) => string;
  detail: (cited: number, answers: number) => string;
  week: (company: string, domain: string) => string;
}

export const it: CardCopy = {
  locale: LOCALE,
  list: listIt,
  countryName: (country) => countryIn('it', country),
  country: (country) => countryIn('it', country),
  language: (english) => languageIn('it', english),
  document: (company) => `Report di visibilità nell’IA: ${company}`,
  footer: (page, pages) => `${page} / ${pages}`,
  brand: 'Generato con Ansvisor · www.ansvisor.com',
  engines: {
    count: (n) => plural(n, 'motore IA', 'motori IA'),
    the: (n) => `i ${{ 2: 'due', 3: 'tre', 4: 'quattro', 5: 'cinque' }[n] ?? n} motori`,
  },

  // ─── Pagina 1 ──────────────────────────────────────────────────────────────
  status: {
    eyebrow: 'Report gratuito di visibilità nell’IA',
    trial: 'Prova gratis',
    title: (company) => `Quanto è visibile ${company} nelle risposte dell’IA?`,
    subtitle: (domain, country, language, date) =>
      `${domain} · ${country}, in ${language} · ${date}`,
    oneTime: (date) =>
      `Un’istantanea: abbiamo posto ogni domanda una volta, il ${date}. Le risposte dell’IA cambiano di giorno in giorno; in Ansvisor le domande vengono poste ogni giorno.`,
    understood: (domain, readers) =>
      readers
        ? `Come abbiamo letto ${domain}: una pubblicazione su`
        : `Come abbiamo letto ${domain}: vendi`,
    understoodNote: 'Le domande a pagina 2 riguardano questi temi.',
    kpiVisibility: 'Visibilità nell’IA',
    kpiVisibilitySub: (engines, named, answers, questions, engineCount) => {
      const missing = questions * engineCount - answers;
      if (missing === 0) {
        return `compari in ${of(named, answers)}: ${questions} domande × ${plural(engineCount, 'motore', 'motori')} (${engines})`;
      }
      return `compari in ${named} delle ${answers} risposte di ${engines}${missing > 0 ? ` (${noAnswer(missing)})` : ''}`;
    },
    kpiQuestions: 'Domande poste',
    kpiQuestionsSub: (engines, answers, unanswered) =>
      `in ${plural(engines, 'motore IA', 'motori IA')}: ${plural(answers, 'risposta', 'risposte')}${unanswered > 0 ? ` (${unanswered} senza risposta)` : ''}`,
    kpiLeader: 'Concorrente principale',
    kpiLeaderNone: 'Nessuno',
    kpiLeaderSub: (answers, total) => `menzionato in ${answers} delle stesse ${total} risposte`,
    kpiLeaderNoneSub: 'in queste risposte',
    kpiCited: 'Il tuo sito citato',
    kpiCitedSub: (total) => `delle stesse ${total} risposte, con una tua pagina come fonte`,
    startTitle: 'Il tuo punto di partenza',
    startCited: (engines, cited) =>
      `${engines} non ti menzionano ancora, ma l’IA legge già il tuo sito: ha citato le tue pagine in ${plural(cited, 'risposta', 'risposte')} senza fare il tuo nome. È da qui che si parte.`,
    startNone: (engines) =>
      `${engines} non ti menzionano ancora. Ogni marchio presente nelle risposte dell’IA è partito da qui: i passi a pagina 3 sono la tua prima settimana.`,
    firstStep: 'Il tuo primo passo:',
    byEngine: 'Visibilità per motore',
    engineValue: (named, answers, pct) => `${named} su ${answers} · ${pc(pct)}`,
    growthBand: (starter) =>
      `In Ansvisor Growth: anche i motori IA di Google, misurati. Starter monitora ${starter}; Growth aggiunge questi.`,
    whoNamed: 'Chi menziona l’IA',
    noCompetitor: 'Nessun concorrente menzionato.',
    you: (name) => `${name} (tu)`,
    answersCount: (n) => plural(n, 'risposta', 'risposte'),
    sitesCited: 'Siti più citati dall’IA',
    noSites: 'Nessun sito citato.',
    siteTag: { own: ' (tu)', competitor: ' (concorrente)', marketplace: ' (marketplace)' },
    alsoMarketplaces: (names) => `Menzionati anche i marketplace: ${names}`,
    alsoOthers: (names) => `Altre aziende menzionate: ${names}`,
    missedTitle: 'Dove l’IA menziona altri, non te',
    missedSub: (missed, total) =>
      `${missed} domande su ${total} non hanno avuto risposte che ti menzionino. Le cinque che i tuoi concorrenti vincono di più:`,
    missedInstead: (names) => `Menzionati al tuo posto: ${names}`,
    missedNone: 'Nessuna risposta ha menzionato un altro marchio.',
    measured: (questions, readers, engines, country, date) =>
      `Come abbiamo misurato: ${questions} domande che un ${readers ? 'lettore' : 'cliente'} potrebbe fare, poste una volta ciascuna a ${engines} (paese: ${country}), il ${date}. La visibilità è la quota di risposte che ti menzionano, per nome o per sito; concorrenti e siti sono contati sulle stesse risposte. Tutte le domande sono a pagina 2.`,
  },

  // ─── Le scoperte (pagine 1 e 3) ────────────────────────────────────────────
  wins: {
    question: {
      title: (question) => `Rispondi a «${question}» sul tuo sito`,
      detailNames: (names, company) => `Qui l’IA menziona ${names}, e non ${company}.`,
      detailNone: (company) => `Nessuna risposta a questa domanda menziona ${company}.`,
      week: (page) =>
        page
          ? `Scrivi una pagina che risponda direttamente, con la domanda come titolo e la risposta nel primo paragrafo, e collegala da ${page}.`
          : 'Scrivi una pagina che risponda direttamente, con la domanda come titolo e la risposta nel primo paragrafo.',
    },
    target: {
      guide: {
        title: (company, domain) => `Fai inserire o recensire ${company} su ${domain}`,
        detail: (cited, answers) =>
          `Una guida che l’IA cita in ${of(cited, answers)} sul tuo mercato. Una scheda o una recensione lì le dà una fonte che ti menziona.`,
        week: (company, domain) =>
          `Trova la pagina di ${domain} che confronta aziende come ${company} e chiedi di essere inserito o recensito.`,
      },
      publication: {
        title: (_company, domain) => `Proponi a ${domain} una storia o un commento da esperto`,
        detail: (cited, answers) =>
          `Una testata che l’IA cita in ${of(cited, answers)} sul tuo mercato. Un articolo o una citazione lì è una fonte di cui si fida.`,
        week: (_company, domain) =>
          `Invia alla redazione di ${domain} una breve proposta: un dato o una storia che solo la tua azienda ha.`,
      },
      official: {
        title: (company, domain) => `Verifica che ${domain} presenti ${company} correttamente`,
        detail: (cited, answers) =>
          `Una fonte ufficiale che l’IA cita in ${of(cited, answers)}. Registrazioni, iscrizioni e licenze lì sono fatti che ripete.`,
        week: (_company, domain) =>
          `Cerca la tua azienda su ${domain} e correggi o completa la scheda.`,
      },
      community: {
        title: (_company, domain) => `Rispondi su ${domain} alle domande sul tuo mercato`,
        detail: (cited, answers) =>
          `Una community che l’IA cita in ${of(cited, answers)}. Le risposte utili e trasparenti del tuo team sono quelle che vengono citate.`,
        week: (_company, domain) =>
          `Rispondi su ${domain} a due domande aperte sul tuo mercato, a nome del tuo team e dichiarandolo.`,
      },
      reviews: {
        title: (company, domain) =>
          `Leggi e rispondi a ciò che i clienti dicono di ${company} su ${domain}`,
        detail: (cited, answers) =>
          `Un sito di recensioni che l’IA cita in ${of(cited, answers)}. Ciò che i clienti scrivono lì, e come rispondi, è ciò che legge su di te.`,
        week: (_company, domain) =>
          `Rispondi alle ultime recensioni e ai reclami su ${domain} e completa il tuo profilo.`,
      },
      other: {
        title: (company, domain) => `Fai menzionare ${company} su ${domain}`,
        detail: (cited, answers) =>
          `L’IA lo cita in ${of(cited, answers)} sul tuo mercato. Una menzione o una scheda lì ti mette sotto i suoi occhi.`,
        week: (_company, domain) =>
          `Scopri come le aziende vengono menzionate su ${domain} e fai richiesta.`,
      },
    } as Record<TargetKind | 'other', TargetStep>,
    ownName: {
      title: 'Fai il tuo nome dove l’IA già ti legge',
      detail: (cited, company) =>
        `L’IA ha citato le tue pagine in ${plural(cited, 'risposta', 'risposte')} senza nominare ${company}.`,
      week: 'Nelle pagine che l’IA cita, di’ chi sei: il tuo marchio nel titolo, nella prima frase e nei sottotitoli.',
    },
    ownPages: {
      title: 'Rendi le tue pagine facili da citare',
      detail: (cited, answers) => `Il tuo sito è citato in ${of(cited, answers)}.`,
      week: 'Scegli le tre pagine che l’IA dovrebbe citare: la risposta nel primo paragrafo e una breve FAQ con le domande di questo report.',
    },
    gap: {
      title: (rival) => `Riduci il distacco da ${rival}`,
      detail: (rival, rivalNamed, company, named) =>
        `${rival} è menzionato in ${plural(rivalNamed, 'risposta', 'risposte')}, ${company} in ${named}.`,
      week: (rival) =>
        `Apri la pagina di ${rival} per una domanda che vince, ed elenca ciò che dice e la tua no.`,
    },
    weakest: {
      title: (engine) => `Guarda cosa dice ${engine} sul tuo mercato`,
      detail: (named, answers, engines) =>
        `Ti menziona in ${of(named, answers)}, il dato più basso tra ${engines}.`,
      week: (engine) =>
        `Fai tu stesso a ${engine} tre domande di questo report e annota i siti che cita.`,
    },
    keep: {
      title: (company) => `Mantieni ${company} dov’è`,
      detail: (named, answers) =>
        `L’IA ti menziona in ${of(named, answers)}, in modo simile in ogni motore.`,
      week: 'Monitora ogni giorno le domande di questo report: le risposte cambiano con gli aggiornamenti dei motori.',
    },
  },

  // ─── Pagina 2 ──────────────────────────────────────────────────────────────
  questions: {
    eyebrow: 'Cosa abbiamo chiesto',
    title: (n) => `Le ${n} domande e cosa ha risposto ogni motore`,
    subtitle: (domain, country, language, products) =>
      products
        ? `Scritte a partire dai prodotti principali di ${domain}, scelte per quanto corrispondono a ciò che vendi e per quanto vengono cercate, e poste in ${language} (paese: ${country}).`
        : `Poste in ${language} (paese: ${country}).`,
    summaryNone: (company, answers, total, engines, engineCount) => {
      const missing = total * engineCount - answers;
      const base =
        missing === 0
          ? `${total} domande × ${plural(engineCount, 'motore', 'motori')}`
          : missing > 0
            ? noAnswer(missing)
            : null;
      return `Nessuna risposta alle ${total} domande menziona ${company}: ${plural(answers, 'risposta', 'risposte')} di ${engines}${base ? ` (${base})` : ''}.`;
    },
    summary: (named, answers, questions, total, engines) =>
      `Compari in ${questions} delle ${total} domande: in ${named} delle ${answers} risposte di ${engines}.`,
    legendNamed: 'Ti menziona',
    legendMissed: 'Risponde senza menzionarti',
    legendNone: 'Nessuna risposta',
    colQuestion: 'Domanda',
    colSearches: 'Ric./mese',
    colInstead: 'Al tuo posto',
    ranges: ['10–100', '100–1K', '1K–10K', '10K–100K', '100K+'],
    low: 'Basso',
    searchesNote: (low) =>
      `Ric./mese: ricerche Google mensili per la parola chiave della domanda nel tuo paese, come fascia di Google. ${low ? 'Basso: troppo poche ricerche perché Google dia un numero. Le' : 'Le'} domande poste all’IA sono più lunghe delle ricerche su Google, quindi il volume di una parola chiave le sottostima.`,
    groupCount: (n) => plural(n, 'domanda', 'domande'),
    related: 'un bisogno che hanno anche i tuoi clienti',
    growthKey: 'Colonne chiare: motori di Google, in Growth',
  },

  // ─── Pagina 3 ──────────────────────────────────────────────────────────────
  plan: {
    eyebrow: 'Il tuo piano',
    title: 'Tre scoperte e cosa faresti nella prima settimana',
    subtitle: (company) =>
      `Scelte tra i risultati di ${company} con regole fisse: cosa ha trovato il report, la prima cosa da fare e dove aiuta Ansvisor.`,
    finding: 'Scoperta',
    weekOne: 'Settimana 1',
    inAnsvisor: 'In Ansvisor',
    feature: {
      contentEditor: 'Content Editor',
      citations: 'Citations',
      siteAudit: 'Site Audit',
      competitors: 'Competitors',
      brandVisibility: 'Visibility',
    },
    targetsTitle: 'Dove guarda l’IA: siti in cui puoi comparire',
    targetsSub: 'I siti che l’IA cita nelle tue risposte, ordinati in base a cosa puoi fare lì.',
    targetKind: {
      guide: 'Guide e confronti',
      publication: 'Testate',
      official: 'Fonti ufficiali',
      community: 'Community',
      reviews: 'Recensioni',
      other: 'Siti citati dall’IA',
    },
    targetsNone: 'Nessuno citato',
    targetsLeftOut: (names) =>
      `Esclusi: ${names}. Il sito di un concorrente o un marketplace non è un posto in cui comparire.`,
    howTitle: 'Come si svolge il lavoro',
    approveTitle: 'Approvi ogni passo',
    approveBody:
      'Gli agenti partono in «Ask me first» o «Auto, ask before changes»: un’esecuzione che cambierebbe qualcosa mostra «Needs you» e aspetta il tuo clic. Nulla si attiva da solo, e ogni modifica è nell’Activity log, con Undo. In tutti i piani.',
    autoTitle: 'Oppure lascia che gli agenti pubblichino da soli',
    autoBody:
      'In Full auto, con due interruttori che attiva un Admin, gli agenti scelti inviano o pubblicano pagine nel tuo CMS senza un clic, da 1 a 20 al giorno. Una pagina che non supera Quality o i dati del tuo marchio ti aspetta comunque. In Growth.',
    examplePrompt: 'Un prompt che Ansvisor monitorerebbe per te, ogni giorno:',
  },

  // ─── Pagina 4 ──────────────────────────────────────────────────────────────
  value: {
    eyebrow: 'Quanto vale',
    title: 'Quanto valgono le visite dall’IA, e i piani per questo report',
    subtitle:
      'Le visite dall’IA al prezzo degli stessi clic in Google Ads, i due piani a confronto, e come aiuta Ansvisor.',
    demand: (searches, country, keywords) =>
      `Le parole chiave delle tue domande totalizzano circa ${searches} ricerche Google al mese (${country}; ${keywords} con volume).`,
    cpcLine: (cpc, keywords, total) =>
      `Il loro costo per clic mediano in Google Ads: ${cpc} (${keywords} parole chiave su ${total} ne avevano uno).`,
    colShare: 'Se l’IA ti inviasse',
    colVisits: 'Visite dall’IA al mese',
    colAds: 'Stessi clic in Ads, al mese',
    colYear: 'All’anno',
    share: (pct) => `il ${pc(pct)} di quelle ricerche`,
    buying: 'Comprarle',
    buyingBody: (visits, ads, year) =>
      `${visits} visite al mese costano circa ${ads} in Google Ads, ogni mese: ${year} all’anno.`,
    earning: 'Guadagnarle',
    earningBody: (plan, price) =>
      `Ansvisor ${plan} costa ${price} al mese. Una pagina citata dall’IA porta visite finché resta citata.`,
    cheap: (ads, plan, price) =>
      `Nel tuo mercato i clic costano poco: queste visite costerebbero circa ${ads} al mese in Ads, meno di ${plan} a ${price}. Ciò che la pubblicità non può comprare è essere il marchio che l’IA consiglia quando i tuoi clienti chiedono.`,
    slow: 'Le visite dall’IA crescono nel giro di mesi: il primo mese è configurazione e prime pagine, non ancora visite.',
    noAds: (country) =>
      `Dati pubblicitari insufficienti per le tue domande (paese: ${country}): nessuna visita è valorizzata in questo report.`,
    oddAds: (cpc, keywords) =>
      `I prezzi pubblicitari trovati per le tue parole chiave sembrano errati (mediana di ${cpc} su ${plural(keywords, 'parola chiave', 'parole chiave')}): nessuna visita è valorizzata in questo report.`,
    tableNote:
      'Scenari, non una previsione: quanto costerebbero queste visite in pubblicità se le risposte dell’IA te le inviassero.',
    revenueTitle: 'Uno scenario di ricavi',
    revenue: (kind, value, low, high) =>
      `Il tuo valore medio per ${kind === 'order' ? 'ordine' : 'contratto'}: ${value}. Ipotesi: ${low}–${high} delle visite dall’IA ${kind === 'order' ? 'diventano ordini' : 'diventano contratti'}, non meglio delle altre visite.`,
    revenueRow: (visits, low, high) => `${visits} visite dall’IA al mese: ${low}–${high} al mese`,
    scenarios:
      'Scenari, non una previsione né una garanzia. AI Traffic in Ansvisor misura le tue visite reali dall’IA una volta configurato.',
    planTitle: 'I piani per questo report',
    planName: (plan) => `Ansvisor ${plan}`,
    starterTag: 'Adatto a questo report',
    growthTag: 'Aggiunge i motori di Google',
    perMonth: (price) => `${price}/mese`,
    yearly: (price) => `o ${price}/anno (annuale, −${pc(20)})`,
    starterMatch: (engines, headed) =>
      headed
        ? `Monitora ${engines} ogni giorno: i motori su cui si calcola la visibilità di questo report.`
        : `Monitora ${engines} ogni giorno.`,
    growthAdds: (engines, banded) =>
      banded
        ? `Monitora anche ${engines} ogni giorno: la fascia Growth a pagina 1.`
        : `Monitora anche ${engines} ogni giorno.`,
    googleEngines: 'Google AI Overviews e Google AI Mode',
    planLimits: (prompts, brands) =>
      `${prompts} prompt monitorati ogni giorno, ${plural(brands, 'marchio', 'marchi')}.`,
    aiIncluded: 'Uso dell’IA incluso.',
    aiMore: (times) =>
      `${times}× l’uso dell’IA: ogni mese più opportunità di contenuto, bozze, esecuzioni degli agenti e suggerimenti.`,
    siteAudits: (pages) => `Site Audit: ${pages} pagine al mese.`,
    starterAgents: 'Chat e Agents con agenti che chiedono prima di ogni modifica.',
    growthAgents: 'Full auto: gli agenti che scegli pubblicano da soli.',
    mcpRead: 'MCP: leggi i tuoi dati dagli strumenti di IA.',
    mcpReadWrite: 'MCP: leggi e scrivi i tuoi dati dagli strumenti di IA.',
    workTitle: 'Ansvisor fa il lavoro con te',
    work: [
      {
        title: 'Chat',
        body: 'Risponde con i tuoi dati Ansvisor, prepara il lavoro della prima settimana di questo report e legge i file che aggiungi.',
      },
      {
        title: 'Agents',
        body: 'Agenti pronti all’uso e oltre 700 skill: svolgono il lavoro di routine sulla visibilità nell’IA secondo un calendario o quando qualcosa cambia.',
      },
      {
        title: 'MCP',
        body: 'Usa i tuoi dati Ansvisor da Claude, ChatGPT, Cursor e altri strumenti di IA.',
      },
    ],
    ctaTitle: 'Misura le tue domande',
    ctaBody: (prompts, engines, questions) =>
      `Inizia la prova gratuita: Starter monitora ${prompts} prompt ogni giorno in ${engines}, quindi ci stanno le ${questions} domande di questo report e ${Math.max(prompts - questions, 0)} tue.`,
    steps: (domain, questions, country) => [
      `Aggiungi ${domain} come marchio: la configurazione guidata richiede di solito pochi minuti.`,
      `Monitora le ${questions} domande di questo report come prompt (paese: ${country}) e aggiungi le tue.`,
      'Apri l’Action Center dopo la prima esecuzione: le prossime azioni, in ordine di priorità.',
    ],
    button: 'Inizia la prova gratuita',
  },
};
