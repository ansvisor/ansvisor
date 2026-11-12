import { webAppOrigin } from '../chat-agents.js';
import { deliverEmail } from '../email.js';
import logger from '../logger.js';
import { countryInSentence, countryNameIn, reportLanguage } from './countries.js';
import { reportCardStore } from './store.js';

/**
 * The report card's e-mail (REPORT-CARD §1, §4, §7): first that the PDF is
 * attached (owner review 2026-11-08), then the headline figures, and a
 * "Start a free trial" invitation; from Ansvisor
 * (REPORT_CARD_FROM_EMAIL, else RESEND_FROM_EMAIL). Each minute the queue
 * sends what is waiting: a new card once it's ready, a card sent again
 * (resent), and a short note when a card couldn't be made, each in the
 * language the request chose, else the card's country's. The PDF is drawn
 * by the web app (POST /api/internal/report-card/pdf) from the card's
 * figures, in the same language, once a card and language a sweep.
 */

export const PRIVACY_URL = 'https://www.ansvisor.com/privacy-policy';
/** Requests one sweep sends at most. */
const SWEEP_LIMIT = 20;
/** How often a PDF the web couldn't draw is tried, a sweep apart, before the e-mail is given up. */
export const MAX_PDF_ATTEMPTS = 30;
/** The web's answer for figures it will never draw: the only failure given up at once. */
const UNPROCESSABLE = 422;
const DAY_MS = 24 * 60 * 60 * 1000;

