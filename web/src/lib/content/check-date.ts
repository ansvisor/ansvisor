import { languageCode } from './readability';

/**
 * A visible check date (Content Editor Quality spec §11, Phase 3, CE-052):
 * a comparison is trusted for saying when its products were last checked.
 * E-E-A-T counts one on the page; the to-do's Add line puts this month's in
 * the page's language, as the disclosure line goes in (CE-050). A language
 * not here gets none: the person writes it.
 */

const LINES: Record<string, string> = {
  en: 'Last checked: {date}.',
  tr: 'Son kontrol: {date}.',
  de: 'Zuletzt geprüft: {date}.',
  fr: 'Dernière vérification : {date}.',
  es: 'Última revisión: {date}.',
  pt: 'Última verificação: {date}.',
  it: 'Ultimo controllo: {date}.',
  nl: 'Laatst gecontroleerd: {date}.',
  sv: 'Senast kontrollerad: {date}.',
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

/** Words that say a page was checked, tested or updated, in the languages above. */
const CHECKED =
  /checked|tested|reviewed|verified|updated|as of|kontrol|güncellen|incelen|test edil|geprüft|aktualisiert|getestet|vérifi|mis à jour|testé|revisad|revisión|actualizad|probad|verificad|verificação|atualizad|controllat|controllo|aggiornat|gecontroleerd|bijgewerkt|kontrollerad|uppdaterad/iu;
const YEAR = /\b(?:19|20)\d{2}\b/g;

/**
 * Whether the page says when it was last checked: a paragraph with a
 * "checked" word and a year from the last two (a check date older than
 * that tells the reader the comparison is stale).
 */
export function pageCheckDate(texts: readonly string[], now = new Date()): boolean {
  const from = now.getFullYear() - 1;
  return texts.some(
    (text) =>
      CHECKED.test(text) &&
      [...text.matchAll(YEAR)].some((m) => {
        const year = Number(m[0]);
        return year >= from && year <= now.getFullYear();
      }),
  );
}
