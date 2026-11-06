import type { ImportFile } from './import';
import type { MarketplaceCleanup } from './marketplace';

/**
 * The Library's cleanup (CHAT-17 items 15–16, W4-18): the text a catalog
 * row's `cleanup` names (marketplace.ts), dropped from the skill's SKILL.md
 * before it is shown or added, so Chat never cites a competitor or a
 * paid-pack promo in customer content. Only the body is cleaned; the front
 * matter stays as it is. The original stays at its pinned commit on
 * GitHub, and what went is counted for "Edited by Ansvisor". The removed
 * text itself is never shown: it names the competitor, and the product
 * never does.
 *
 *   - research-lines: each line that cites the competitor's research;
 *   - extension-line: the competitor's `/seo` extension in a list of them;
 *   - promo-block: a paid-pack promo between community-cta markers.
 *
 * Pure: no database, no network.
 */

/** The competitor the cleanup drops, in lowercase: never shown in the product. */
const COMPETITOR = 'profound';

const RESEARCH_LINE = new RegExp(`^[^\\n]*\\b${COMPETITOR}\\b[^\\n]*(?:\\n|$)`, 'gim');
const EXTENSION = new RegExp(`\`/seo ${COMPETITOR}\`,?[ \\t]*`, 'gi');
const PROMO_BLOCK =
  /<!--\s*[\w-]*community-cta:start\s*-->[\s\S]*?<!--\s*[\w-]*community-cta:end\s*-->[ \t]*(?:\n|$)/g;

/** What one cleanup took out: the lines it removed or changed. */
export interface MarketplaceEdit {
  cleanup: MarketplaceCleanup;
  lines: number;
}

const linesIn = (text: string) => text.replace(/\n$/, '').split('\n').length;

/** One cleanup on the body: the body without it, and how many lines it touched. */
function clean(body: string, cleanup: MarketplaceCleanup): { body: string; lines: number } {
  let lines = 0;
  if (cleanup === 'research-lines') {
    const next = body.replace(RESEARCH_LINE, () => {
      lines += 1;
      return '';
    });
    return { body: next, lines };
  }
  if (cleanup === 'extension-line') {
    // Out of its line, so the sentence listing the others still reads.
    const next = body
      .split('\n')
      .map((line) => {
        const out = line.replace(EXTENSION, '');
        if (out !== line) lines += 1;
        return out;
      })
      .join('\n');
    return { body: next, lines };
  }
  const next = body.replace(PROMO_BLOCK, (block) => {
    lines += linesIn(block);
    return '';
  });
  return { body: next, lines };
}

/**
 * A SKILL.md with its row's cleanups applied to its body: the text, and
 * what each cleanup took out (one that found nothing is left out).
 */
export function cleanMarketplaceText(
  text: string,
  cleanups: readonly MarketplaceCleanup[] = [],
): { text: string; edits: MarketplaceEdit[] } {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (cleanups.length === 0) return { text: normalized, edits: [] };
  const front = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(normalized);
  const head = front ? front[0] : '';
  let body = normalized.slice(head.length);
  const edits: MarketplaceEdit[] = [];
  for (const cleanup of cleanups) {
    const done = clean(body, cleanup);
    body = done.body;
    if (done.lines > 0) edits.push({ cleanup, lines: done.lines });
  }
  return { text: head + body.replace(/\n{3,}/g, '\n\n'), edits };
}

/** "2 lines citing a competitor's research": an edit in the removed list's words (removed_json). */
export function editWords(edit: MarketplaceEdit): string {
  const lines = edit.lines === 1 ? '1 line' : `${edit.lines} lines`;
  if (edit.cleanup === 'research-lines') return `${lines} citing a competitor's research`;
  if (edit.cleanup === 'extension-line') return `a competitor's extension (${lines})`;
  return `a paid-pack promo (${lines})`;
}

/**
 * A catalog skill's files, as the GitHub reader hands them, with its
 * SKILL.md cleaned: the files and what was taken out.
 */
export function cleanMarketplaceFiles(
  files: readonly ImportFile[],
  cleanups: readonly MarketplaceCleanup[] = [],
): { files: ImportFile[]; edits: MarketplaceEdit[] } {
  let edits: MarketplaceEdit[] = [];
  const out = files.map((file) => {
    if (file.path !== 'SKILL.md' || !file.bytes || cleanups.length === 0) return file;
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
    } catch {
      // Not text: the import refuses it as it is.
      return file;
    }
    const cleaned = cleanMarketplaceText(text, cleanups);
    edits = cleaned.edits;
    return { path: file.path, bytes: new TextEncoder().encode(cleaned.text) };
  });
  return { files: out, edits };
}
