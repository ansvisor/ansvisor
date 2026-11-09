import type { CardCopy, TargetKind } from './copy';
import { countryIn, languageIn, percentIn } from './copy-names';

/**
 * The report card in French, when the form chooses it (owner decision
 * 2026-11-09). A country never follows a preposition that must agree with
 * it ("aux États-Unis", "en France"): it stands after "pays :". Ansvisor's
 * product, feature and button names stay in English, as the app shows them
 * (owner decision 2026-11-08). A no-break space comes before a colon, and
 * a narrow one before ; and ?, as French sets them.
 */

const LOCALE = 'fr-FR';
const pc = (n: number) => percentIn(LOCALE, n);

/** "A", "A et B", "A, B et C". */
export function listFr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/** 0 and 1 take the singular in French. */
const plural = (n: number, one: string, many: string) => `${n} ${n <= 1 ? one : many}`;

/** "8 réponses sur 50". */
const of = (n: number, total: number) => `${plural(n, 'réponse', 'réponses')} sur ${total}`;

/**
 * The answers a base falls short of its questions × engines by: the
 * product is printed only when every question was answered.
 */
const noAnswer = (missing: number) =>
  missing === 1 ? 'un moteur n’a pas répondu à 1 question' : `${missing} réponses manquantes`;

interface TargetStep {
  title: (company: string, domain: string) => string;
  detail: (cited: number, answers: number) => string;
  week: (company: string, domain: string) => string;
}

