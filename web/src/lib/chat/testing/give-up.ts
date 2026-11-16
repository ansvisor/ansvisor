/**
 * Answers that give up on data Chat could have read (the owner's rule,
 * 2026-11-16): "I couldn't read it", "I couldn't reach it", "I hit the read
 * limit", "38 actions are missing", and their Turkish ("okuyamadım",
 * "ulaşamadım", "okuma sınırına takıldım", "38 aksiyon eksik"). Chat reads
 * the next page, looks the item up or narrows the read instead
 * (NEVER_GIVE_UP_RULES). Two cases may still say something isn't there:
 * "not found" after a direct lookup, and "can't access" or "hit the limit"
 * for a true refusal (plan, role, AI budget, a connection). Both evals'
 * `must` check (model-eval.ts, agent-eval.ts). Tests only.
 */

export interface GiveUpContext {
  /** The run looked the item up directly (by code, id, title, words, URL): "not found" may follow. */
  lookedUp?: boolean;
  /** The run was truly refused something (plan, role, AI budget, a connection, a feature off). */
  refused?: boolean;
}

/** Couldn't, wasn't able to, unable to, can't: the inability itself. */
const UNABLE = String.raw`(?:could(?:n['’]?t| not)|(?:was|were)(?:n['’]?t| not) able to|unable to|failed to|can(?:['’]?t|not)|am not able to|did(?:n['’]?t| not) manage to)`;
/** What it couldn't do to the data. */
const TO_DATA = String.raw`(?:fully\s+|all\s+of\s+)?(?:read|reach|access|load|fetch|retrieve|pull|see|open|get\s+(?:to|at))`;

/** Never, whatever the run did: the words of a run that stopped short. */
const ALWAYS: readonly [string, RegExp][] = [
  ['a read limit', /\b(?:read(?:ing)?|data|row|tool|fetch)[ -]limits?\b/i],
  ['"rows"', /\brows\b/i],
  [
    'a count of missing items',
    /\b\d+\b[^.\n]{0,40}?\b(?:are|were|is|was|remain|stay)?\s*(?:missing|left out|not shown|not included|cut off|omitted)\b|\bmissing\b[^.\n]{0,15}\b\d+\b/i,
  ],
  ['okuma sınırı', /okuma\s+sınır|sınırına\s+takıl|limit(?:in)?e\s+takıl|okuma\s+limit/i],
  // "eksik" about the data: a count of them, or data words; never "FAQ şeması eksik" on a page.
  [
    'eksik (about the data)',
    /\d+[^.\n]{0,30}\beksik\b|\beksik\b[^.\n]{0,15}\d+|\b(?:veri|aksiyon|sinyal|satır|kayıt|öğe|sonuç|liste|prompt)\w*\s+(?:\S+\s+){0,2}eksik\b/i,
  ],
];

/** Not unless the run was truly refused something: saying so is then right. */
const UNLESS_REFUSED: readonly [string, RegExp][] = [
  ["couldn't read, reach or access", new RegExp(String.raw`\b${UNABLE}\s+${TO_DATA}\b`, 'i')],
  ['hit the limit', /\b(?:hit|reached|ran into|ran out of|over)\b[^.\n]{0,20}\blimits?\b/i],
  [
    'okuyamadım, ulaşamadım, erişemedim',
    /okuya(?:ma|mı)|okunama|ulaşa(?:ma|mı)|erişe(?:me|mi)|erişim\s+sağlayama|göremiyorum|göremedim|yükleye(?:me|mi)/i,
  ],
];

/** Not before a direct lookup: "not found" is said only after one. */
const UNLESS_LOOKED_UP: readonly [string, RegExp][] = [
  [
    "couldn't find",
    new RegExp(
      String.raw`\b${UNABLE}\s+(?:find|locate)\b|\bdid(?:n['’]?t| not) find\b|\bnot found\b|\bno (?:such|matching)\b`,
      'i',
    ),
  ],
  ['bulamadım', /bulama|bulunama/i],
];

/** The give-up phrases a text holds, by name: empty when it reads on or says what it covers. */
export function giveUpPhrases(text: string, context: GiveUpContext = {}): string[] {
  const groups = [
    ALWAYS,
    context.refused ? [] : UNLESS_REFUSED,
    context.lookedUp ? [] : UNLESS_LOOKED_UP,
  ];
  return groups.flatMap((group) =>
    group.filter(([, pattern]) => pattern.test(text)).map(([name]) => name),
  );
}

/** A read's inputs that look one item up directly, rather than list a page. */
const LOOKUP_FIELDS = [
  'codes',
  'ids',
  'search',
  'id',
  'action_id',
  'signal_id',
  'draft_id',
  'audit_id',
  'prompt_id',
  'prompt_ids',
  'product_title',
  'url',
  'urls',
  'domain',
  'domains',
];

/** Whether a run's reads include a direct lookup, by their inputs. */
export function lookedUp(inputs: readonly Record<string, unknown>[]): boolean {
  return inputs.some((input) =>
    LOOKUP_FIELDS.some((field) => {
      const value = input[field];
      return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '';
    }),
  );
}
