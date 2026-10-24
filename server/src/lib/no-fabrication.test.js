import { existsSync, readFileSync } from 'fs';
import * as cheerio from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import { CASES } from './__fixtures__/no-fabrication/cases.js';

/**
 * No invented people, quotes or numbers (Content Editor Quality spec §9):
 * the Content Agent's answers on 54 drafts (cases.js) go through the guards
 * as its runs put them (keepSuggestions for its suggestions, sourcedPage
 * for a page it writes whole), with what it was given: the page, the
 * brand, the authors, the Sources tab's data and Brief › Your input. None
 * of what it made up may survive, and none of what it was given may be
 * taken out. Answers recorded from the model (eval-no-fabrication.js) are
 * read the same way: the guards must find nothing left to take out of what
 * they let through.
 */

vi.mock('../config/supabase.js', () => ({ default: {} }));

const { draftPassages, keepSuggestions } = await import('./content-agent.js');
const { inputSources } = await import('./content-inputs.js');
const { knownPeople, peopleEdits } = await import('./content-people.js');
const { addedNumbers, htmlText, knownNumbers, numberSources, sourceWords, todayText } =
  await import('./content-sources.js');
const { renderPage, sourcedPage } = await import('./content-writer.js');

/** What a run gives the guards, as fixWithRun and writeWithRun build it. */
function sourcing(c) {
  const numbered = numberSources({
    prompts: c.prompts,
    fanouts: c.fanouts,
    inputs: inputSources(c.inputs, c.brand.name),
  });
  const given = [htmlText(c.html), c.title, c.brand.name, c.brand.industry, c.brand.description];
  const known = knownNumbers(...given, todayText());
  const people = knownPeople(
    ...given,
    ...numbered.map(sourceWords),
    // As authorWords reads Settings › Authors.
    ...c.authors.flatMap((a) => [a.name, a.title]),
  );
  const knownInPage = new Set([...known, ...knownNumbers(...numbered.map(sourceWords))]);
  return { numbered, known, people, knownInPage };
}

/** A suggestion's sources as the agent names them: the person's data by its number. */
const resolve = (numbered) => (s) => ({
  ...s,
  sources: s.sources.map((ref) =>
    ref.startsWith('@') ? (numbered.find((n) => n.ref === ref.slice(1))?.id ?? ref) : ref,
  ),
});

/** Text as compared: lower case, one kind of quote mark, single spaces. */
const plain = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[“”„«»"]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** What the agent's suggestions leave on the page, and what a page it writes says. */
function outputs(c) {
  const { numbered, known, people, knownInPage } = sourcing(c);
  const rows = keepSuggestions(
    c.fix.map(resolve(numbered)),
    draftPassages(c.html),
    new Set(),
    new Set(['dated']),
    null,
    { numbered, known, people },
  );
  const fix = rows
    .map((row) =>
      row.kind === 'replace'
        ? row.after_text
        : cheerio.load(row.after_text, null, false).root().text(),
    )
    .join('\n');
  const page = cheerio
    .load(renderPage(sourcedPage(c.page, knownInPage, people)), null, false)
    .root()
    .text();
  return { fix, page };
}

describe('the no-fabrication test set', () => {
  it('holds 50 drafts at least, of each site type and language', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    expect(new Set(CASES.map((c) => c.siteType))).toEqual(new Set(['b2b', 'b2c', 'ecommerce']));
    expect(new Set(CASES.map((c) => c.language))).toEqual(new Set(['en', 'tr', 'de']));
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  it('drops a suggestion only for a figure it made up: the rest reach the guards', () => {
    const dropped = [];
    for (const c of CASES) {
      const { numbered, known, people } = sourcing(c);
      for (const s of c.fix.map(resolve(numbered))) {
        const kept = keepSuggestions(
          [s],
          draftPassages(c.html),
          new Set(),
          new Set(['dated']),
          null,
          {
            numbered,
            known,
            people,
          },
        );
        const madeUpFigure = c.invented.some((item) => /\d/.test(item) && s.after.includes(item));
        if (!kept.length && !madeUpFigure) dropped.push(`${c.id}: ${s.kind} on ${s.passage}`);
      }
    }
    expect(dropped).toEqual([]);
  });

  it('lets nothing the agent made up through, and takes out nothing it was given', () => {
    const survivors = [];
    const lost = [];
    for (const c of CASES) {
      const out = outputs(c);
      for (const [path, text] of Object.entries(out)) {
        for (const item of c.invented) {
          if (plain(text).includes(plain(item))) survivors.push(`${c.id} (${path}): ${item}`);
        }
        for (const item of c.kept[path]) {
          if (!plain(text).includes(plain(item))) lost.push(`${c.id} (${path}): ${item}`);
        }
      }
    }
    expect(survivors).toEqual([]);
    expect(lost).toEqual([]);
  });

  // The model's own answers, once recorded (not in CI: it needs a model's key).
  const recordedPath = new URL('./__fixtures__/no-fabrication/recorded.json', import.meta.url);
  it.skipIf(!existsSync(recordedPath))(
    "leaves no figure, name or quote in the model's own answers it wasn't given",
    () => {
      const recorded = JSON.parse(readFileSync(recordedPath, 'utf8'));
      const survivors = [];
      let read = 0;
      for (const c of CASES) {
        const answer = recorded[c.id];
        if (!answer) continue;
        read += 1;
        const { numbered, known, people, knownInPage } = sourcing(c);
        const rows = keepSuggestions(
          answer.fix ?? [],
          draftPassages(c.html),
          new Set(),
          new Set(['dated', 'expert', 'example']),
          null,
          { numbered, known, people },
        );
        const fix = rows.map((row) =>
          row.kind === 'replace'
            ? row.after_text
            : cheerio.load(row.after_text, null, false).root().text(),
        );
        const page = answer.page
          ? cheerio
              .load(renderPage(sourcedPage(answer.page, knownInPage, people)), null, false)
              .root()
              .text()
          : '';
        // What the guards would still take out of what they let through:
        // nothing, or something got past them.
        for (const text of [...fix, page]) {
          for (const n of addedNumbers(text, knownInPage)) {
            survivors.push(`${c.id}: figure ${text.slice(n.start, n.end)}`);
          }
          for (const e of peopleEdits(text, people)) {
            survivors.push(`${c.id}: ${text.slice(e.start, e.end)}`);
          }
        }
      }
      expect(read).toBeGreaterThan(0);
      expect(survivors).toEqual([]);
    },
  );
});
