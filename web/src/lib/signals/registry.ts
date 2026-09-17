/**
 * The signal registry — static product knowledge about every detector kind
 * the Signals page can render. The database stores what gets filtered and
 * aggregated (category, impact, status, source, values, payload); this file
 * owns how a kind is DISPLAYED: which i18n templates compose its title and
 * description, and the short state word the Type column shows under the
 * category.
 *
 * The server-side twin (server/src/lib/signals/record.js KIND_META) owns
 * what gets stored. Adding a detector means touching both, and neither
 * takes a migration.
 */

export type SignalCategory =
  | 'visibility'
  | 'citation'
  | 'mention'
  | 'traffic'
  | 'technical'
  | 'competitor';

export type SignalImpact = 'high' | 'medium' | 'low';

export type SignalStatus = 'new' | 'acknowledged' | 'resolved' | 'dismissed';

export type SignalKind =
  | 'sharp_drop'
  | 'visibility_slipping'
  | 'prompt_gain'
  | 'new_engine'
  | 'lost_citations'
  | 'first_citation'
  | 'competitor_surge'
  | 'competitor_crossed'
  | 'competitor_overtaken'
  | 'page_opportunity'
  | 'uncited_mentions'
  | 'audit_low_score';

export const SIGNAL_CATEGORIES: readonly SignalCategory[] = [
  'visibility',
  'citation',
  'mention',
  'traffic',
  'technical',
  'competitor',
];

export const SIGNAL_STATUSES: readonly SignalStatus[] = [
  'new',
  'acknowledged',
  'resolved',
  'dismissed',
];

export const SIGNAL_IMPACTS: readonly SignalImpact[] = ['high', 'medium', 'low'];

/** Data sources a signal row can carry (the `source` array's vocabulary). */
export const SIGNAL_SOURCES = ['ai_results', 'ga4', 'gsc', 'site_audit'] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export interface SignalKindMeta {
  kind: SignalKind;
  /** i18n key under actionCenter.signalKinds.<key> for the Type column's
   *  state word (Dropped, Lost, Gained, Opportunity…). */
  stateKey:
    | 'dropped'
    | 'gained'
    | 'lost'
    | 'opportunity'
    | 'gain'
    | 'overtaken'
    | 'crossed'
    | 'uncited'
    | 'slipping'
    | 'issue';
  /** Whether the change arrow, when change_value is present, is good news. */
  positive: boolean;
}

export const SIGNAL_KINDS: Record<SignalKind, SignalKindMeta> = {
  sharp_drop: { kind: 'sharp_drop', stateKey: 'dropped', positive: false },
  visibility_slipping: { kind: 'visibility_slipping', stateKey: 'slipping', positive: false },
  prompt_gain: { kind: 'prompt_gain', stateKey: 'gained', positive: true },
  new_engine: { kind: 'new_engine', stateKey: 'gained', positive: true },
  lost_citations: { kind: 'lost_citations', stateKey: 'lost', positive: false },
  first_citation: { kind: 'first_citation', stateKey: 'gained', positive: true },
  competitor_surge: { kind: 'competitor_surge', stateKey: 'gain', positive: false },
  competitor_crossed: { kind: 'competitor_crossed', stateKey: 'crossed', positive: false },
  competitor_overtaken: { kind: 'competitor_overtaken', stateKey: 'overtaken', positive: true },
  page_opportunity: { kind: 'page_opportunity', stateKey: 'opportunity', positive: true },
  uncited_mentions: { kind: 'uncited_mentions', stateKey: 'uncited', positive: false },
  audit_low_score: { kind: 'audit_low_score', stateKey: 'issue', positive: false },
};

export function isSignalKind(value: string): value is SignalKind {
  return value in SIGNAL_KINDS;
}
