import type { CardCopy, TargetKind } from './copy';
import { countryIn, languageIn, percentIn } from './copy-names';

/**
 * The report card in Portuguese, when the form chooses it (owner decision
 * 2026-11-09), as Brazil writes it, with "você". A country never follows a
 * preposition that must agree with it ("no Brasil", "nos Estados Unidos"):
 * it stands after "país:". Ansvisor's product, feature and button names
 * stay in English, as the app shows them (owner decision 2026-11-08).
 */

const LOCALE = 'pt-BR';
const pc = (n: number) => percentIn(LOCALE, n);

/** "A", "A e B", "A, B e C". */
export function listPt(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The answers a base falls short of its questions × engines by: the
 * product is printed only when every question was answered.
 */
const noAnswer = (missing: number) =>
  missing === 1 ? 'um motor não respondeu a 1 pergunta' : `faltaram ${missing} respostas`;

interface TargetStep {
  title: (company: string, domain: string) => string;
  detail: (cited: number, answers: number) => string;
  week: (company: string, domain: string) => string;
}

export const pt: CardCopy = {
  locale: LOCALE,
  list: listPt,
  countryName: (country) => countryIn('pt', country),
  country: (country) => countryIn('pt', country),
  language: (english) => languageIn('pt', english),
  document: (company) => `Relatório de visibilidade em IA: ${company}`,
  footer: (page, pages) => `${page} / ${pages}`,
  brand: 'Gerado com Ansvisor · www.ansvisor.com',
  engines: {
    count: (n) => plural(n, 'motor de IA', 'motores de IA'),
    the: (n) => `os ${{ 2: 'dois', 3: 'três', 4: 'quatro', 5: 'cinco' }[n] ?? n} motores`,
  },

  // ─── Página 1 ──────────────────────────────────────────────────────────────
  status: {
    eyebrow: 'Relatório gratuito de visibilidade em IA',
    trial: 'Teste grátis',
    title: (company) => `Qual é a visibilidade de ${company} nas respostas da IA?`,
    subtitle: (domain, country, language, date) =>
      `${domain} · ${country}, em ${language} · ${date}`,
    oneTime: (date) =>
      `Um retrato do momento: fizemos cada pergunta uma vez, em ${date}. As respostas da IA mudam de um dia para o outro; no Ansvisor, as perguntas são feitas todos os dias.`,
    understood: (domain, readers) =>
      readers
        ? `Como entendemos ${domain}: uma publicação sobre`
        : `Como entendemos ${domain}: você vende`,
    understoodNote: 'As perguntas da página 2 são sobre estes temas.',
    kpiVisibility: 'Visibilidade em IA',
    kpiVisibilitySub: (engines, named, answers, questions, engineCount) => {
      const missing = questions * engineCount - answers;
      if (missing === 0) {
        return `você aparece em ${named} de ${answers} respostas: ${questions} perguntas × ${plural(engineCount, 'motor', 'motores')} (${engines})`;
      }
      return `você aparece em ${named} de ${answers} respostas de ${engines}${missing > 0 ? ` (${noAnswer(missing)})` : ''}`;
    },
    kpiQuestions: 'Perguntas feitas',
    kpiQuestionsSub: (engines, answers, unanswered) =>
      `em ${plural(engines, 'motor de IA', 'motores de IA')}: ${plural(answers, 'resposta', 'respostas')}${unanswered > 0 ? ` (${unanswered} sem resposta)` : ''}`,
    kpiLeader: 'Principal concorrente',
    kpiLeaderNone: 'Nenhum',
    kpiLeaderSub: (answers, total) => `mencionado em ${answers} das mesmas ${total} respostas`,
    kpiLeaderNoneSub: 'nestas respostas',
    kpiCited: 'Seu site citado',
    kpiCitedSub: (total) => `das mesmas ${total} respostas, com uma página sua como fonte`,
    startTitle: 'Seu ponto de partida',
    startCited: (engines, cited) =>
      `${engines} ainda não mencionam você, mas a IA já lê seu site: citou suas páginas em ${plural(cited, 'resposta', 'respostas')} sem dizer seu nome. É por aí que se começa.`,
    startNone: (engines) =>
      `${engines} ainda não mencionam você. Toda marca presente nas respostas da IA começou daqui: os passos da página 3 são sua primeira semana.`,
    firstStep: 'Seu primeiro passo:',
    byEngine: 'Visibilidade por motor',
    engineValue: (named, answers, pct) => `${named} de ${answers} · ${pc(pct)}`,
    growthBand: (starter) =>
      `No Ansvisor Growth: os motores de IA do Google, também medidos. O Starter acompanha ${starter}; o Growth acrescenta estes.`,
    whoNamed: 'Quem a IA menciona',
    noCompetitor: 'Nenhum concorrente foi mencionado.',
    you: (name) => `${name} (você)`,
    answersCount: (n) => plural(n, 'resposta', 'respostas'),
    sitesCited: 'Sites mais citados pela IA',
    noSites: 'Nenhum site foi citado.',
    siteTag: { own: ' (você)', competitor: ' (concorrente)', marketplace: ' (marketplace)' },
    alsoMarketplaces: (names) => `Marketplaces também mencionados: ${names}`,
    alsoOthers: (names) => `Outras empresas mencionadas: ${names}`,
    missedTitle: 'Onde a IA menciona outros, não você',
    missedSub: (missed, total) =>
      `${missed} de ${total} perguntas não tiveram nenhuma resposta que mencione você. As cinco que seus concorrentes mais ganham:`,
    missedInstead: (names) => `Mencionados no seu lugar: ${names}`,
    missedNone: 'Nenhuma resposta mencionou outra marca.',
    measured: (questions, readers, engines, country, date) =>
      `Como medimos: ${questions} perguntas que um ${readers ? 'leitor' : 'cliente'} poderia fazer, feitas uma vez cada nos motores ${engines} (país: ${country}), em ${date}. A visibilidade é a parcela das respostas que mencionam você, pelo nome ou pelo site; concorrentes e sites são contados sobre as mesmas respostas. Todas as perguntas estão na página 2.`,
  },

  // ─── As descobertas (páginas 1 e 3) ────────────────────────────────────────
  wins: {
    question: {
      title: (question) => `Responda a “${question}” no seu site`,
      detailNames: (names, company) => `Para ela, a IA menciona ${names}, e não ${company}.`,
      detailNone: (company) => `Nenhuma resposta a ela menciona ${company}.`,
      week: (page) =>
        page
          ? `Escreva uma página que a responda diretamente, com a pergunta como título e a resposta no primeiro parágrafo, e coloque um link para ela em ${page}.`
          : 'Escreva uma página que a responda diretamente, com a pergunta como título e a resposta no primeiro parágrafo.',
    },
    target: {
      guide: {
        title: (company, domain) => `Consiga que ${domain} liste ou avalie ${company}`,
        detail: (cited, answers) =>
          `Um guia que a IA cita em ${cited} de ${answers} respostas sobre o seu mercado. Uma listagem ou avaliação ali dá a ela uma fonte que menciona você.`,
        week: (company, domain) =>
          `Encontre a página de ${domain} que compara empresas como ${company} e peça para ser incluído ou avaliado.`,
      },
      publication: {
        title: (_company, domain) =>
          `Proponha a ${domain} uma pauta ou um comentário de especialista`,
        detail: (cited, answers) =>
          `Uma publicação que a IA cita em ${cited} de ${answers} respostas sobre o seu mercado. Uma matéria ou citação ali é uma fonte em que ela confia.`,
        week: (_company, domain) =>
          `Envie à redação de ${domain} uma sugestão curta: um dado ou uma história que só a sua empresa tem.`,
      },
      official: {
        title: (company, domain) => `Confira se ${domain} apresenta ${company} corretamente`,
        detail: (cited, answers) =>
          `Uma fonte oficial que a IA cita em ${cited} de ${answers} respostas. Seus registros, associações e licenças ali são fatos que ela repete.`,
        week: (_company, domain) =>
          `Procure sua empresa em ${domain} e corrija ou complete seu cadastro.`,
      },
      community: {
        title: (_company, domain) => `Responda a perguntas sobre o seu mercado em ${domain}`,
        detail: (cited, answers) =>
          `Uma comunidade que a IA cita em ${cited} de ${answers} respostas. Respostas úteis e transparentes da sua equipe são as que ela cita.`,
        week: (_company, domain) =>
          `Responda em ${domain} a duas perguntas abertas sobre o seu mercado, em nome da sua equipe e deixando isso claro.`,
      },
      reviews: {
        title: (company, domain) =>
          `Leia e responda o que os clientes dizem sobre ${company} em ${domain}`,
        detail: (cited, answers) =>
          `Um site de avaliações que a IA cita em ${cited} de ${answers} respostas. O que os clientes escrevem ali, e como você responde, é o que ela lê sobre você.`,
        week: (_company, domain) =>
          `Responda às avaliações e reclamações mais recentes em ${domain} e complete seu perfil.`,
      },
      other: {
        title: (company, domain) => `Consiga uma menção a ${company} em ${domain}`,
        detail: (cited, answers) =>
          `A IA cita esse site em ${cited} de ${answers} respostas sobre o seu mercado. Uma menção ou listagem ali coloca você diante dela.`,
        week: (_company, domain) =>
          `Descubra como as empresas são mencionadas em ${domain} e faça o pedido.`,
      },
    } as Record<TargetKind | 'other', TargetStep>,
    ownName: {
      title: 'Diga seu nome onde a IA já lê você',
      detail: (cited, company) =>
        `A IA citou suas páginas em ${plural(cited, 'resposta', 'respostas')} sem mencionar ${company}.`,
      week: 'Nas páginas que a IA cita, diga quem você é: sua marca no título, na primeira frase e nos subtítulos.',
    },
    ownPages: {
      title: 'Torne suas páginas fáceis de citar',
      detail: (cited, answers) => `Seu site é citado em ${cited} de ${answers} respostas.`,
      week: 'Escolha as três páginas que a IA deveria citar: a resposta no primeiro parágrafo e um FAQ curto com as perguntas deste relatório.',
    },
    gap: {
      title: (rival) => `Diminua a distância para ${rival}`,
      detail: (rival, rivalNamed, company, named) =>
        `${rival} aparece em ${plural(rivalNamed, 'resposta', 'respostas')}; ${company}, em ${named}.`,
      week: (rival) =>
        `Abra a página de ${rival} sobre uma pergunta em que ${rival} vence, e anote o que ela diz e a sua não.`,
    },
    weakest: {
      title: (engine) => `Veja o que ${engine} diz sobre o seu mercado`,
      detail: (named, answers, engines) =>
        `Ele menciona você em ${named} de ${answers} respostas, o menor número entre ${engines}.`,
      week: (engine) =>
        `Faça você mesmo três perguntas deste relatório no ${engine} e anote os sites que ele cita.`,
    },
    keep: {
      title: (company) => `Mantenha ${company} onde está`,
      detail: (named, answers) =>
        `A IA menciona você em ${named} de ${answers} respostas, de forma parecida em todos os motores.`,
      week: 'Acompanhe as perguntas deste relatório todos os dias: as respostas mudam conforme os motores são atualizados.',
    },
  },

  // ─── Página 2 ──────────────────────────────────────────────────────────────
  questions: {
    eyebrow: 'O que perguntamos',
    title: (n) => `As ${n} perguntas e o que cada motor respondeu`,
    subtitle: (domain, country, language, products) =>
      products
        ? `Escritas a partir dos principais produtos de ${domain}, escolhidas por quanto combinam com o que você vende e quanto são buscadas, e feitas em ${language} (país: ${country}).`
        : `Feitas em ${language} (país: ${country}).`,
    summaryNone: (company, answers, total, engines, engineCount) => {
      const missing = total * engineCount - answers;
      const base =
        missing === 0
          ? `${total} perguntas × ${plural(engineCount, 'motor', 'motores')}`
          : missing > 0
            ? noAnswer(missing)
            : null;
      return `${company} não apareceu em nenhuma das ${total} perguntas: ${plural(answers, 'resposta', 'respostas')} de ${engines}${base ? ` (${base})` : ''}.`;
    },
    summary: (named, answers, questions, total, engines) =>
      `Você aparece em ${questions} das ${total} perguntas: em ${named} das ${answers} respostas de ${engines}.`,
    legendNamed: 'Menciona você',
    legendMissed: 'Respondeu sem citar você',
    legendNone: 'Sem resposta',
    colQuestion: 'Pergunta',
    colSearches: 'Buscas/mês',
    colInstead: 'No seu lugar',
    ranges: ['10–100', '100–1K', '1K–10K', '10K–100K', '100K+'],
    low: 'Baixo',
    searchesNote: (low) =>
      `Buscas/mês: buscas mensais no Google pela palavra-chave da pergunta no seu país, na faixa do Google. ${low ? 'Baixo: tão poucas buscas que o Google não informa um número. As' : 'As'} perguntas feitas à IA são mais longas que as buscas no Google, por isso o volume de uma palavra-chave as subestima.`,
    groupCount: (n) => plural(n, 'pergunta', 'perguntas'),
    related: 'uma necessidade que seus clientes também têm',
    growthKey: 'Colunas claras: motores do Google, no Growth',
  },

  // ─── Página 3 ──────────────────────────────────────────────────────────────
  plan: {
    eyebrow: 'Seu plano',
    title: 'Três descobertas e o que você faria na primeira semana',
    subtitle: (company) =>
      `Escolhidas nos resultados de ${company} por regras fixas: o que o relatório encontrou, a primeira coisa a fazer e onde o Ansvisor ajuda.`,
    finding: 'Descoberta',
    weekOne: 'Semana 1',
    inAnsvisor: 'No Ansvisor',
    feature: {
      contentEditor: 'Content Editor',
      citations: 'Citations',
      siteAudit: 'Site Audit',
      competitors: 'Competitors',
      brandVisibility: 'Visibility',
    },
    targetsTitle: 'Onde a IA olha: sites em que você pode aparecer',
    targetsSub:
      'Os sites que a IA cita nas suas respostas, organizados pelo que você pode fazer neles.',
    targetKind: {
      guide: 'Guias e comparativos',
      publication: 'Publicações',
      official: 'Fontes oficiais',
      community: 'Comunidades',
      reviews: 'Avaliações',
      other: 'Sites citados pela IA',
    },
    targetsNone: 'Nenhum citado',
    targetsLeftOut: (names) =>
      `Deixados de fora: ${names}. O site de um concorrente ou um marketplace não é lugar para aparecer.`,
    howTitle: 'Como o trabalho é feito',
    approveTitle: 'Você aprova cada passo',
    approveBody:
      'Os agentes começam em “Ask me first” ou “Auto, ask before changes”: uma execução que mudaria algo mostra “Needs you” e espera o seu clique. Nada é ativado sozinho, e cada mudança fica no Activity log, com Undo. Em todos os planos.',
    autoTitle: 'Ou deixe os agentes publicarem sozinhos',
    autoBody:
      'No Full auto, com duas chaves que um Admin ativa, os agentes escolhidos enviam ou publicam páginas no seu CMS sem um clique, de 1 a 20 por dia. Uma página reprovada no Quality ou nos dados da sua marca continua esperando por você. No Growth.',
    examplePrompt: 'Um prompt que o Ansvisor acompanharia para você, todos os dias:',
  },

  // ─── Página 4 ──────────────────────────────────────────────────────────────
  value: {
    eyebrow: 'Quanto vale',
    title: 'Quanto valem as visitas da IA, e os planos para este relatório',
    subtitle:
      'As visitas da IA ao preço dos mesmos cliques no Google Ads, os dois planos lado a lado, e como o Ansvisor ajuda.',
    demand: (searches, country, keywords) =>
      `As palavras-chave das suas perguntas têm cerca de ${searches} buscas no Google por mês (${country}; ${keywords} com volume).`,
    cpcLine: (cpc, keywords, total) =>
      `O custo por clique mediano delas no Google Ads: ${cpc} (${keywords} de ${total} palavras-chave tinham um).`,
    colShare: 'Se a IA enviasse a você',
    colVisits: 'Visitas da IA por mês',
    colAds: 'Mesmos cliques no Ads, por mês',
    colYear: 'Por ano',
    share: (pct) => `${pc(pct)} dessas buscas`,
    buying: 'Comprar',
    buyingBody: (visits, ads, year) =>
      `${visits} visitas por mês custam cerca de ${ads} no Google Ads, todo mês: ${year} por ano.`,
    earning: 'Conquistar',
    earningBody: (plan, price) =>
      `O Ansvisor ${plan} custa ${price} por mês. Páginas citadas pela IA trazem visitas enquanto continuarem citadas.`,
    cheap: (ads, plan, price) =>
      `Os cliques são baratos no seu mercado: essas visitas custariam cerca de ${ads} por mês no Ads, menos que o ${plan} a ${price}. O que a publicidade não compra é ser a marca que a IA recomenda quando seus clientes perguntam.`,
    slow: 'As visitas da IA crescem ao longo de meses: o primeiro mês é de configuração e primeiras páginas, ainda não de visitas.',
    noAds: (country) =>
      `Não há dados de anúncios suficientes para suas perguntas (país: ${country}): nenhuma visita é valorada neste relatório.`,
    oddAds: (cpc, keywords) =>
      `Os preços de anúncios encontrados para suas palavras-chave parecem errados (mediana de ${cpc} em ${plural(keywords, 'palavra-chave', 'palavras-chave')}): nenhuma visita é valorada neste relatório.`,
    tableNote:
      'Cenários, não uma previsão: quanto essas visitas custariam em anúncios se as respostas da IA as enviassem a você.',
    revenueTitle: 'Um cenário de receita',
    revenue: (kind, value, low, high) =>
      `Seu valor médio por ${kind === 'order' ? 'pedido' : 'contrato'}: ${value}. Premissa: de ${low} a ${high} das visitas da IA ${kind === 'order' ? 'fazem um pedido' : 'viram um contrato'}, não mais do que outras visitas.`,
    revenueRow: (visits, low, high) => `${visits} visitas da IA por mês: ${low}–${high} por mês`,
    scenarios:
      'Cenários, não uma previsão nem uma garantia. O AI Traffic no Ansvisor mede suas visitas reais da IA depois de configurado.',
    planTitle: 'Os planos para este relatório',
    planName: (plan) => `Ansvisor ${plan}`,
    starterTag: 'Combina com este relatório',
    growthTag: 'Com os motores do Google',
    perMonth: (price) => `${price}/mês`,
    yearly: (price) => `ou ${price}/ano (anual, −${pc(20)})`,
    starterMatch: (engines, headed) =>
      headed
        ? `Acompanha ${engines} todos os dias: os motores que a visibilidade deste relatório conta.`
        : `Acompanha ${engines} todos os dias.`,
    growthAdds: (engines, banded) =>
      banded
        ? `Acompanha também ${engines} todos os dias: a faixa Growth da página 1.`
        : `Acompanha também ${engines} todos os dias.`,
    googleEngines: 'Google AI Overviews e Google AI Mode',
    planLimits: (prompts, brands) =>
      `${prompts} prompts acompanhados todos os dias, ${plural(brands, 'marca', 'marcas')}.`,
    aiIncluded: 'Uso de IA incluído.',
    aiMore: (times) =>
      `${times}× o uso de IA: mais oportunidades de conteúdo, rascunhos, execuções de agentes e sugestões todo mês.`,
    siteAudits: (pages) => `Site Audit: ${pages} páginas por mês.`,
    starterAgents: 'Chat e Agent Center com agentes que perguntam antes de cada mudança.',
    growthAgents: 'Full auto: os agentes que você escolher publicam sozinhos.',
    mcpRead: 'MCP: leia seus dados pelas ferramentas de IA.',
    mcpReadWrite: 'MCP: leia e grave seus dados pelas ferramentas de IA.',
    workTitle: 'O Ansvisor faz o trabalho com você',
    work: [
      {
        title: 'Chat',
        body: 'Responde com seus dados do Ansvisor, prepara o trabalho da primeira semana deste relatório e lê os arquivos que você adiciona.',
      },
      {
        title: 'Agent Center',
        body: 'Agentes prontos para uso e mais de 700 skills: fazem o trabalho de rotina de visibilidade em IA conforme uma agenda ou quando algo muda.',
      },
      {
        title: 'MCP',
        body: 'Use seus dados do Ansvisor no Claude, no ChatGPT, no Cursor e em outras ferramentas de IA.',
      },
    ],
    ctaTitle: 'Meça suas próprias perguntas',
    ctaBody: (prompts, engines, questions) =>
      `Comece o teste grátis: o Starter acompanha ${prompts} prompts todos os dias nos motores ${engines}, então cabem as ${questions} perguntas deste relatório e ${Math.max(prompts - questions, 0)} suas.`,
    steps: (domain, questions, country) => [
      `Adicione ${domain} como sua marca: o assistente de configuração costuma levar poucos minutos.`,
      `Acompanhe as ${questions} perguntas deste relatório como prompts (país: ${country}) e adicione as suas.`,
      'Abra o Action Center depois da primeira execução: os próximos passos, por prioridade.',
    ],
    button: 'Comece seu teste grátis',
  },
};
