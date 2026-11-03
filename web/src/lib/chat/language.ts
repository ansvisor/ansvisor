/**
 * The language of a Chat answer (CHAT-05 item 2; owner decision 2026-10-31:
 * the question's language). The writer reads the person's question first
 * and then pages of English data, and a small model answers in the data's
 * language: Claude Haiku 5.5 answered a Turkish question in English in Chat's
 * model test set (W4-35, 2026-11-03). So the engine names the question's
 * language as the turn's last line, and, when an answer still comes out in
 * English for a question in another language, has it rewritten once.
 *
 * Read from common words and letters, for the languages Chat's people write
 * in most; null when a text is too short or unclear, and then nothing is
 * said or rewritten. Pure.
 */

export const LANGUAGES = {
  en: 'English',
  tr: 'Turkish',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
} as const;

export type Language = keyof typeof LANGUAGES;

/** Each language's most common short words: what tells it apart in a sentence or two. */
const WORDS: Record<Language, readonly string[]> = {
  en: [
    'the',
    'and',
    'is',
    'are',
    'to',
    'of',
    'what',
    'why',
    'how',
    'did',
    'we',
    'our',
    'this',
    'that',
    'for',
    'with',
    'you',
    'it',
    'was',
    'do',
    'can',
    'my',
  ],
  tr: [
    've',
    'bir',
    'bu',
    'ne',
    'neden',
    'nasıl',
    'için',
    'mi',
    'mı',
    'mu',
    'mü',
    'ile',
    'çok',
    'daha',
    'gibi',
    'biz',
    'bizim',
    'hafta',
    'nedir',
    'var',
    'yok',
    'şu',
  ],
  de: [
    'der',
    'die',
    'das',
    'und',
    'ist',
    'nicht',
    'wie',
    'warum',
    'wir',
    'unser',
    'mit',
    'für',
    'auf',
    'ein',
    'eine',
    'zu',
    'im',
    'den',
    'von',
    'es',
    'sind',
    'diese',
  ],
  fr: [
    'le',
    'les',
    'et',
    'est',
    'pourquoi',
    'comment',
    'nous',
    'notre',
    'avec',
    'pour',
    'sur',
    'une',
    'des',
    'du',
    'que',
    'ce',
    'pas',
    'cette',
    'sont',
    'dans',
  ],
  es: [
    'el',
    'los',
    'las',
    'y',
    'es',
    'por',
    'qué',
    'cómo',
    'nuestro',
    'nuestra',
    'con',
    'para',
    'una',
    'del',
    'que',
    'se',
    'esta',
    'este',
    'hemos',
    'son',
  ],
  it: [
    'il',
    'gli',
    'è',
    'perché',
    'nostro',
    'nostra',
    'per',
    'che',
    'non',
    'di',
    'questa',
    'questo',
    'sono',
    'siamo',
  ],
  pt: [
    'os',
    'é',
    'nosso',
    'nossa',
    'com',
    'uma',
    'do',
    'não',
    'são',
    'caiu',
    'nós',
    'você',
    'isso',
  ],
  nl: [
    'het',
    'en',
    'waarom',
    'hoe',
    'wij',
    'ons',
    'onze',
    'met',
    'voor',
    'op',
    'een',
    'van',
    'dat',
    'niet',
    'zijn',
    'deze',
    'ik',
  ],
};

