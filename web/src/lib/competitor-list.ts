/** A competitor on the brand-setup competitor step, suggested or typed in. */
export interface CompetitorChoice {
  name: string;
  domain: string;
  selected: boolean;
}

/** Same cleanup addCompetitor applies before saving. */
export function normalizeCompetitorDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

function domainKey(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

/**
 * Add a typed competitor to the step's list. One already listed — same
 * domain, or same name when either side has no domain — is selected instead
 * of added twice, and returned as `duplicate` so the caller can say so.
 */
export function addCompetitorChoice(
  list: CompetitorChoice[],
  rawName: string,
  rawDomain: string,
): { list: CompetitorChoice[]; duplicate: CompetitorChoice | null } {
  const name = rawName.trim();
  if (!name) return { list, duplicate: null };
  const domain = normalizeCompetitorDomain(rawDomain);

  const index = list.findIndex((c) =>
    domain && c.domain
      ? domainKey(c.domain) === domainKey(domain)
      : c.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (index !== -1) {
    const duplicate = list[index];
    return {
      list: list.map((c, i) => (i === index ? { ...c, selected: true } : c)),
      duplicate,
    };
  }
  return { list: [...list, { name, domain, selected: true }], duplicate: null };
}
