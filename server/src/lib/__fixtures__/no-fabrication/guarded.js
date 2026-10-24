import * as cheerio from 'cheerio';
import { draftPassages, keepSuggestions } from '../../content-agent.js';
import { inputSources } from '../../content-inputs.js';
import { knownPeople } from '../../content-people.js';
import {
  htmlText,
  knownNumbers,
  numberSources,
  sourceWords,
  todayText,
} from '../../content-sources.js';
import { renderPage, sourcedPage } from '../../content-writer.js';

/**
 * The no-fabrication test set's answers as the Content Agent's runs keep
 * them (Quality spec §9), for no-fabrication.test.js and
 * eval-no-fabrication.js alike.
 */

/** What a run gives the guards, as fixWithRun and writeWithRun build it. */
export function sourcing(c) {
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
export const resolve = (numbered) => (s) => ({
  ...s,
  sources: s.sources.map((ref) =>
    ref.startsWith('@') ? (numbered.find((n) => n.ref === ref.slice(1))?.id ?? ref) : ref,
  ),
});

/** What suggestions leave on the page once kept: each one's words. */
export function guardedFix(c, suggestions, open = new Set(['dated'])) {
  const { numbered, known, people } = sourcing(c);
  return keepSuggestions(
    suggestions.map(resolve(numbered)),
    draftPassages(c.html),
    new Set(),
    open,
    null,
    { numbered, known, people },
  ).map((row) =>
    row.kind === 'replace'
      ? row.after_text
      : cheerio.load(row.after_text, null, false).root().text(),
  );
}

/** What a page written whole says once kept. */
export function guardedPage(c, page) {
  const { people, knownInPage } = sourcing(c);
  return cheerio
    .load(renderPage(sourcedPage(page, knownInPage, people)), null, false)
    .root()
    .text();
}

/** Text as compared: lower case, one kind of quote mark, single spaces. */
export const plain = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[“”„«»"]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** Every word the agent was given, as one text. */
function givenText(c) {
  const { numbered } = sourcing(c);
  return plain(
    [
      htmlText(c.html),
      c.title,
      c.brand.name,
      c.brand.industry,
      c.brand.description,
      ...numbered.map(sourceWords),
      ...c.authors.flatMap((a) => [a.name, a.title]),
    ].join('\n'),
  );
}

const CAPITALISED = /(?<!\p{L})\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+){1,2}(?!\p{L})/gu;
const QUOTED = /[“"„«»‚‘]([^“”"„«»‚‘’]{1,400})[”"“»«‘’]/gu;

/**
 * What a person should look over in a kept text, without the guards' cues:
 * every run of two or three capitalised words, and every quoted span of
 * four words or more, that the agent wasn't given. The guards read cues
 * ("says", "CEO", "Dr."): this reads none, so it shows what they miss.
 */
export function toReview(c, text) {
  const given = givenText(c);
  const spans = [
    ...[...text.matchAll(CAPITALISED)].map((m) => m[0]),
    ...[...text.matchAll(QUOTED)]
      // Its words, not the comma or stop kept inside the marks.
      .map((m) => m[1].trim().replace(/[\s,.;:!?…]+$/u, ''))
      .filter((inner) => inner.split(/\s+/).length >= 4),
  ];
  return [...new Set(spans.filter((span) => !given.includes(plain(span))))];
}
