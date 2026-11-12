import type { CardCopy, TargetKind } from './copy';
import { countryIn, languageIn, percentIn } from './copy-names';

/**
 * The report card in Spanish, when the form chooses it (owner decision
 * 2026-11-09), with "tú" and Spain's number formats. A country follows
 * "en" without an article ("en Estados Unidos"), as Spanish allows.
 * Ansvisor's product, feature and button names stay in English, as the
 * app shows them (owner decision 2026-11-08).
 */

const LOCALE = 'es-ES';
const pc = (n: number) => percentIn(LOCALE, n);

/** "A", "A y B", "A, B y C"; "e" before an "i" sound: "A e Iberia". */
export function listEs(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  const last = items[items.length - 1];
  const and = /^h?i(?![aeiouáéíóú])/i.test(last) ? 'e' : 'y';
  return `${items.slice(0, -1).join(', ')} ${and} ${last}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The answers a base falls short of its questions × engines by: the
 * product is printed only when every question was answered.
 */
const noAnswer = (missing: number) =>
  missing === 1 ? 'un motor no respondió a 1 pregunta' : `faltaron ${missing} respuestas`;

interface TargetStep {
  title: (company: string, domain: string) => string;
  detail: (cited: number, answers: number) => string;
  week: (company: string, domain: string) => string;
}

export const es: CardCopy = {
  locale: LOCALE,
  list: listEs,
  countryName: (country) => countryIn('es', country),
  country: (country) => countryIn('es', country),
  language: (english) => languageIn('es', english),
  document: (company) => `Informe de visibilidad en IA: ${company}`,
  footer: (page, pages) => `${page} / ${pages}`,
  brand: 'Generado con Ansvisor · www.ansvisor.com',
  engines: {
    count: (n) => plural(n, 'motor de IA', 'motores de IA'),
    the: (n) => `los ${{ 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco' }[n] ?? n} motores`,
  },

  // ─── Página 1 ──────────────────────────────────────────────────────────────
  status: {
    eyebrow: 'Informe gratuito de visibilidad en IA',
    trial: 'Prueba gratis',
    title: (company) => `¿Qué visibilidad tiene ${company} en las respuestas de la IA?`,
    subtitle: (domain, country, language, date) =>
      `${domain} · ${country}, en ${language} · ${date}`,
    oneTime: (date) =>
      `Una foto puntual: hicimos cada pregunta una vez, el ${date}. Las respuestas de la IA cambian de un día para otro; en Ansvisor, las preguntas se hacen cada día.`,
    understood: (domain, readers) =>
      readers
        ? `Así entendimos ${domain}: una publicación sobre`
        : `Así entendimos ${domain}: vendes`,
    understoodNote: 'Las preguntas de la página 2 tratan de esto.',
    kpiVisibility: 'Visibilidad en IA',
    kpiVisibilitySub: (engines, named, answers, questions, engineCount) => {
      const missing = questions * engineCount - answers;
      if (missing === 0) {
        return `te mencionan en ${named} de ${answers} respuestas: ${questions} preguntas × ${plural(engineCount, 'motor', 'motores')} (${engines})`;
      }
      return `te mencionan en ${named} de ${answers} respuestas de ${engines}${missing > 0 ? ` (${noAnswer(missing)})` : ''}`;
    },
    kpiQuestions: 'Preguntas realizadas',
    kpiQuestionsSub: (engines, answers, unanswered) =>
      `en ${plural(engines, 'motor de IA', 'motores de IA')}: ${plural(answers, 'respuesta', 'respuestas')}${unanswered > 0 ? ` (${unanswered} sin respuesta)` : ''}`,
    kpiLeader: 'Principal competidor',
    kpiLeaderNone: 'Ninguno',
    kpiLeaderSub: (answers, total) => `mencionado en ${answers} de las mismas ${total} respuestas`,
    kpiLeaderNoneSub: 'en estas respuestas',
    kpiCited: 'Tu sitio citado',
    kpiCitedSub: (total) => `de las mismas ${total} respuestas, con una de tus páginas como fuente`,
    startTitle: 'Tu punto de partida',
    startCited: (engines, cited) =>
      `${engines} aún no te mencionan, pero la IA ya lee tu sitio: citó tus páginas en ${plural(cited, 'respuesta', 'respuestas')} sin decir tu nombre. Por ahí conviene empezar.`,
    startNone: (engines) =>
      `${engines} aún no te mencionan. Todas las marcas presentes en las respuestas de la IA empezaron aquí: los pasos de la página 3 son tu primera semana.`,
    firstStep: 'Tu primer paso:',
    byEngine: 'Visibilidad por motor',
    engineValue: (named, answers, pct) => `${named} de ${answers} · ${pc(pct)}`,
    growthBand: (starter) =>
      `En Ansvisor Growth: los motores de IA de Google, también medidos. Starter sigue ${starter}; Growth añade estos.`,
    whoNamed: 'A quién menciona la IA',
    noCompetitor: 'No se mencionó ningún competidor.',
    you: (name) => `${name} (tú)`,
    answersCount: (n) => plural(n, 'respuesta', 'respuestas'),
    sitesCited: 'Sitios que más cita la IA',
    noSites: 'No se citó ningún sitio.',
    siteTag: { own: ' (tú)', competitor: ' (competidor)', marketplace: ' (marketplace)' },
    alsoMarketplaces: (names) => `Marketplaces también mencionados: ${names}`,
    alsoOthers: (names) => `Otras empresas mencionadas: ${names}`,
    missedTitle: 'Dónde la IA menciona a otros, no a ti',
    missedSub: (missed, total) =>
      `${missed} de ${total} preguntas no obtuvieron ninguna respuesta que te mencione. Las cinco que más ganan tus competidores:`,
    missedInstead: (names) => `Mencionados en tu lugar: ${names}`,
    missedNone: 'Ninguna respuesta mencionó a otra marca.',
    measured: (questions, readers, engines, country, date) =>
      `Cómo medimos: ${questions} preguntas que podría hacer un ${readers ? 'lector' : 'cliente'}, hechas una vez cada una en ${engines}, en ${country}, el ${date}. La visibilidad es la parte de las respuestas que te mencionan, por tu nombre o tu sitio; competidores y sitios se cuentan sobre las mismas respuestas. Todas las preguntas están en la página 2.`,
  },

  // ─── Los hallazgos (páginas 1 y 3) ─────────────────────────────────────────
  wins: {
    question: {
      title: (question) => `Responde a «${question}» en tu sitio`,
      detailNames: (names, company) =>
        `Para esta pregunta, la IA menciona a ${names}, y no a ${company}.`,
      detailNone: (company) => `Ninguna respuesta a esta pregunta menciona a ${company}.`,
      week: (page) =>
        page
          ? `Escribe una página que la responda directamente, con la pregunta como título y la respuesta en el primer párrafo, y enlázala desde ${page}.`
          : 'Escribe una página que la responda directamente, con la pregunta como título y la respuesta en el primer párrafo.',
    },
    target: {
      guide: {
        title: (company, domain) => `Consigue que ${domain} incluya o reseñe a ${company}`,
        detail: (cited, answers) =>
          `Una guía que la IA cita en ${cited} de ${answers} respuestas sobre tu mercado. Aparecer o tener una reseña allí le da una fuente que te menciona.`,
        week: (company, domain) =>
          `Busca la página de ${domain} que compara empresas como ${company} y pide que te incluyan o te reseñen.`,
      },
      publication: {
        title: (_company, domain) => `Propón a ${domain} una historia o un comentario experto`,
        detail: (cited, answers) =>
          `Un medio que la IA cita en ${cited} de ${answers} respuestas sobre tu mercado. Un artículo o una cita allí es una fuente en la que confía.`,
        week: (_company, domain) =>
          `Envía a la redacción de ${domain} una propuesta breve: un dato o una historia que solo tenga tu empresa.`,
      },
      official: {
        title: (company, domain) => `Comprueba que ${domain} recoge bien a ${company}`,
        detail: (cited, answers) =>
          `Una fuente oficial que la IA cita en ${cited} de ${answers} respuestas. Tus registros, afiliaciones y licencias allí son datos que repite.`,
        week: (_company, domain) => `Búscate en ${domain} y corrige o completa tu ficha.`,
      },
      community: {
        title: (_company, domain) => `Responde preguntas sobre tu mercado en ${domain}`,
        detail: (cited, answers) =>
          `Una comunidad que la IA cita en ${cited} de ${answers} respuestas. Las respuestas útiles y abiertas de tu equipo son las que se citan.`,
        week: (_company, domain) =>
          `Responde en ${domain} dos preguntas abiertas sobre tu mercado, en nombre de tu equipo y diciéndolo.`,
      },
      reviews: {
        title: (company, domain) =>
          `Revisa y responde lo que dicen los clientes de ${company} en ${domain}`,
        detail: (cited, answers) =>
          `Un sitio de reseñas que la IA cita en ${cited} de ${answers} respuestas. Lo que escriben allí los clientes, y cómo respondes, es lo que lee sobre ti.`,
        week: (_company, domain) =>
          `Responde a las últimas reseñas y quejas en ${domain} y completa tu perfil.`,
      },
      other: {
        title: (company, domain) => `Consigue que ${domain} mencione a ${company}`,
        detail: (cited, answers) =>
          `La IA lo cita en ${cited} de ${answers} respuestas sobre tu mercado. Una mención o una ficha allí te pone a su vista.`,
        week: (_company, domain) => `Averigua cómo aparecen las empresas en ${domain} y pídelo.`,
      },
    } as Record<TargetKind | 'other', TargetStep>,
    ownName: {
      title: 'Di tu nombre donde la IA ya te lee',
      detail: (cited, company) =>
        `La IA citó tus páginas en ${plural(cited, 'respuesta', 'respuestas')} sin nombrar a ${company}.`,
      week: 'En las páginas que cita la IA, di quién eres: tu marca en el título, la primera frase y los subtítulos.',
    },
    ownPages: {
      title: 'Haz que tus páginas sean fáciles de citar',
      detail: (cited, answers) => `Tu sitio aparece citado en ${cited} de ${answers} respuestas.`,
      week: 'Elige las tres páginas que la IA debería citar: la respuesta en el primer párrafo y unas preguntas frecuentes breves con las preguntas de este informe.',
    },
    gap: {
      title: (rival) => `Recorta distancia con ${rival}`,
      detail: (rival, rivalNamed, company, named) =>
        `${rival} aparece en ${plural(rivalNamed, 'respuesta', 'respuestas')}; ${company}, en ${named}.`,
      week: (rival) =>
        `Abre la página de ${rival} para una pregunta que gana, y anota lo que dice y la tuya no.`,
    },
    weakest: {
      title: (engine) => `Mira qué dice ${engine} sobre tu mercado`,
      detail: (named, answers, engines) =>
        `Te menciona en ${named} de ${answers} respuestas, la cifra más baja entre ${engines}.`,
      week: (engine) =>
        `Hazle tú mismo a ${engine} tres preguntas de este informe y anota los sitios que cita.`,
    },
    keep: {
      title: (company) => `Mantén a ${company} donde está`,
      detail: (named, answers) =>
        `La IA te menciona en ${named} de ${answers} respuestas, de forma pareja en todos los motores.`,
      week: 'Sigue cada día las preguntas de este informe: las respuestas cambian cuando se actualizan los motores.',
    },
  },

  // ─── Página 2 ──────────────────────────────────────────────────────────────
  questions: {
    eyebrow: 'Lo que preguntamos',
    title: (n) => `Las ${n} preguntas y lo que respondió cada motor`,
    subtitle: (domain, country, language, products) =>
      products
        ? `Redactadas a partir de los productos principales de ${domain}, elegidas por cuánto se ajustan a lo que vendes y cuánto se buscan, y hechas en ${country}, en ${language}.`
        : `Hechas en ${country}, en ${language}.`,
    summaryNone: (company, answers, total, engines, engineCount) => {
      const missing = total * engineCount - answers;
      const base =
        missing === 0
          ? `${total} preguntas × ${plural(engineCount, 'motor', 'motores')}`
          : missing > 0
            ? noAnswer(missing)
            : null;
      return `${company} no apareció en ninguna de las ${total} preguntas: ${plural(answers, 'respuesta', 'respuestas')} de ${engines}${base ? ` (${base})` : ''}.`;
    },
    summary: (named, answers, questions, total, engines) =>
      `Te mencionan en ${questions} de las ${total} preguntas: en ${named} de las ${answers} respuestas de ${engines}.`,
    legendNamed: 'Te menciona',
    legendMissed: 'Responde sin mencionarte',
    legendNone: 'Sin respuesta',
    colQuestion: 'Pregunta',
    colSearches: 'Búsq./mes',
    colInstead: 'En tu lugar',
    ranges: ['10–100', '100–1K', '1K–10K', '10K–100K', '100K+'],
    low: 'Bajo',
    searchesNote: (low) =>
      `Búsq./mes: búsquedas mensuales en Google de la palabra clave de la pregunta en tu país, en el rango de Google. ${low ? 'Bajo: tan pocas búsquedas que Google no da una cifra. Las' : 'Las'} preguntas que se hacen a la IA son más largas que las búsquedas en Google, así que el volumen de una palabra clave se queda corto.`,
    groupCount: (n) => plural(n, 'pregunta', 'preguntas'),
    related: 'una necesidad que también tienen tus clientes',
    growthKey: 'Columnas claras: motores de Google, en Growth',
  },

  // ─── Página 3 ──────────────────────────────────────────────────────────────
  plan: {
    eyebrow: 'Tu plan',
    title: 'Tres hallazgos y lo que harías la primera semana',
    subtitle: (company) =>
      `Elegidos de los resultados de ${company} con reglas fijas: lo que encontró el informe, lo primero que hacer y dónde ayuda Ansvisor.`,
    finding: 'Hallazgo',
    weekOne: 'Semana 1',
    inAnsvisor: 'En Ansvisor',
    feature: {
      contentEditor: 'Content Editor',
      citations: 'Citations',
      siteAudit: 'Site Audit',
      competitors: 'Competitors',
      brandVisibility: 'Visibility',
    },
    targetsTitle: 'Dónde mira la IA: sitios en los que puedes aparecer',
    targetsSub:
      'Los sitios que la IA cita en tus respuestas, ordenados según lo que puedes hacer en ellos.',
    targetKind: {
      guide: 'Guías y comparativas',
      publication: 'Medios',
      official: 'Fuentes oficiales',
      community: 'Comunidades',
      reviews: 'Reseñas',
      other: 'Sitios que cita la IA',
    },
    targetsNone: 'Ninguno citado',
    targetsLeftOut: (names) =>
      `Descartados: ${names}. El sitio de un competidor o un marketplace no es un lugar donde aparecer.`,
    howTitle: 'Cómo se hace el trabajo',
    approveTitle: 'Tú apruebas cada paso',
    approveBody:
      'Los agentes empiezan en «Ask me first» o «Auto, ask before changes»: una ejecución que cambiaría algo muestra «Needs you» y espera tu clic. Nada se activa solo, y cada cambio queda en el Activity log, con Undo. En todos los planes.',
    autoTitle: 'O deja que los agentes publiquen solos',
    autoBody:
      'En Full auto, con dos ajustes que activa un Admin, los agentes que elijas envían o publican páginas en tu CMS sin un clic, de 1 a 20 al día. Una página que no supera Quality o los datos de tu marca sigue esperándote. En Growth.',
    examplePrompt: 'Un prompt que Ansvisor seguiría por ti, cada día:',
  },

  // ─── Página 4 ──────────────────────────────────────────────────────────────
  value: {
    eyebrow: 'Lo que vale',
    title: 'Lo que valen las visitas desde la IA, y los planes para este informe',
    subtitle:
      'Las visitas desde la IA al precio de los mismos clics en Google Ads, los dos planes lado a lado, y cómo ayuda Ansvisor.',
    demand: (searches, country, keywords) =>
      `Las palabras clave de tus preguntas suman unas ${searches} búsquedas al mes en Google en ${country} (${keywords} con volumen).`,
    cpcLine: (cpc, keywords, total) =>
      `Su coste por clic mediano en Google Ads: ${cpc} (${keywords} de ${total} palabras clave tenían uno).`,
    colShare: 'Si la IA te enviara',
    colVisits: 'Visitas desde IA al mes',
    colAds: 'Mismos clics en Ads, al mes',
    colYear: 'Al año',
    share: (pct) => `el ${pc(pct)} de esas búsquedas`,
    buying: 'Comprarlas',
    buyingBody: (visits, ads, year) =>
      `${visits} visitas al mes cuestan unos ${ads} en Google Ads, cada mes: ${year} al año.`,
    earning: 'Ganarlas',
    earningBody: (plan, price) =>
      `Ansvisor ${plan} cuesta ${price} al mes. Una página que cita la IA sigue enviando visitas mientras la siga citando.`,
    cheap: (ads, plan, price) =>
      `Los clics son baratos en tu mercado: estas visitas costarían unos ${ads} al mes en Ads, menos que ${plan} a ${price}. Lo que la publicidad no puede comprar es ser la marca que recomienda la IA cuando tus clientes preguntan.`,
    slow: 'Las visitas desde la IA crecen a lo largo de meses: el primer mes es configuración y primeras páginas, todavía no visitas.',
    noAds: (country) =>
      `No hay suficientes datos de anuncios para tus preguntas en ${country}: este informe no valora ninguna visita.`,
    oddAds: (cpc, keywords) =>
      `Los precios de anuncios encontrados para tus palabras clave parecen erróneos (una mediana de ${cpc} de ${plural(keywords, 'palabra clave', 'palabras clave')}): este informe no valora ninguna visita.`,
    tableNote:
      'Escenarios, no una previsión: lo que costarían estas visitas en anuncios si las respuestas de la IA te las enviaran.',
    revenueTitle: 'Un escenario de ingresos',
    revenue: (kind, value, low, high) =>
      `Tu valor medio por ${kind === 'order' ? 'pedido' : 'contrato'}: ${value}. Supuesto: del ${low} al ${high} de las visitas desde la IA ${kind === 'order' ? 'hacen un pedido' : 'se convierten en un contrato'}, no más que otras visitas.`,
    revenueRow: (visits, low, high) => `${visits} visitas desde IA al mes: ${low}–${high} al mes`,
    scenarios:
      'Escenarios, no una previsión ni una garantía. AI Traffic en Ansvisor mide tus visitas reales desde la IA una vez configurado.',
    planTitle: 'Los planes para este informe',
    planName: (plan) => `Ansvisor ${plan}`,
    starterTag: 'Encaja con este informe',
    growthTag: 'Añade los motores de Google',
    perMonth: (price) => `${price}/mes`,
    yearly: (price) => `o ${price}/año (anual, −${pc(20)})`,
    starterMatch: (engines, headed) =>
      headed
        ? `Sigue ${engines} cada día: los motores con los que se calcula la visibilidad de este informe.`
        : `Sigue ${engines} cada día.`,
    growthAdds: (engines, banded) =>
      banded
        ? `Sigue también ${engines} cada día: la franja Growth de la página 1.`
        : `Sigue también ${engines} cada día.`,
    googleEngines: 'Google AI Overviews y Google AI Mode',
    planLimits: (prompts, brands) =>
      `${prompts} prompts seguidos cada día, ${plural(brands, 'marca', 'marcas')}.`,
    aiIncluded: 'Uso de IA incluido.',
    aiMore: (times) =>
      `${times}× el uso de IA: más oportunidades de contenido, borradores, ejecuciones de agentes y sugerencias cada mes.`,
    siteAudits: (pages) => `Site Audit: ${pages} páginas al mes.`,
    starterAgents: 'Chat, y Agents con agentes que preguntan antes de cada cambio.',
    growthAgents: 'Full auto: los agentes que elijas publican solos.',
    mcpRead: 'MCP: lee tus datos desde herramientas de IA.',
    mcpReadWrite: 'MCP: lee y escribe tus datos desde herramientas de IA.',
    workTitle: 'Ansvisor hace el trabajo contigo',
    work: [
      {
        title: 'Chat',
        body: 'Responde con tus propios datos de Ansvisor, prepara el trabajo de la primera semana de este informe y lee los archivos que añades.',
      },
      {
        title: 'Agents',
        body: 'Agentes listos para usar y más de 700 skills: hacen el trabajo rutinario de visibilidad en IA según un calendario o cuando algo cambia.',
      },
      {
        title: 'MCP',
        body: 'Usa tus datos de Ansvisor desde Claude, ChatGPT, Cursor y otras herramientas de IA.',
      },
    ],
    ctaTitle: 'Mide tus propias preguntas',
    ctaBody: (prompts, engines, questions) =>
      `Empieza la prueba gratis: Starter sigue ${prompts} prompts cada día en ${engines}, así que caben las ${questions} preguntas de este informe y ${Math.max(prompts - questions, 0)} tuyas.`,
    steps: (domain, questions, country) => [
      `Añade ${domain} como marca: el asistente de configuración suele tardar unos minutos.`,
      `Sigue las ${questions} preguntas de este informe como prompts en ${country}, y añade las tuyas.`,
      'Abre el Action Center tras la primera ejecución: lo siguiente que hacer, por prioridad.',
    ],
    button: 'Empieza tu prueba gratis',
  },
};
