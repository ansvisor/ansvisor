import { inflateSync } from 'node:zlib';

/**
 * The text a PDF drawn by @react-pdf/renderer shows, as a reader copies it:
 * each page's text runs, their glyphs mapped back to letters through their
 * font's ToUnicode map, a line break after each run. A glyph the map has no
 * letter for reads as nothing, as it does in a PDF viewer. For tests: it reads
 * react-pdf's own output (Flate streams, Identity-H fonts, text as hex glyph
 * runs), not any PDF.
 */
export function pdfText(pdf: Uint8Array): string {
  const objects = pdfObjects(Buffer.from(pdf).toString('latin1'));
  const ref = (dict: string, key: string) => new RegExp(`/${key} (\\d+) 0 R`).exec(dict)?.[1];

  // Each font resource's glyph map (none for a built-in font: its codes are Latin-1).
  const fonts = new Map<string, Map<string, string> | null>();
  for (const { dict } of objects.values()) {
    const resources = /\/Font <<([^>]*)>>/.exec(dict)?.[1] ?? '';
    for (const [, name, id] of resources.matchAll(/\/(\S+) (\d+) 0 R/g)) {
      const cmap = ref(objects.get(id)?.dict ?? '', 'ToUnicode');
      fonts.set(name, cmap ? toUnicode(objects.get(cmap)?.stream ?? '') : null);
    }
  }

  const tree = [...objects.values()].find(({ dict }) => /\/Type \/Pages\b/.test(dict));
  const pages = /\/Kids \[([^\]]*)\]/.exec(tree?.dict ?? '')?.[1] ?? '';
  let text = '';
  for (const [, page] of pages.matchAll(/(\d+) 0 R/g)) {
    const content = objects.get(ref(objects.get(page)?.dict ?? '', 'Contents') ?? '')?.stream;
    let glyphs: Map<string, string> | null = null;
    for (const [, font, run, single] of (content ?? '').matchAll(
      /\/(\S+) [\d.]+ Tf|\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g,
    )) {
      if (font !== undefined) {
        glyphs = fonts.get(font) ?? null;
        continue;
      }
      for (const [, hex] of (run ?? `<${single}>`).matchAll(/<([0-9a-fA-F]*)>/g)) {
        const size = glyphs ? 4 : 2;
        for (let i = 0; i < hex.length; i += size) {
          const code = hex.slice(i, i + size).toLowerCase();
          text += glyphs ? (glyphs.get(code) ?? '') : String.fromCharCode(parseInt(code, 16));
        }
      }
      text += '\n';
    }
  }
  return text;
}

/** The PDF's objects by number: each one's dictionary, and its stream inflated. */
function pdfObjects(raw: string) {
  const objects = new Map<string, { dict: string; stream: string | null }>();
  const header = /(\d+) 0 obj\s*/g;
  for (let match = header.exec(raw); match; match = header.exec(raw)) {
    const from = header.lastIndex;
    const end = raw.indexOf('endobj', from);
    const stream = raw.indexOf('stream', from);
    if (stream === -1 || end < stream) {
      objects.set(match[1], { dict: raw.slice(from, end), stream: null });
      header.lastIndex = end;
      continue;
    }
    const dict = raw.slice(from, stream);
    const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0);
    const start = stream + 'stream'.length + (raw[stream + 6] === '\r' ? 2 : 1);
    const data = Buffer.from(raw.slice(start, start + length), 'latin1');
    objects.set(match[1], {
      dict,
      stream: (dict.includes('/FlateDecode') ? inflateSync(data) : data).toString('latin1'),
    });
    header.lastIndex = start + length;
  }
  return objects;
}

/** A ToUnicode CMap's glyph codes and the letters each one stands for (UTF-16BE hex). */
function toUnicode(cmap: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, block] of cmap.matchAll(/beginbfchar([^]*?)endbfchar/g)) {
    for (const [, code, letters] of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F ]*)>/g)) {
      const units = letters.replace(/ /g, '').match(/.{4}/g) ?? [];
      map.set(code.toLowerCase(), String.fromCharCode(...units.map((u) => parseInt(u, 16))));
    }
  }
  return map;
}
