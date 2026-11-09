/**
 * What a card's copy (./copy-*.ts) names in its own language, from the
 * runtime's own names and formats (Intl): the country ("États-Unis"), the
 * language the questions were asked in ("anglais") and a share ("24 %").
 * The card's figures name the country and the language in English
 * (./payload.ts), as the server's Intl gives them.
 */

const regions = new Map<string, Intl.DisplayNames>();
let codesByEnglish: Map<string, string> | null = null;

function regionNames(lang: string): Intl.DisplayNames {
  let names = regions.get(lang);
  if (!names) {
    names = new Intl.DisplayNames([lang], { type: 'region', fallback: 'none' });
    regions.set(lang, names);
  }
  return names;
}

/** The country's name in `lang`: "Vereinigte Staaten"; its English name when the runtime has none. */
export function countryIn(lang: string, country: { code: string; name: string }): string {
  try {
    return regionNames(lang).of(country.code.toUpperCase()) ?? country.name;
  } catch {
    return country.name;
  }
}

/** A language's ISO 639-1 code from its English name ("Turkish" → "tr"), as the server named it. */
function codeOf(english: string): string | null {
  if (!codesByEnglish) {
    const names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    codesByEnglish = new Map();
    for (const a of letters) {
      for (const b of letters) {
        const name = names.of(`${a}${b}`);
        if (name && !codesByEnglish.has(name)) codesByEnglish.set(name, `${a}${b}`);
      }
    }
  }
  return codesByEnglish.get(english) ?? null;
}

/** The language the questions were asked in, named in `lang`: "Turkish" is "turc" in French. */
export function languageIn(lang: string, english: string): string {
  const code = codeOf(english);
  if (!code) return english;
  try {
    return (
      new Intl.DisplayNames([lang], { type: 'language', fallback: 'none' }).of(code) ?? english
    );
  } catch {
    return english;
  }
}

/** A whole share in the locale's way: "24%", "%24" in Turkish, "24 %" in French. */
export const percentIn = (locale: string, value: number): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);