export const fr: CardCopy = {
  locale: LOCALE,
  list: listFr,
  countryName: (country) => countryIn('fr', country),
  country: (country) => countryIn('fr', country),
  language: (english) => languageIn('fr', english),
  document: (company) => `Rapport de visibilité IA\u00a0: ${company}`,
  footer: (page, pages) => `${page} / ${pages}`,
  brand: 'Généré avec Ansvisor · www.ansvisor.com',
  engines: {
    count: (n) => plural(n, 'moteur IA', 'moteurs IA'),
    the: (n) => `les ${{ 2: 'deux', 3: 'trois', 4: 'quatre', 5: 'cinq' }[n] ?? n} moteurs`,
  },

  // ─── Page 1 ────────────────────────────────────────────────────────────────
  status: {
    eyebrow: 'Rapport gratuit de visibilité IA',
    trial: 'Essai gratuit',
    title: (company) => `Quelle visibilité pour ${company} dans les réponses de l’IA\u202f?`,
    subtitle: (domain, country, language, date) =>
      `${domain} · ${country}, en ${language} · ${date}`,
    oneTime: (date) =>
      `Un instantané\u00a0: chaque question a été posée une fois, le ${date}. Les réponses de l’IA changent d’un jour à l’autre\u202f; dans Ansvisor, les questions sont posées chaque jour.`,
    understood: (domain, readers) =>
      readers
        ? `Notre lecture de ${domain}\u00a0: une publication sur`
        : `Notre lecture de ${domain}\u00a0: vous vendez`,
    understoodNote: 'Les questions de la page 2 portent sur ces sujets.',
    kpiVisibility: 'Visibilité IA',
    kpiVisibilitySub: (engines, named, answers, questions, engineCount) => {
      const missing = questions * engineCount - answers;
      if (missing === 0) {
        return `mentionné dans ${of(named, answers)}\u00a0: ${questions} questions × ${plural(engineCount, 'moteur', 'moteurs')} (${engines})`;
      }
      return `mentionné dans ${named} des ${answers} réponses de ${engines}${missing > 0 ? ` (${noAnswer(missing)})` : ''}`;
    },
    kpiQuestions: 'Questions posées',
    kpiQuestionsSub: (engines, answers, unanswered) =>
      `à ${plural(engines, 'moteur IA', 'moteurs IA')}\u00a0: ${plural(answers, 'réponse', 'réponses')}${unanswered > 0 ? ` (${unanswered} sans réponse)` : ''}`,
    kpiLeader: 'Principal concurrent',
    kpiLeaderNone: 'Aucun',
    kpiLeaderSub: (answers, total) => `mentionné dans ${answers} des ${total} mêmes réponses`,
    kpiLeaderNoneSub: 'dans ces réponses',
    kpiCited: 'Votre site cité',
    kpiCitedSub: (total) => `des ${total} mêmes réponses citant une de vos pages`,
    startTitle: 'Votre point de départ',
    startCited: (engines, cited) =>
      `${engines} ne vous mentionnent pas encore, mais l’IA lit déjà votre site\u00a0: elle a cité vos pages dans ${plural(cited, 'réponse', 'réponses')} sans dire votre nom. C’est par là qu’il faut commencer.`,
    startNone: (engines) =>
      `${engines} ne vous mentionnent pas encore. Toutes les marques présentes dans les réponses de l’IA sont parties de là\u00a0: les étapes de la page 3 sont votre première semaine.`,
    firstStep: 'Votre première étape\u00a0:',
    byEngine: 'Visibilité par moteur',
    engineValue: (named, answers, pct) => `${named} sur ${answers} · ${pc(pct)}`,
    growthBand: (starter) =>
      `Dans Ansvisor Growth\u00a0: les moteurs IA de Google, mesurés aussi. Starter suit ${starter}\u202f; Growth ajoute ceux-ci.`,
    whoNamed: 'Qui l’IA mentionne',
    noCompetitor: 'Aucun concurrent mentionné.',
    you: (name) => `${name} (vous)`,
    answersCount: (n) => plural(n, 'réponse', 'réponses'),
    sitesCited: 'Sites les plus cités par l’IA',
    noSites: 'Aucun site cité.',
    siteTag: { own: ' (vous)', competitor: ' (concurrent)', marketplace: ' (marketplace)' },
    alsoMarketplaces: (names) => `Marketplaces aussi mentionnées\u00a0: ${names}`,
    alsoOthers: (names) => `Autres entreprises mentionnées\u00a0: ${names}`,
    missedTitle: 'Où l’IA mentionne les autres, pas vous',
    missedSub: (missed, total) =>
      `${missed} questions sur ${total} n’ont reçu aucune réponse qui vous mentionne. Les cinq que vos concurrents remportent le plus\u00a0:`,
    missedInstead: (names) => `Nommés à la place\u00a0: ${names}`,
    missedNone: 'Aucune réponse n’a mentionné une autre marque.',
    measured: (questions, readers, engines, country, date) =>
      `Méthode\u00a0: ${questions} questions qu’un ${readers ? 'lecteur' : 'client'} pourrait poser, posées une fois chacune à ${engines} (pays\u00a0: ${country}), le ${date}. La visibilité est la part des réponses qui vous mentionnent, par votre nom ou votre site\u202f; concurrents et sites sont comptés sur les mêmes réponses. Toutes les questions sont en page 2.`,
  },

  // ─── Les constats (pages 1 et 3) ───────────────────────────────────────────
  wins: {
    question: {
      title: (question) => `Répondez à «\u00a0${question}\u00a0» sur votre site`,
      detailNames: (names, company) => `L’IA y mentionne ${names}, et pas ${company}.`,
      detailNone: (company) => `Aucune réponse à cette question ne mentionne ${company}.`,
      week: (page) =>
        page
          ? `Rédigez une page qui y répond directement, la question en titre et la réponse dans le premier paragraphe, et liez-la depuis ${page}.`
          : 'Rédigez une page qui y répond directement, la question en titre et la réponse dans le premier paragraphe.',
    },
    target: {
      guide: {
        title: (company, domain) => `Faites référencer ou évaluer ${company} sur ${domain}`,
        detail: (cited, answers) =>
          `Un guide que l’IA cite dans ${of(cited, answers)} sur votre marché. Une fiche ou un avis là-bas lui donne une source qui vous mentionne.`,
        week: (company, domain) =>
          `Trouvez la page de ${domain} qui compare des entreprises comme ${company}, et demandez à y figurer ou à être évalué.`,
      },
      publication: {
        title: (_company, domain) => `Proposez à ${domain} un sujet ou un avis d’expert`,
        detail: (cited, answers) =>
          `Un média que l’IA cite dans ${of(cited, answers)} sur votre marché. Un article ou une citation là-bas est une source en laquelle elle a confiance.`,
        week: (_company, domain) =>
          `Envoyez à la rédaction de ${domain} une courte proposition\u00a0: un chiffre ou une histoire propre à votre entreprise.`,
      },
      official: {
        title: (company, domain) => `Vérifiez que ${domain} présente ${company} correctement`,
        detail: (cited, answers) =>
          `Une source officielle que l’IA cite dans ${of(cited, answers)}. Vos enregistrements, adhésions et licences y sont des faits qu’elle reprend.`,
        week: (_company, domain) =>
          `Cherchez votre entreprise sur ${domain}, puis corrigez ou complétez votre fiche.`,
      },
      community: {
        title: (_company, domain) => `Répondez sur ${domain} aux questions de votre marché`,
        detail: (cited, answers) =>
          `Une communauté que l’IA cite dans ${of(cited, answers)}. Ce sont les réponses utiles et transparentes de votre équipe qui sont reprises.`,
        week: (_company, domain) =>
          `Répondez sur ${domain} à deux questions ouvertes sur votre marché, au nom de votre équipe et en le disant.`,
      },
      reviews: {
        title: (company, domain) =>
          `Sur ${domain}, lisez les avis clients sur ${company} et répondez-y`,
        detail: (cited, answers) =>
          `Un site d’avis que l’IA cite dans ${of(cited, answers)}. Ce que les clients y écrivent, et vos réponses, c’est ce qu’elle lit sur vous.`,
        week: (_company, domain) =>
          `Répondez aux derniers avis et réclamations sur ${domain}, et complétez votre profil.`,
      },
      other: {
        title: (company, domain) => `Faites mentionner ${company} sur ${domain}`,
        detail: (cited, answers) =>
          `L’IA le cite dans ${of(cited, answers)} sur votre marché. Une mention ou une fiche là-bas vous place sous ses yeux.`,
        week: (_company, domain) =>
          `Découvrez comment les entreprises sont mentionnées sur ${domain}, et faites la demande.`,
      },
    } as Record<TargetKind | 'other', TargetStep>,
    ownName: {
      title: 'Dites votre nom là où l’IA vous lit déjà',
      detail: (cited, company) =>
        `L’IA a cité vos pages dans ${plural(cited, 'réponse', 'réponses')} sans nommer ${company}.`,
      week: 'Sur les pages que l’IA cite, dites qui vous êtes\u00a0: votre marque dans le titre, la première phrase et les intertitres.',
    },
    ownPages: {
      title: 'Rendez vos pages faciles à citer',
      detail: (cited, answers) => `Votre site est cité dans ${of(cited, answers)}.`,
      week: 'Choisissez les trois pages que l’IA devrait citer\u00a0: la réponse dans le premier paragraphe, et une courte FAQ avec les questions de ce rapport.',
    },
    gap: {
      title: (rival) => `Réduisez l’écart avec ${rival}`,
      detail: (rival, rivalNamed, company, named) =>
        `${rival} est mentionné dans ${plural(rivalNamed, 'réponse', 'réponses')}, ${company} dans ${named}.`,
      week: (rival) =>
        `Ouvrez la page de ${rival} sur une question qu’il remporte, et listez ce qu’elle dit et que la vôtre ne dit pas.`,
    },
    weakest: {
      title: (engine) => `Regardez ce que ${engine} dit de votre marché`,
      detail: (named, answers, engines) =>
        `Il vous mentionne dans ${of(named, answers)}, le moins souvent parmi ${engines}.`,
      week: (engine) =>
        `Posez vous-même trois questions de ce rapport à ${engine}, et notez les sites qu’il cite.`,
    },
    keep: {
      title: (company) => `Gardez ${company} à sa place`,
      detail: (named, answers) =>
        `L’IA vous mentionne dans ${of(named, answers)}, de façon égale dans chaque moteur.`,
      week: 'Suivez chaque jour les questions de ce rapport\u00a0: les réponses changent au fil des mises à jour des moteurs.',
    },
  },

  // ─── Page 2 ────────────────────────────────────────────────────────────────
  questions: {
    eyebrow: 'Ce que nous avons demandé',
    title: (n) => `Les ${n} questions, et la réponse de chaque moteur`,
    subtitle: (domain, country, language, products) =>
      products
        ? `Rédigées à partir des principaux produits de ${domain}, retenues selon leur proximité avec ce que vous vendez et leur volume de recherche, et posées en ${language} (pays\u00a0: ${country}).`
        : `Posées en ${language} (pays\u00a0: ${country}).`,
    summaryNone: (company, answers, total, engines, engineCount) => {
      const missing = total * engineCount - answers;
      const base =
        missing === 0
          ? `${total} questions × ${plural(engineCount, 'moteur', 'moteurs')}`
          : missing > 0
            ? noAnswer(missing)
            : null;
      return `Aucune réponse aux ${total} questions ne mentionne ${company}\u00a0: ${plural(answers, 'réponse', 'réponses')} de ${engines}${base ? ` (${base})` : ''}.`;
    },
    summary: (named, answers, questions, total, engines) =>
      `Vous êtes mentionné dans ${questions} questions sur ${total}\u00a0: dans ${named} des ${answers} réponses de ${engines}.`,
    legendNamed: 'Vous mentionne',
    legendMissed: 'Réponse sans vous',
    legendNone: 'Pas de réponse',
    colQuestion: 'Question',
    colSearches: 'Rech./mois',
    colInstead: 'Nommé à la place',
    ranges: ['10–100', '100–1K', '1K–10K', '10K–100K', '100K+'],
    low: 'Faible',
    searchesNote: (low) =>
      `Rech./mois\u00a0: recherches Google mensuelles du mot-clé de la question dans votre pays, en fourchette Google. ${low ? 'Faible\u00a0: trop peu de recherches pour que Google les chiffre. Les' : 'Les'} questions posées à l’IA sont plus longues que les recherches Google\u00a0: le volume d’un mot-clé les sous-estime.`,
    groupCount: (n) => plural(n, 'question', 'questions'),
    related: 'un besoin que vos clients ont aussi',
    growthKey: 'Colonnes claires\u00a0: moteurs Google, dans Growth',
  },

  // ─── Page 3 ────────────────────────────────────────────────────────────────
  plan: {
    eyebrow: 'Votre plan',
    title: 'Trois constats, et ce que vous feriez la première semaine',
    subtitle: (company) =>
      `Choisis dans les résultats de ${company} selon des règles fixes\u00a0: ce que le rapport a trouvé, la première chose à faire et où Ansvisor vous aide.`,
    finding: 'Constat',
    weekOne: 'Semaine 1',
    inAnsvisor: 'Dans Ansvisor',
    feature: {
      contentEditor: 'Content Editor',
      citations: 'Citations',
      siteAudit: 'Site Audit',
      competitors: 'Competitors',
      brandVisibility: 'Visibility',
    },
    targetsTitle: 'Où l’IA regarde\u00a0: les sites où vous pouvez figurer',
    targetsSub:
      'Les sites que l’IA cite dans vos réponses, classés selon ce que vous pouvez y faire.',
    targetKind: {
      guide: 'Guides et comparatifs',
      publication: 'Médias',
      official: 'Sources officielles',
      community: 'Communautés',
      reviews: 'Avis',
      other: 'Sites cités par l’IA',
    },
    targetsNone: 'Aucun cité',
    targetsLeftOut: (names) =>
      `Écartés\u00a0: ${names}. Le site d’un concurrent ou une marketplace n’est pas un endroit où figurer.`,
    howTitle: 'Comment le travail se fait',
    approveTitle: 'Vous approuvez chaque étape',
    approveBody:
      'Les agents démarrent en mode «\u00a0Ask me first\u00a0» ou «\u00a0Auto, ask before changes\u00a0»\u00a0: une exécution qui changerait quelque chose affiche «\u00a0Needs you\u00a0» et attend votre clic. Rien ne s’active seul, et chaque changement est dans l’Activity log, avec Undo. Dans tous les plans.',
    autoTitle: 'Ou laissez les agents publier seuls',
    autoBody:
      'En Full auto, avec deux réglages qu’un Admin active, les agents choisis envoient ou publient des pages dans votre CMS sans clic, de 1 à 20 par jour. Une page qui échoue au contrôle Quality ou à vos informations de marque vous attend toujours. Dans Growth.',
    examplePrompt: 'Un prompt qu’Ansvisor suivrait pour vous, chaque jour\u00a0:',
  },

  // ─── Page 4 ────────────────────────────────────────────────────────────────
  value: {
    eyebrow: 'Ce que ça vaut',
    title: 'Ce que valent les visites de l’IA, et les plans pour ce rapport',
    subtitle:
      'Les visites de l’IA au prix des mêmes clics dans Google Ads, les deux plans côte à côte, et comment Ansvisor vous aide.',
    demand: (searches, country, keywords) =>
      `Les mots-clés de vos questions\u00a0: environ ${searches} recherches Google par mois (${country}\u202f; ${plural(keywords, 'mot-clé', 'mots-clés')} avec volume).`,
    cpcLine: (cpc, keywords, total) =>
      `Leur coût par clic médian dans Google Ads\u00a0: ${cpc} (${keywords} mots-clés sur ${total} en avaient un).`,
    colShare: 'Si l’IA vous envoyait',
    colVisits: 'Visites IA par mois',
    colAds: 'Mêmes clics dans Ads, par mois',
    colYear: 'Par an',
    share: (pct) => `${pc(pct)} de ces recherches`,
    buying: 'Les acheter',
    buyingBody: (visits, ads, year) =>
      `${visits} visites par mois coûtent environ ${ads} dans Google Ads, chaque mois\u00a0: ${year} par an.`,
    earning: 'Les gagner',
    earningBody: (plan, price) =>
      `Ansvisor ${plan}\u00a0: ${price} par mois. Une page citée par l’IA envoie des visites tant qu’elle reste citée.`,
    cheap: (ads, plan, price) =>
      `Les clics sont bon marché sur votre marché\u00a0: ces visites coûteraient environ ${ads} par mois dans Ads, moins que ${plan} à ${price}. Ce que la publicité ne peut pas acheter, c’est d’être la marque que l’IA recommande quand vos clients posent la question.`,
    slow: 'Les visites de l’IA se construisent sur plusieurs mois\u00a0: le premier mois, c’est la mise en place et les premières pages, pas encore des visites.',
    noAds: (country) =>
      `Pas assez de données publicitaires pour vos questions (pays\u00a0: ${country})\u00a0: aucune visite n’est chiffrée dans ce rapport.`,
    oddAds: (cpc, keywords) =>
      `Les prix publicitaires trouvés pour vos mots-clés semblent erronés (médiane de ${cpc} sur ${plural(keywords, 'mot-clé', 'mots-clés')})\u00a0: aucune visite n’est chiffrée dans ce rapport.`,
    tableNote:
      'Des scénarios, pas une prévision\u00a0: ce que ces visites coûteraient en publicité si les réponses de l’IA vous les envoyaient.',
    revenueTitle: 'Un scénario de revenus',
    revenue: (kind, value, low, high) =>
      `${kind === 'order' ? 'Votre panier moyen' : 'Votre valeur moyenne par contrat'}\u00a0: ${value}. Hypothèse\u00a0: ${low} à ${high} des visites de l’IA ${kind === 'order' ? 'passent commande' : 'deviennent un contrat'}, pas mieux que les autres visites.`,
    revenueRow: (visits, low, high) =>
      `${visits} visites IA par mois\u00a0: ${low}–${high} par mois`,
    scenarios:
      'Des scénarios, pas une prévision ni une garantie. AI Traffic, dans Ansvisor, mesure vos vraies visites de l’IA une fois configuré.',
    planTitle: 'Les plans pour ce rapport',
    planName: (plan) => `Ansvisor ${plan}`,
    starterTag: 'Correspond à ce rapport',
    growthTag: 'Ajoute les moteurs Google',
    perMonth: (price) => `${price}/mois`,
    yearly: (price) => `ou ${price}/an (annuel, −${pc(20)})`,
    starterMatch: (engines, headed) =>
      headed
        ? `Suit ${engines} chaque jour\u00a0: les moteurs que compte la visibilité de ce rapport.`
        : `Suit ${engines} chaque jour.`,
    growthAdds: (engines, banded) =>
      banded
        ? `Suit aussi ${engines} chaque jour\u00a0: le bandeau Growth de la page 1.`
        : `Suit aussi ${engines} chaque jour.`,
    googleEngines: 'Google AI Overviews et Google AI Mode',
    planLimits: (prompts, brands) =>
      `${prompts} prompts suivis chaque jour, ${plural(brands, 'marque', 'marques')}.`,
    aiIncluded: 'Usage de l’IA inclus.',
    aiMore: (times) =>
      `${times}× l’usage de l’IA\u00a0: plus de contenus, de brouillons, d’exécutions d’agents et de suggestions chaque mois.`,
    siteAudits: (pages) => `Site Audit\u00a0: ${pages} pages par mois.`,
    starterAgents: 'Chat, et Agent Center avec des agents qui demandent avant chaque changement.',
    growthAgents: 'Full auto\u00a0: les agents que vous choisissez publient seuls.',
    mcpRead: 'MCP\u00a0: lisez vos données depuis vos outils d’IA.',
    mcpReadWrite: 'MCP\u00a0: lisez et écrivez vos données depuis vos outils d’IA.',
    workTitle: 'Ansvisor fait le travail avec vous',
    work: [
      {
        title: 'Chat',
        body: 'Répond à partir de vos données Ansvisor, prépare le travail de la première semaine de ce rapport et lit les fichiers que vous ajoutez.',
      },
      {
        title: 'Agent Center',
        body: 'Des agents prêts à l’emploi et plus de 700 skills, qui font le travail courant de visibilité IA, planifié ou à chaque changement.',
      },
      {
        title: 'MCP',
        body: 'Utilisez vos données Ansvisor depuis Claude, ChatGPT, Cursor et d’autres outils d’IA.',
      },
    ],
    ctaTitle: 'Mesurez vos propres questions',
    ctaBody: (prompts, engines, questions) =>
      `Commencez l’essai gratuit\u00a0: Starter suit ${prompts} prompts chaque jour dans ${engines}, de quoi suivre les ${questions} questions de ce rapport et ${Math.max(prompts - questions, 0)} des vôtres.`,
    steps: (domain, questions, country) => [
      `Ajoutez ${domain} comme marque\u00a0: l’assistant de configuration prend en général quelques minutes.`,
      `Suivez les ${questions} questions de ce rapport comme prompts (pays\u00a0: ${country}), et ajoutez les vôtres.`,
      'Ouvrez l’Action Center après la première exécution\u00a0: les prochaines actions, par priorité.',
    ],
    button: 'Commencer votre essai gratuit',
  },
};
