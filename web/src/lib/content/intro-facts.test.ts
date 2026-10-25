import { describe, expect, it } from 'vitest';
import { introFacts, introKey } from './intro-facts';

/** A category page's intro facts (Quality spec §11, CE-054). */

const page = (intro: string, rest = '<h2>All daypacks</h2><p>Over 200 reviews from hikers.</p>') =>
  `<h1>Daypacks</h1>${intro}${rest}`;

describe('introFacts', () => {
  it('reads the intro’s counts and prices, sentence by sentence, each once', () => {
    expect(
      introFacts(
        page(
          '<p>Choose from 120+ daypacks for every trail. They are made to last.</p>' +
            '<p>Prices run $49–$199, and most are under $100.</p>',
        ),
      ).map((fact) => fact.sentence),
    ).toEqual([
      'Choose from 120+ daypacks for every trail.',
      'Prices run $49–$199, and most are under $100.',
    ]);
    for (const intro of [
      'Over 50 styles in stock.',
      'More than 40 models to pick from.',
      'Shop 24 colours.',
      "50'den fazla model.",
      'Über 30 Modelle im Shop.',
      'Plus de 20 modèles.',
      'Más de 30 modelos.',
      'From €49.',
      'Ab 49 € im Shop.',
    ]) {
      expect(introFacts(page(`<p>${intro}</p>`)), intro).toHaveLength(1);
    }
  });

  it('reads only the intro, and no fact where it states none', () => {
    // After the first H2 isn't the intro.
    expect(introFacts(page('<p>Packs for wet hikes and long days.</p>'))).toEqual([]);
    // A year, a size or a step isn't a count of the category's products.
    expect(
      introFacts(page('<p>Since 2009, packs from 20 to 40 litres, in 3 easy steps.</p>')),
    ).toEqual([]);
    expect(introFacts('<p>120+ daypacks.</p>')).toHaveLength(1);
  });

  it('keys a fact by its sentence’s words: a changed fact asks again', () => {
    expect(introKey('Choose from 120+ daypacks.')).toBe(introKey('Choose  from 120+ daypacks. '));
    expect(introKey('Choose from 120+ daypacks.')).not.toBe(introKey('Choose from 140+ daypacks.'));
    expect(introKey('Choose from 120+ daypacks.')).toMatch(/^intro:/);
  });
});
