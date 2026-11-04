import { Font } from '@react-pdf/renderer';

/** Numbers the font families withInter registers, one per PDF. */
let registered = 0;

/**
 * Draws one PDF with Inter (regular and bold) from `dir`: the font is
 * registered for this PDF alone, under a family of its own (`<name>-<n>`,
 * handed to `draw` for the document's styles), and taken off the registry
 * once the PDF is drawn.
 *
 * Inter registered once and used for several PDFs lost letters: react-pdf
 * keeps a family's font, and the font its glyphs, from one PDF to the next,
 * and a glyph a PDF drew only as part of another one (Inter's "i" is a
 * dotless "ı" and a dot) is kept without its letter. Every later PDF then
 * lost its "ı"s and some letters next to them ("Kış" printed as "ş"). A font
 * of its own starts each PDF with no glyphs, and PDFs drawn at the same time
 * don't share one.
 */
export async function withInter<T>(
  name: string,
  dir: string,
  draw: (fontFamily: string) => Promise<T>,
): Promise<T> {
  const family = `${name}-${++registered}`;
  Font.register({
    family,
    fonts: [
      { src: `${dir}/Inter-Regular.ttf`, fontWeight: 400 },
      { src: `${dir}/Inter-Bold.ttf`, fontWeight: 700 },
    ],
  });
  try {
    return await draw(family);
  } finally {
    delete Font.getRegisteredFonts()[family];
  }
}
