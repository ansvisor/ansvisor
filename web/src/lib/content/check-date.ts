import { languageCode } from './readability';

/**
 * A visible check date (Content Editor Quality spec §11, Phase 3, CE-052):
 * a comparison is trusted for saying when its products were last checked.
 * E-E-A-T counts one on the page; the to-do's Add line puts this month's in
 * the page's language, as the disclosure line goes in (CE-050). A language
 * not here gets none: the person writes it.
 */

// No full stop: a short line that isn't a sentence, which Answer first reads
// past as it does a byline or a date (isByline).
const LINES: Record<string, string> = {
  en: 'Last checked: {date}',
  tr: 'Son kontrol: {date}',
  de: 'Zuletzt geprüft: {date}',
  fr: 'Dernière vérification : {date}',
  es: 'Última revisión: {date}',
  pt: 'Última verificação: {date}',
  it: 'Ultimo controllo: {date}',
  nl: 'Laatst gecontroleerd: {date}',
  sv: 'Senast kontrollerad: {date}',
};

/** This month's check date line for a page in `language`, or null for a language not here. */
export function checkDateText(
  language: string | null | undefined,
  now = new Date(),
): string | null {
  const code = languageCode(language) ?? '';
  const line = LINES[code];
  if (!line) return null;
  const date = new Intl.DateTimeFormat(code, { month: 'long', year: 'numeric' }).format(now);
  return line.replace('{date}', () => date);
}

/**
 * Words (and their stems) that say a page was checked, tested, reviewed or
 * updated, the verb or the label ("Last update", "Son güncelleme",
 * "Letzte Aktualisierung"), in the languages above; each at a word's start
 * ("untested", "areas of" aren't one).
 */
const CHECKED =
  /(?<!\p{L})(?:checked|tested|reviewed|verified|updated?|as of|kontrol|güncelle|incele|test edil|doğrula|geprüft|überprüf|getestet|aktualisier|stand:|vérifi|mise? à jour|testé|révis|revis|actualiza|verifica|probad|atualiza|testad|controllat|controllo|aggiorna|gecontroleerd|getest|bijgewerkt|kontrollerad|uppdaterad|granskad)/giu;
const YEAR = /(?<!\d)(?:19|20)\d{2}(?!\d)/g;
/** A block this short is a label ("Updated March 2026"): its date is the page's. */
const LABEL_WORDS = 12;
/** In a longer one, the year must be this near the word ("we tested each in March 2025"). */
const NEAR_CHARS = 40;

/** The years a block says it was checked in (any year), as written or lowercased the Turkish way. */
function checkedYears(text: string): number[] {
  const out: number[] = [];
  for (const form of [text, text.toLocaleLowerCase('tr')]) {
    const label = form.split(/\s+/).filter(Boolean).length <= LABEL_WORDS;
    for (const word of form.matchAll(CHECKED)) {
      const from = label ? 0 : Math.max(0, word.index - NEAR_CHARS);
      const to = label ? form.length : word.index + word[0].length + NEAR_CHARS;
      for (const year of form.slice(from, to).matchAll(YEAR)) out.push(Number(year[0]));
    }
  }
  return out;
}

/** Whether a block says when the page was checked, at any date: Add line replaces it. */
export function isCheckDateText(text: string): boolean {
  return checkedYears(text).length > 0;
}

/**
 * Whether the page says when it was last checked: a block with a "checked"
 * word and a year from the last two (a check date older than that tells the
 * reader the comparison is stale).
 */
export function pageCheckDate(texts: readonly string[], now = new Date()): boolean {
  const from = now.getFullYear() - 1;
  return texts.some((text) =>
    checkedYears(text).some((year) => year >= from && year <= now.getFullYear()),
  );
}