const ENGINE_NAMES = {
  'chatgpt-web': 'ChatGPT',
  'copilot-web': 'Microsoft Copilot',
  'gemini-web': 'Gemini',
  'google-aio': 'Google AI Overviews',
  'google-aimode': 'Google AI Mode',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The trial's sign-up page, marked as coming from the card's e-mail. */
export function signUpUrl(origin = webAppOrigin()) {
  return `${origin}/en/sign-up?utm_source=report-card&utm_medium=email`;
}

/** "ansvisor-ai-visibility-report-card-acme.com.pdf" */
export const pdfName = (site) =>
  `ansvisor-ai-visibility-report-card-${String(site).replace(/[^a-z0-9.-]/gi, '-')}.pdf`;

/** Ansvisor's colors (the brand style guide): ink, a warm grey and a sand border. */
const INK = '#1C1A17';
const GREY = '#464442';
const SAND = '#EBE6DE';

/** "A", "A and B", "A, B and C"; "A ve B" in Turkish. */
const listIn = (items, and) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${and} ${items.at(-1)}`;

/** A share in the e-mail's language: "19%", "%19" in Turkish, "19 %" in French. */
const percentIn = (locale, value) =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);

/** "1 réponse", "2 réponses": a count with its word. */
const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The privacy link, as each footer ends. */
const privacy = (label) => `<a href="${PRIVACY_URL}" style="color:${GREY};">${label}</a>`;

/**
 * The e-mail's words, in the request's language (owner decision
 * 2026-11-09: the form may choose it), else the card's country's: Turkish
 * for Türkiye, English elsewhere (2026-11-04), as the PDF (web
 * lib/report-card/copy.ts). Ansvisor's product, feature and button names
 * stay in English, as the app shows them (2026-11-08). Names and sites
 * never take a case ending ("{site} için"), and the country stands where
 * no article or preposition must agree with it: "(pays : États-Unis)".
 */
const EMAIL_COPY = {
  en: {
    locale: 'en-US',
    and: 'and',
    country: (code, name) => countryInSentence(code, name),
    footer: `You asked for this report card on ansvisor.com. AI answers change from day to day, so it is a snapshot. How we use your details: ${privacy('Privacy Notice')}.`,
    title: 'Your AI visibility report card',
    hi: (name) => `Hi ${name},`,
    attached: (site) => `Your AI visibility report card for ${site} is attached: a 4-page PDF.`,
    resent: (site, made, next) =>
      `It is the card we made for ${site} on ${made}, sent again; a new one can be made from ${next}.`,
    intro: (engines, starter, questions, readers, country, site) =>
      `We asked ${engines}${starter ? ', the engines in Ansvisor Starter,' : ''} ${questions} questions your ${readers ? 'readers' : 'buyers'} ask, in ${country}. Here is what came back for ${site}.`,
    growth: (engines) =>
      ` We asked ${engines} too: they are in Ansvisor Growth, and the PDF shows them apart.`,
    visibility: (engines, named, answers) =>
      `AI visibility${engines ? ` in ${engines}` : ''}: named in ${named} of ${answers} answers`,
    leader: (answers) => `Top competitor: named in ${answers} answers`,
    noLeader: 'None',
    noLeaderLabel: 'No competitor was named',
    cited: (answers) => `Answers that cite your site, of ${answers}`,
    pages: (questions) =>
      `The 4 pages hold where you start and who AI names instead, all ${questions} questions we asked and what each engine said, what you’d do in your first week, and what AI visits are worth with Starter and Growth side by side.`,
    work: 'In Ansvisor, Chat and ready-to-use agents do the week-one work with you.',
    button: 'Start a free trial',
    own: 'Want to measure your own questions too? In the free trial, Ansvisor asks this card’s questions and yours every day, and ranks what to do next.',
    subject: (domain) => `Your AI visibility report card: ${domain}`,
    failedTitle: 'We couldn’t finish your report card',
    failed: (site) =>
      `We couldn’t finish the AI visibility report card for ${site}. Reply to this e-mail and we’ll look into it.`,
    failedSubject: (site) => `We couldn’t finish your report card for ${site}`,
  },
  tr: {
    locale: 'tr-TR',
    and: 've',
    country: (code, name) => countryNameIn(code, 'tr') ?? name,
    footer: `Bu karneyi ansvisor.com üzerinden istediniz. Yapay zekâ yanıtları her gün değişir; bu bir anlık ölçümdür. Bilgilerinizi nasıl kullandığımız: ${privacy('Gizlilik Bildirimi')}.`,
    title: 'Yapay zekâ görünürlük karneniz',
    hi: (name) => `Merhaba ${name},`,
    attached: (site) => `${site} için yapay zekâ görünürlük karneniz ekte: 4 sayfalık bir PDF.`,
    resent: (site, made, next) =>
      `Bu, ${site} için ${made} tarihinde hazırladığımız karne, yeniden gönderildi; yenisi ${next} tarihinden itibaren hazırlanabilir.`,
    intro: (engines, starter, questions, readers, country, site) =>
      `${engines}${starter ? ' (Ansvisor Starter’ın motorları)' : ''} motorlarına ${country} konumundan, ${readers ? 'okurlarınızın' : 'alıcılarınızın'} sorduğu ${questions} soruyu sorduk. ${site} için sonuçlar aşağıda.`,
    growth: (engines) =>
      ` ${engines} motorlarına da sorduk: bunlar Ansvisor Growth’ta; PDF bunları ayrı gösteriyor.`,
    visibility: (engines, named, answers) =>
      `Yapay zekâ görünürlüğü${engines ? ` (${engines})` : ''}: ${answers} yanıtın ${named} tanesinde adınız geçiyor`,
    leader: (answers) => `Öne çıkan rakip: ${answers} yanıtta anılıyor`,
    noLeader: 'Yok',
    noLeaderLabel: 'Hiçbir rakip anılmadı',
    cited: (answers) => `${answers} yanıttan sitenizi kaynak gösteren`,
    pages: (questions) =>
      `4 sayfada: nereden başladığınız ve yapay zekânın sizin yerinize kimi önerdiği, sorduğumuz ${questions} sorunun tamamı ve her motorun yanıtı, ilk haftanızda yapacaklarınız, yapay zekâ ziyaretlerinin değeri ve yan yana Starter ile Growth.`,
    work: 'Ansvisor’da Chat ve kullanıma hazır ajanlar ilk haftanın işlerini sizinle birlikte yapar.',
    button: 'Ücretsiz denemeyi başlatın',
    own: 'Kendi sorularınızı da ölçmek ister misiniz? Ücretsiz denemede Ansvisor bu karnenin sorularını ve sizinkileri her gün sorar, sıradaki işleri öncelik sırasıyla verir.',
    subject: (domain) => `Yapay zekâ görünürlük karneniz: ${domain}`,
    failedTitle: 'Karnenizi tamamlayamadık',
    failed: (site) =>
      `${site} için yapay zekâ görünürlük karnesini tamamlayamadık. Bu e-postayı yanıtlayın, inceleyelim.`,
    failedSubject: (site) => `${site} için karnenizi tamamlayamadık`,
  },
  // French: a no-break space before a colon, as French sets it.
  fr: {
    locale: 'fr-FR',
    and: 'et',
    country: (code, name) => countryNameIn(code, 'fr') ?? name,
    footer: `Vous avez demandé ce rapport sur ansvisor.com. Les réponses de l’IA changent d’un jour à l’autre\u00a0: ce rapport est un instantané. Comment nous utilisons vos données\u00a0: ${privacy('Politique de confidentialité')}.`,
    title: 'Votre rapport de visibilité IA',
    hi: (name) => `Bonjour ${name},`,
    attached: (site) =>
      `Votre rapport de visibilité IA pour ${site} est en pièce jointe\u00a0: un PDF de 4 pages.`,
    resent: (site, made, next) =>
      `Nous vous renvoyons le rapport établi pour ${site} le ${made}. Un nouveau rapport pourra être établi à partir du ${next}.`,
    intro: (engines, starter, questions, readers, country, site) =>
      `Nous avons posé à ${engines}${starter ? ', les moteurs d’Ansvisor Starter,' : ''} ${questions} questions que se posent vos ${readers ? 'lecteurs' : 'clients'} (pays\u00a0: ${country}). Voici les résultats pour ${site}.`,
    growth: (engines) =>
      ` Nous avons aussi interrogé ${engines}\u00a0: ils font partie d’Ansvisor Growth, et le PDF les présente à part.`,
    visibility: (engines, named, answers) =>
      `Visibilité IA${engines ? ` dans ${engines}` : ''}\u00a0: vous êtes mentionné dans ${named} réponses sur ${answers}`,
    leader: (answers) =>
      `Principal concurrent\u00a0: mentionné dans ${counted(answers, 'réponse', 'réponses')}`,
    noLeader: 'Aucun',
    noLeaderLabel: 'Aucun concurrent mentionné',
    cited: (answers) => `réponses sur ${answers} citent votre site`,
    pages: (questions) =>
      `Les 4 pages présentent votre point de départ et les marques que l’IA cite à votre place, les ${questions} questions posées avec la réponse de chaque moteur, ce que vous feriez la première semaine, et ce que valent les visites venues de l’IA, avec Starter et Growth côte à côte.`,
    work: 'Dans Ansvisor, Chat et des agents prêts à l’emploi font avec vous le travail de la première semaine.',
    button: 'Commencer l’essai gratuit',
    own: 'Vous voulez aussi mesurer vos propres questions\u202f? Pendant l’essai gratuit, Ansvisor pose chaque jour les questions de ce rapport et les vôtres, et classe les prochaines actions par priorité.',
    subject: (domain) => `Votre rapport de visibilité IA\u00a0: ${domain}`,
    failedTitle: 'Nous n’avons pas pu terminer votre rapport',
    failed: (site) =>
      `Nous n’avons pas pu terminer le rapport de visibilité IA pour ${site}. Répondez à cet e-mail et nous regarderons ce qui s’est passé.`,
    failedSubject: (site) => `Nous n’avons pas pu terminer votre rapport pour ${site}`,
  },
  es: {
    locale: 'es-ES',
    and: 'y',
    country: (code, name) => countryNameIn(code, 'es') ?? name,
    footer: `Pediste este informe en ansvisor.com. Las respuestas de la IA cambian de un día para otro, así que es una foto del momento. Cómo usamos tus datos: ${privacy('Aviso de privacidad')}.`,
    title: 'Tu informe de visibilidad en IA',
    hi: (name) => `Hola, ${name}:`,
    attached: (site) =>
      `Te adjuntamos tu informe de visibilidad en IA de ${site}: un PDF de 4 páginas.`,
    resent: (site, made, next) =>
      `Te reenviamos el informe que preparamos para ${site} el ${made}. Podremos preparar uno nuevo a partir del ${next}.`,
    intro: (engines, starter, questions, readers, country, site) =>
      `Hicimos a ${engines}${starter ? ', los motores de Ansvisor Starter,' : ''} ${questions} preguntas que hacen tus ${readers ? 'lectores' : 'clientes'} en ${country}. Esto es lo que obtuvimos para ${site}.`,
    growth: (engines) =>
      ` También preguntamos a ${engines}: están en Ansvisor Growth, y el PDF los muestra aparte.`,
    visibility: (engines, named, answers) =>
      `Visibilidad en IA${engines ? ` (${engines})` : ''}: te mencionan en ${named} de ${answers} respuestas`,
    leader: (answers) =>
      `Principal competidor: mencionado en ${counted(answers, 'respuesta', 'respuestas')}`,
    noLeader: 'Ninguno',
    noLeaderLabel: 'No se mencionó ningún competidor',
    cited: (answers) => `de ${answers} respuestas citan tu sitio`,
    pages: (questions) =>
      `En sus 4 páginas verás tu punto de partida y a quién menciona la IA en tu lugar, las ${questions} preguntas que hicimos y qué respondió cada motor, lo que harías en tu primera semana, y cuánto valen las visitas que llegan desde la IA, con Starter y Growth lado a lado.`,
    work: 'En Ansvisor, Chat y agentes listos para usar hacen contigo el trabajo de la primera semana.',
    button: 'Empieza tu prueba gratis',
    own: '¿Quieres medir también tus propias preguntas? En la prueba gratis, Ansvisor hace cada día las preguntas de este informe y las tuyas, y ordena por prioridad lo siguiente que conviene hacer.',
    subject: (domain) => `Tu informe de visibilidad en IA: ${domain}`,
    failedTitle: 'No pudimos terminar tu informe',
    failed: (site) =>
      `No pudimos terminar el informe de visibilidad en IA de ${site}. Responde a este correo y lo revisaremos.`,
    failedSubject: (site) => `No pudimos terminar tu informe de ${site}`,
  },
  de: {
    locale: 'de-DE',
    and: 'und',
    country: (code, name) => countryNameIn(code, 'de') ?? name,
    footer: `Sie haben diesen Bericht auf ansvisor.com angefordert. KI-Antworten ändern sich von Tag zu Tag, er ist also eine Momentaufnahme. Wie wir Ihre Daten verwenden: ${privacy('Datenschutzhinweis')}.`,
    title: 'Ihr KI-Sichtbarkeitsbericht',
    hi: (name) => `Hallo ${name},`,
    attached: (site) =>
      `Im Anhang finden Sie Ihren KI-Sichtbarkeitsbericht für ${site}: ein PDF mit 4 Seiten.`,
    resent: (site, made, next) =>
      `Wir senden Ihnen erneut den Bericht, den wir am ${made} für ${site} erstellt haben. Ein neuer kann ab dem ${next} erstellt werden.`,
    intro: (engines, starter, questions, readers, country, site) =>
      `Wir haben ${engines}${starter ? ', den Engines in Ansvisor Starter,' : ''} ${questions} Fragen gestellt, die Ihre ${readers ? 'Leser' : 'Kunden'} stellen (Land: ${country}). Das sind die Ergebnisse für ${site}.`,
    growth: (engines) =>
      ` Auch ${engines} haben wir gefragt: Diese sind in Ansvisor Growth enthalten, und das PDF zeigt sie gesondert.`,
    visibility: (engines, named, answers) =>
      `KI-Sichtbarkeit${engines ? ` in ${engines}` : ''}: in ${named} von ${answers} Antworten genannt`,
    leader: (answers) =>
      `Stärkster Wettbewerber: in ${counted(answers, 'Antwort', 'Antworten')} genannt`,
    noLeader: 'Keiner',
    noLeaderLabel: 'Kein Wettbewerber genannt',
    cited: (answers) => `von ${answers} Antworten zitieren Ihre Website`,
    pages: (questions) =>
      `Auf den 4 Seiten: wo Sie stehen und wen die KI stattdessen nennt, alle ${questions} gestellten Fragen mit der Antwort jeder Engine, was Sie in der ersten Woche tun würden, und was KI-Besuche wert sind, mit Starter und Growth im Vergleich.`,
    work: 'In Ansvisor erledigen Chat und einsatzbereite Agenten die Arbeit der ersten Woche gemeinsam mit Ihnen.',
    button: 'Jetzt kostenlos testen',
    own: 'Möchten Sie auch Ihre eigenen Fragen messen? Im kostenlosen Test stellt Ansvisor die Fragen dieses Berichts und Ihre eigenen jeden Tag und ordnet die nächsten Schritte nach Priorität.',
    subject: (domain) => `Ihr KI-Sichtbarkeitsbericht: ${domain}`,
    failedTitle: 'Wir konnten Ihren Bericht nicht fertigstellen',
    failed: (site) =>
      `Wir konnten den KI-Sichtbarkeitsbericht für ${site} nicht fertigstellen. Antworten Sie auf diese E-Mail, und wir sehen es uns an.`,
    failedSubject: (site) => `Wir konnten Ihren Bericht für ${site} nicht fertigstellen`,
  },
  pt: {
    locale: 'pt-BR',
    and: 'e',
    country: (code, name) => countryNameIn(code, 'pt') ?? name,
    footer: `Você pediu este relatório em ansvisor.com. As respostas da IA mudam de um dia para o outro, então ele é um retrato do momento. Como usamos seus dados: ${privacy('Aviso de Privacidade')}.`,
    title: 'Seu relatório de visibilidade em IA',
    hi: (name) => `Olá, ${name},`,
    attached: (site) =>
      `Seu relatório de visibilidade em IA de ${site} está em anexo: um PDF de 4 páginas.`,
    resent: (site, made, next) =>
      `Estamos reenviando o relatório que fizemos para ${site} em ${made}. Um novo poderá ser feito a partir de ${next}.`,
    intro: (engines, starter, questions, readers, country, site) =>
      `Fizemos ${questions} perguntas que seus ${readers ? 'leitores' : 'clientes'} fazem nos motores ${engines}${starter ? ', os do Ansvisor Starter' : ''} (país: ${country}). Veja o resultado para ${site}.`,
    growth: (engines) =>
      ` Também perguntamos nos motores ${engines}: eles estão no Ansvisor Growth, e o PDF os mostra à parte.`,
    visibility: (engines, named, answers) =>
      `Visibilidade em IA${engines ? ` (${engines})` : ''}: você aparece em ${named} de ${answers} respostas`,
    leader: (answers) =>
      `Principal concorrente: mencionado em ${counted(answers, 'resposta', 'respostas')}`,
    noLeader: 'Nenhum',
    noLeaderLabel: 'Nenhum concorrente foi mencionado',
    cited: (answers) => `de ${answers} respostas citam seu site`,
    pages: (questions) =>
      `As 4 páginas mostram seu ponto de partida e quem a IA menciona no seu lugar, as ${questions} perguntas que fizemos e o que cada motor respondeu, o que você faria na primeira semana, e quanto valem as visitas vindas da IA, com Starter e Growth lado a lado.`,
    work: 'No Ansvisor, o Chat e agentes prontos para uso fazem com você o trabalho da primeira semana.',
    button: 'Comece seu teste grátis',
    own: 'Quer medir também as suas próprias perguntas? No teste grátis, o Ansvisor faz todos os dias as perguntas deste relatório e as suas, e ordena por prioridade o que fazer em seguida.',
    subject: (domain) => `Seu relatório de visibilidade em IA: ${domain}`,
    failedTitle: 'Não conseguimos concluir seu relatório',
    failed: (site) =>
      `Não conseguimos concluir o relatório de visibilidade em IA de ${site}. Responda a este e-mail e vamos verificar.`,
    failedSubject: (site) => `Não conseguimos concluir seu relatório de ${site}`,
  },
  it: {
    locale: 'it-IT',
    and: 'e',
    country: (code, name) => countryNameIn(code, 'it') ?? name,
    footer: `Hai richiesto questo report su ansvisor.com. Le risposte dell’IA cambiano di giorno in giorno, quindi è un’istantanea. Come usiamo i tuoi dati: ${privacy('Informativa sulla privacy')}.`,
    title: 'Il tuo report di visibilità nell’IA',
    hi: (name) => `Ciao ${name},`,
    attached: (site) =>
      `In allegato trovi il tuo report di visibilità nell’IA per ${site}: un PDF di 4 pagine.`,
    resent: (site, made, next) =>
      `Ti inviamo di nuovo il report che abbiamo preparato per ${site} il ${made}. Potremo prepararne uno nuovo dal ${next}.`,
    intro: (engines, starter, questions, readers, country, site) =>
      `Abbiamo posto a ${engines}${starter ? ', i motori di Ansvisor Starter,' : ''} ${questions} domande che fanno i tuoi ${readers ? 'lettori' : 'clienti'} (paese: ${country}). Ecco cosa è emerso per ${site}.`,
    growth: (engines) =>
      ` Abbiamo interrogato anche ${engines}: sono inclusi in Ansvisor Growth, e il PDF li mostra a parte.`,
    visibility: (engines, named, answers) =>
      `Visibilità nell’IA${engines ? ` (${engines})` : ''}: compari in ${named} risposte su ${answers}`,
    leader: (answers) =>
      `Concorrente principale: menzionato in ${counted(answers, 'risposta', 'risposte')}`,
    noLeader: 'Nessuno',
    noLeaderLabel: 'Nessun concorrente menzionato',
    cited: (answers) => `risposte su ${answers} citano il tuo sito`,
    pages: (questions) =>
      `Le 4 pagine mostrano il tuo punto di partenza e chi l’IA menziona al posto tuo, tutte le ${questions} domande poste con la risposta di ogni motore, cosa faresti nella prima settimana e quanto valgono le visite dall’IA, con Starter e Growth a confronto.`,
    work: 'In Ansvisor, Chat e agenti pronti all’uso svolgono con te il lavoro della prima settimana.',
    button: 'Inizia la prova gratuita',
    own: 'Vuoi misurare anche le tue domande? Nella prova gratuita, Ansvisor pone ogni giorno le domande di questo report e le tue, e mette in ordine di priorità le prossime azioni.',
    subject: (domain) => `Il tuo report di visibilità nell’IA: ${domain}`,
    failedTitle: 'Non siamo riusciti a completare il tuo report',
    failed: (site) =>
      `Non siamo riusciti a completare il report di visibilità nell’IA per ${site}. Rispondi a questa e-mail e verificheremo.`,
    failedSubject: (site) => `Non siamo riusciti a completare il tuo report per ${site}`,
  },
  nl: {
    locale: 'nl-NL',
    and: 'en',
    country: (code, name) => countryNameIn(code, 'nl') ?? name,
    footer: `Je hebt dit rapport aangevraagd op ansvisor.com. AI-antwoorden veranderen van dag tot dag, dus dit is een momentopname. Hoe we je gegevens gebruiken: ${privacy('Privacyverklaring')}.`,
    title: 'Je AI-zichtbaarheidsrapport',
    hi: (name) => `Hallo ${name},`,
    attached: (site) =>
      `Je AI-zichtbaarheidsrapport voor ${site} zit in de bijlage: een pdf van 4 pagina’s.`,
    resent: (site, made, next) =>
      `We sturen je opnieuw het rapport dat we op ${made} voor ${site} hebben gemaakt. Vanaf ${next} kan er een nieuw worden gemaakt.`,
    intro: (engines, starter, questions, readers, country, site) =>
      `We hebben ${engines}${starter ? ', de engines in Ansvisor Starter,' : ''} ${questions} vragen gesteld die je ${readers ? 'lezers' : 'klanten'} stellen (land: ${country}). Dit kwam eruit voor ${site}.`,
    growth: (engines) =>
      ` We hebben ook ${engines} gevraagd: die zitten in Ansvisor Growth, en de pdf toont ze apart.`,
    visibility: (engines, named, answers) =>
      `AI-zichtbaarheid${engines ? ` in ${engines}` : ''}: genoemd in ${named} van ${answers} antwoorden`,
    leader: (answers) =>
      `Grootste concurrent: genoemd in ${counted(answers, 'antwoord', 'antwoorden')}`,
    noLeader: 'Geen',
    noLeaderLabel: 'Geen concurrent genoemd',
    cited: (answers) => `van de ${answers} antwoorden citeren je website`,
    pages: (questions) =>
      `De 4 pagina’s tonen waar je staat en wie AI in jouw plaats noemt, alle ${questions} vragen die we stelden met het antwoord van elke engine, wat je in je eerste week zou doen, en wat AI-bezoeken waard zijn, met Starter en Growth naast elkaar.`,
    work: 'In Ansvisor doen Chat en kant-en-klare agents samen met jou het werk van de eerste week.',
    button: 'Start je gratis proefperiode',
    own: 'Wil je ook je eigen vragen meten? In de gratis proefperiode stelt Ansvisor elke dag de vragen van dit rapport en die van jou, en zet het de volgende stappen op volgorde van prioriteit.',
    subject: (domain) => `Je AI-zichtbaarheidsrapport: ${domain}`,
    failedTitle: 'We konden je rapport niet afmaken',
    failed: (site) =>
      `We konden het AI-zichtbaarheidsrapport voor ${site} niet afmaken. Beantwoord deze e-mail, dan zoeken we het uit.`,
    failedSubject: (site) => `We konden je rapport voor ${site} niet afmaken`,
  },
};

/**
 * The e-mail's words: in the language the form chose, else by the card's
 * country (Turkish for Türkiye, English elsewhere).
 */
export const emailCopy = (countryCode, chosen = null) =>
  EMAIL_COPY[reportLanguage(countryCode, chosen)] ?? EMAIL_COPY.en;

const formatDateIn = (iso, locale) =>
  new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

const shell = (
  inner,
  t,
) => `<div style="font-family:Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:${INK};">
${inner}
  <p style="font-size:12px;color:${GREY};border-top:1px solid ${SAND};padding-top:16px;margin-top:24px;">
    ${t.footer}
  </p>
</div>`;

const stat = (value, label) =>
  `<td style="padding:12px;border:1px solid ${SAND};border-radius:8px;vertical-align:top;width:33%;background:#ffffff;">
      <div style="font-size:20px;font-weight:600;letter-spacing:-0.02em;color:${INK};">${value}</div>
      <div style="font-size:12px;color:${GREY};margin-top:4px;">${label}</div>
    </td>`;

/**
 * The e-mail for a ready card: new, or sent again, in the language the
 * request chose (`language`), else the card's country's.
 *
 * @param {{ firstName: string, payload: object, kind: 'new'|'resent', madeAt: string, repeatDays?: number, origin?: string, language?: string|null }} input
 * @returns {{ subject: string, html: string }}
 */
export function renderReportCardEmail({
  firstName,
  payload,
  kind,
  madeAt,
  repeatDays = 30,
  origin,
  language = null,
}) {
  const t = emailCopy(payload.country?.code, language);
  // The headline is Starter's engines (ChatGPT and Gemini); a
  // card made before they were split counts every engine. The competitors
  // and own citations are counted over the same answers (analyze.js
  // summarize), so the three figures share one base.
  const banded = Array.isArray(payload.mainEngines) && payload.mainEngines.length > 0;
  const main = banded
    ? payload.engines.filter((e) => payload.mainEngines.includes(e.engine))
    : payload.engines;
  const growth = banded
    ? payload.engines.filter((e) => !payload.mainEngines.includes(e.engine))
    : [];
  const answers = main.reduce((sum, e) => sum + e.answers, 0);
  const named = main.reduce((sum, e) => sum + e.named, 0);
  const visibility = answers ? Math.round((named / answers) * 100) : 0;
  const leader = payload.competitors[0];
  const site = escapeHtml(payload.domain);
  const nameOf = (e) => ENGINE_NAMES[e.engine] ?? e.engine;
  const engines = escapeHtml(listIn(main.map(nameOf), t.and));
  const growthLine = growth.length ? t.growth(escapeHtml(listIn(growth.map(nameOf), t.and))) : '';
  const country = escapeHtml(t.country(payload.country.code, payload.country.name));

  const intro =
    kind === 'resent'
      ? t.resent(
          site,
          escapeHtml(formatDateIn(madeAt, t.locale)),
          escapeHtml(
            formatDateIn(
              new Date(new Date(madeAt).getTime() + repeatDays * DAY_MS).toISOString(),
              t.locale,
            ),
          ),
        )
      : `${t.intro(engines, banded, payload.questionCount, payload.audience === 'readers', country, site)}${growthLine}`;

  const html = shell(
    `  <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.03em;margin:0 0 16px 0;">${t.title}</h1>
  <p style="font-size:14px;margin:0 0 12px 0;">${t.hi(escapeHtml(firstName))}</p>
  <p style="font-size:14px;margin:0 0 12px 0;">${t.attached(site)}</p>
  <p style="font-size:14px;margin:0 0 16px 0;">${intro}</p>
  <table role="presentation" cellspacing="8" style="width:100%;border-collapse:separate;margin:0 -8px 8px -8px;">
    <tr>
    ${stat(percentIn(t.locale, visibility), t.visibility(banded ? engines : null, named, answers))}
    ${stat(leader ? escapeHtml(leader.name) : t.noLeader, leader ? t.leader(leader.answers) : t.noLeaderLabel)}
    ${stat(String(payload.ownCitations), t.cited(answers))}
    </tr>
  </table>
  <p style="font-size:14px;margin:8px 0 12px 0;">${t.pages(payload.questionRows?.length || payload.questionCount)}</p>
  <p style="font-size:14px;margin:0 0 16px 0;">${t.work}</p>
  <div style="margin:24px 0;">
    <a href="${escapeHtml(signUpUrl(origin))}" style="background:${INK};color:#ffffff;text-decoration:none;padding:8px 28px;border-radius:100px;font-size:15px;font-weight:500;display:inline-block;">${t.button}</a>
  </div>
  <p style="font-size:14px;color:${GREY};margin:0;">${t.own}</p>`,
    t,
  );

  return { subject: t.subject(payload.domain), html };
}

/** The note for a card that couldn't be made, in the request's language or its country's. */
export function renderFailedEmail({ firstName, site, country, language = null }) {
  const t = emailCopy(country, language);
  const html = shell(
    `  <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.03em;margin:0 0 16px 0;">${t.failedTitle}</h1>
  <p style="font-size:14px;margin:0 0 12px 0;">${t.hi(escapeHtml(firstName))}</p>
  <p style="font-size:14px;margin:0 0 16px 0;">${t.failed(escapeHtml(site))}</p>`,
    t,
  );
  return { subject: t.failedSubject(site), html };
}

/**
 * The card's PDF from the web app, as bytes, in the request's `language`
 * (none: the card's country's). Throws with `status` when the web refused
 * the figures (4xx), and without when it couldn't be reached.
 */
export async function renderCardPdf(
  payload,
  { language = null, fetchImpl = fetch, env = process.env } = {},
) {
  const secret = env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set: the PDF cannot be asked for');
  const res = await fetchImpl(`${webAppOrigin()}/api/internal/report-card/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(language ? { card: payload, language } : { card: payload }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`The PDF was refused (${res.status})`), { status: res.status });
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Sends the e-mails waiting: one a request, each marked with what became of
 * it, so none goes twice. A PDF the web couldn't draw waits for the next
 * sweep, behind the e-mails not yet tried, and is given up (refused) after
 * MAX_PDF_ATTEMPTS; one whose figures it refuses (422) is given up at once.
 */
