/**
 * Merged competitors' names (00543), without the database: the names and
 * domains merged into a competitor, matched as its own from the merge on
 * (competitor-aliases.js reads them; response-parser.js matches them).
 */

/**
 * The brand's competitors with the names and domains merged into each:
 * `aliases` and `aliasDomains`, which response-parser.js matches as the
 * competitor's own, and `merged` (each with `since`, its merge time) for a
 * recount of older answers (competitorsAt).
 */
export function withMergedNames(competitors, mergedRows) {
  const byKept = new Map();
  for (const row of mergedRows || []) {
    if (!row?.merged_into_id) continue;
    const list = byKept.get(row.merged_into_id) ?? [];
    list.push({
      name: String(row.name ?? '').trim(),
      domain: String(row.domain ?? '').trim(),
      since: row.merged_at ?? null,
    });
    byKept.set(row.merged_into_id, list);
  }
  return (competitors || []).map((comp) => {
    const merged = byKept.get(comp.id) ?? [];
    return merged.length > 0 ? { ...comp, ...aliasesOf(merged), merged } : comp;
  });
}

/**
 * The competitors as an answer from `at` is counted: the names merged into a
 * competitor count for it only in answers from its merge on, so a recount of
 * an older answer counts the kept one by its own names, as it was counted.
 */
export function competitorsAt(competitors, at) {
  const when = at ? new Date(at).getTime() : NaN;
  return (competitors || []).map((comp) => {
    if (!Array.isArray(comp.merged) || comp.merged.length === 0) return comp;
    const merged = comp.merged.filter(
      (m) => !m.since || Number.isNaN(when) || when >= new Date(m.since).getTime(),
    );
    return { ...comp, ...aliasesOf(merged) };
  });
}

function aliasesOf(merged) {
  return {
    aliases: [...new Set(merged.map((m) => m.name).filter(Boolean))],
    aliasDomains: [...new Set(merged.map((m) => m.domain).filter(Boolean))],
  };
}
