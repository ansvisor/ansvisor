/**
 * Payload building shared by the definition library.
 *
 * Not a definition — the registry skips files starting with an underscore.
 *
 * Every action names its targets: the prompts, pages, sources, queries,
 * topics, platforms or competitors it is about. The specification is plain
 * about titles: "Recover 7 lost citations", not "Recover citations". So every
 * payload carries `targetEntity`, `targetCount` and a bounded `targets` list,
 * collected from the signals that triggered it and snapshotted at creation.
 *
 * Library detectors put targets on their signals directly. The original ones
 * predate that, so their targets are read off the fields they do carry.
 */

function legacyTargets(signal) {
  const p = signal.payload ?? {};
  if (Array.isArray(p.targets)) return p.targets;
  if (p.promptId) return [{ id: p.promptId, label: p.promptText ?? '' }];
  if (p.competitorName)
    return [{ id: p.competitorId ?? p.competitorName, label: p.competitorName }];
  if (p.landingPage) return [{ id: p.landingPage, label: p.landingPage }];
  if (Array.isArray(p.urls)) return p.urls.map((url) => ({ id: url, label: url }));
  if (p.platform) return [{ id: p.platform, label: p.platform }];
  return [];
}

/** Every target across the matched signals, once each. */
export function collectTargets(byKind) {
  const seen = new Map();
  for (const signals of byKind.values()) {
    for (const signal of signals) {
      for (const target of legacyTargets(signal)) {
        const key = String(target.id ?? target.label ?? '');
        if (key && !seen.has(key)) seen.set(key, target);
      }
    }
  }
  return [...seen.values()];
}

/**
 * The target half of every payload.
 *
 * `contentExists` tells the planner which branch of an `optimise | create`
 * plan to take: prompt targets carry whether a page is mapped to them or has
 * ever been cited. Where nothing says, it is left undefined and the planner
 * optimises what exists — the conservative choice, since creating a page
 * that duplicates one is worse than improving it.
 */
export function targetPayload(byKind, entity, extra = {}) {
  const targets = collectTargets(byKind);
  const mapped = targets.filter((t) => typeof t.mapped === 'boolean');
  return {
    targetEntity: entity,
    targetCount: targets.length,
    targets: targets.slice(0, 50),
    ...(mapped.length > 0 ? { contentExists: mapped.some((t) => t.mapped) } : {}),
    ...extra,
  };
}

/** The first matched signal, for payload fields that describe the whole
 *  condition rather than one target. */
export function first(byKind, kind) {
  return (byKind.get(kind) ?? [])[0] ?? null;
}

/** Competitor names across the matched signals, up to three. */
export function competitorNames(byKind) {
  const names = new Set();
  for (const signals of byKind.values()) {
    for (const signal of signals) {
      const name = signal.payload?.competitorName;
      if (name) names.add(name);
    }
  }
  return [...names].slice(0, 3);
}