export async function deliverReportCards({
  store = reportCardStore(),
  render = renderCardPdf,
  send = deliverEmail,
  now = () => new Date(),
  env = process.env,
} = {}) {
  const waiting = await store.undeliveredRequests(SWEEP_LIMIT);
  const pdfs = new Map();
  const from = env.REPORT_CARD_FROM_EMAIL || undefined;
  const replyTo = env.REPORT_CARD_REPLY_TO || undefined;
  let sent = 0;
  for (const request of waiting) {
    const card = request.report_cards;
    // The language the form chose, or none: the card's country's.
    const language = request.report_language ?? null;
    let message;
    if (card.status === 'failed') {
      message = renderFailedEmail({
        firstName: request.first_name,
        site: card.site,
        country: request.country,
        language,
      });
    } else {
      // A card's PDF is drawn once a sweep for each language its requests ask for.
      const key = `${card.id}:${language ?? ''}`;
      if (!pdfs.has(key)) {
        try {
          pdfs.set(key, await render(card.payload, { language }));
        } catch (err) {
          // Only figures the web refuses (422) are given up at once. A 401 (a
          // CRON_SECRET out of step), a 404 (the web not yet deployed) or a
          // 5xx is tried again on the next sweep, up to MAX_PDF_ATTEMPTS.
          const attempts = (request.email_attempts ?? 0) + 1;
          const giveUp = err.status === UNPROCESSABLE || attempts >= MAX_PDF_ATTEMPTS;
          logger.error(
            { err: err.message, status: err.status, cardId: card.id, attempts, giveUp },
            '[report-card] PDF not drawn',
          );
          if (giveUp) await store.markEmailed(request.id, 'refused', now());
          else await store.markEmailAttempt(request.id, attempts);
          continue;
        }
      }
      message = {
        ...renderReportCardEmail({
          firstName: request.first_name,
          payload: card.payload,
          kind: request.outcome === 'resent' ? 'resent' : 'new',
          madeAt: card.created_at,
          language,
        }),
        attachments: [{ filename: pdfName(card.site), content: pdfs.get(key).toString('base64') }],
      };
    }
    const status = await send({ to: [request.email], from, replyTo, ...message });
    await store.markEmailed(request.id, status, now());
    if (status === 'sent') sent += 1;
  }
  return sent;
}