/** Letters only one of them uses, each a strong sign. */
const LETTERS: Partial<Record<Language, RegExp>> = {
  tr: /[ğşıİĞŞ]/g,
  de: /[ß]/g,
  es: /[ñ¿¡]/g,
  pt: /[ãõ]/g,
};

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    // Code, links and Markdown tell nothing about the language.
    .replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/\S+|\[[^\]]*\]\([^)]*\)/g, ' ')
    .split(/[^\p{L}']+/u)
    .map((word) => word.replace(/'.*$/, ''))
    .filter(Boolean);

/**
 * A text's language: the one whose common words and letters it has most,
 * with at least 2 signs and well ahead of the next; null when unsure.
 */
export function detectLanguage(text: string): Language | null {
  const words = wordsOf(text);
  const scores = (Object.keys(WORDS) as Language[]).map((language) => {
    const common = new Set(WORDS[language]);
    const hits = words.filter((word) => common.has(word)).length;
    const letters = text.match(LETTERS[language] ?? /(?!)/g)?.length ?? 0;
    return { language, score: hits + 2 * Math.min(letters, 3) };
  });
  scores.sort((a, b) => b.score - a.score);
  const [best, next] = scores;
  if (best.score < 2 || best.score < 1.5 * next.score) return null;
  return best.language;
}

/** Each language's names, in the languages Chat reads and in Turkish. */
const NAMES: Record<Language, readonly string[]> = {
  en: [
    'english',
    'englisch',
    'anglais',
    'inglés',
    'ingles',
    'inglese',
    'inglês',
    'engels',
    'ingilizce',
  ],
  tr: ['turkish', 'türkçe'],
  de: ['german', 'deutsch', 'almanca'],
  fr: ['french', 'français', 'fransızca'],
  es: ['spanish', 'español', 'ispanyolca'],
  it: ['italian', 'italiano', 'italyanca'],
  pt: ['portuguese', 'português', 'portekizce'],
  nl: ['dutch', 'nederlands', 'felemenkçe'],
};

const NAMED = new Map(
  (Object.keys(NAMES) as Language[]).flatMap((language) =>
    NAMES[language].map((name) => [name, language] as const),
  ),
);
const L = `(${[...NAMED.keys()].join('|')})`;
/** After "in <language>": the end, a mark, or a word that doesn't make the language a noun's ("in German prompts"). */
const ENDS = String.raw`(?=\s*(?:$|[.,;:!?)]|(?:please|only|instead|too|and|about|for|with|so|rather|this|that|the|a|an|but|if|using)\b))`;

/**
 * The person asks for the answer in a language they name ("answer in
 * English", "İngilizce cevap ver", "İngilizce bir blog yazısı yaz", "auf
 * Deutsch"): that language, whatever they wrote in (owner, 2026-11-03).
 * Naming one in passing ("why do Turkish users search less?", "how visible
 * are we in German prompts?", "why did we drop in Spanish?") isn't asking:
 * "in <language>" asks only after an answer verb, before "please" or
 * "only", at the very start, or as the last words of a message that isn't
 * a question.
 */
const ASKS_FOR_LANGUAGE = [
  new RegExp(
    String.raw`\b(?:answer|answers|respond|response|reply|write|rewrite|translate|say|explain|summari[sz]e|tell|describe|draft|put|give)\b(?:\s+\S+){0,6}?\s+(?:in|into)\s+${L}${ENDS}`,
    'i',
  ),
  new RegExp(String.raw`\b(?:in|into)\s+${L}\s*,?\s+(?:please|only|instead)\b`, 'i'),
  new RegExp(String.raw`^\s*in\s+${L}\s*[,:]`, 'i'),
  new RegExp(String.raw`\bin\s+${L}\s*[.!]*\s*$`, 'i'),
  new RegExp(String.raw`\b(?:auf|en)\s+${L}`, 'i'),
  new RegExp(
    String.raw`${L}(?:\s+\S+){0,3}?\s+(?:cevap|yanıt|yaz|anlat|çevir|olarak|version|translation)`,
    'i',
  ),
  new RegExp(String.raw`${L}\s*,?\s+(?:please|only)\b`, 'i'),
];

/** The language a question asks the answer to be in, by name; null when it asks for none. Turkish's İ folds to i. */
export function askedLanguage(question: string): Language | null {
  const text = question.replace(/İ/g, 'i');
  for (const pattern of ASKS_FOR_LANGUAGE) {
    const name = pattern.exec(text)?.[1];
    if (name) return NAMED.get(name.toLowerCase()) ?? null;
  }
  return null;
}

/** Whether a question asks for the answer in a language it names. */
export function asksForLanguage(question: string): boolean {
  return askedLanguage(question) !== null;
}

/**
 * The turn's last line for the writer: the language the person asked for,
 * else the question's, named, so pages of English data don't set it. Null
 * when the language is unclear.
 */
export function languageLine(question: string): string | null {
  const asked = askedLanguage(question);
  if (asked) {
    const name = LANGUAGES[asked];
    return `The person asked for the answer in ${name}: answer in ${name}.`;
  }
  const language = detectLanguage(question);
  if (!language) return null;
  const name = LANGUAGES[language];
  return `The person wrote in ${name}: answer in ${name}, whatever the language of the data, unless they ask for another language.`;
}

/**
 * The language an answer is rewritten in, once, when it came out in English
 * for a question in another language; null otherwise: the same language, one
 * of them unclear, or a question that asks for a language (an English blog
 * post asked for in Turkish is English on purpose).
 */
export function rewriteLanguage(question: string, answer: string): Language | null {
  if (asksForLanguage(question)) return null;
  const asked = detectLanguage(question);
  if (!asked || asked === 'en') return null;
  return detectLanguage(answer) === 'en' ? asked : null;
}
