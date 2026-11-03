import { describe, expect, it } from 'vitest';
import { detectLanguage, languageLine, rewriteLanguage } from './language';

/** The language of a Chat answer: the question's (language.ts). */

describe('detectLanguage', () => {
  it('reads the languages Chat sees most, from a question or an answer', () => {
    expect(detectLanguage("Bu hafta Perplexity'de neden düştük?")).toBe('tr');
    expect(detectLanguage('Why did our visibility on Perplexity fall this week?')).toBe('en');
    expect(
      detectLanguage('Warum ist unsere Sichtbarkeit auf Perplexity diese Woche gefallen?'),
    ).toBe('de');
    expect(detectLanguage('Pourquoi notre visibilité est-elle en baisse sur Perplexity ?')).toBe(
      'fr',
    );
    expect(detectLanguage('¿Por qué cayó nuestra visibilidad en Perplexity esta semana?')).toBe(
      'es',
    );
  });

  it('says nothing when a text is too short or unclear', () => {
    expect(detectLanguage('Perplexity?')).toBeNull();
    expect(detectLanguage('hi')).toBeNull();
    expect(detectLanguage('```\nconst a = 1;\n``` https://example.com')).toBeNull();
  });
});

describe('languageLine', () => {
  it("names the question's language for the writer, or nothing when unclear", () => {
    expect(languageLine("Bu hafta Perplexity'de neden düştük?")).toBe(
      'The person wrote in Turkish: answer in Turkish, whatever the language of the data, unless they ask for another language.',
    );
    expect(languageLine('Perplexity?')).toBeNull();
  });
});

describe('rewriteLanguage', () => {
  const TURKISH = "Bu hafta Perplexity'de neden düştük?";
  const ENGLISH =
    'Perplexity visibility fell this week, and the biggest drop is in the CRM prompts.';

  it('rewrites an English answer to a question in another language', () => {
    expect(rewriteLanguage(TURKISH, ENGLISH)).toBe('tr');
  });

  it('leaves an answer in the question’s language, an English question, or an unclear one', () => {
    expect(
      rewriteLanguage(
        TURKISH,
        'Perplexity görünürlüğü bu hafta düştü ve en büyük düşüş CRM sorularında.',
      ),
    ).toBeNull();
    expect(rewriteLanguage('Why did we fall this week?', ENGLISH)).toBeNull();
    expect(rewriteLanguage('Perplexity?', ENGLISH)).toBeNull();
  });

  it('leaves an answer in a language the person asked for', () => {
    expect(
      rewriteLanguage('İngilizce bir blog yazısı yaz: neden AI görünürlüğü önemli?', ENGLISH),
    ).toBeNull();
    expect(rewriteLanguage('Bu sayfayı in English yaz, lütfen ve hemen', ENGLISH)).toBeNull();
  });
});
