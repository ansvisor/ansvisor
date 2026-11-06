/**
 * An action's play (AC-ACTION-PLAN-BY-BUSINESS-TYPE spec §5, P-2): the page
 * the API's chooser (server/src/lib/action-center/playbooks.js) picked when
 * G15, G16 or C09 opened it, with the measured reasons and the plays next
 * worth doing. Read defensively from the payload: a play the web has no
 * words for, or a reason it can't read, is left out.
 */

import { SITE_TYPES, type SiteType } from '@/lib/content/page-types';

/** The plays the chooser picks today, as playbooks.js lists them (PLAYS). */
export const PLAY_IDS = ['comparison', 'best_of', 'guide', 'definition'] as const;
export type PlayId = (typeof PLAY_IDS)[number];

/** Why the play: how many of the prompts ask for it, and their share of the AI searches. */
export interface PlayReason {
  kind: 'intent';
  prompts: number;
  of: number;
  /** 0–1. */
  share: number;
}

export interface PlayOption {
  id: PlayId;
  assetType: string;
  prompts: number;
  of: number;
  share: number;
}

export interface ActionPlay {
  id: PlayId;
  assetType: string;
  /** The brand's kind of site when it was picked. */
  siteType: SiteType;
  reasons: PlayReason[];
  /** Up to two more worth doing for the same prompts. */
  supporting: PlayOption[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
const share = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const isPlayId = (value: unknown): value is PlayId =>
  typeof value === 'string' && (PLAY_IDS as readonly string[]).includes(value);

function optionOf(value: unknown): PlayOption | null {
  if (!isRecord(value) || !isPlayId(value.id) || typeof value.assetType !== 'string') return null;
  const prompts = count(value.prompts);
  const of = count(value.of);
  const part = share(value.share);
  if (prompts === null || of === null || part === null) return null;
  return { id: value.id, assetType: value.assetType, prompts, of, share: part };
}

function reasonOf(value: unknown): PlayReason | null {
  if (!isRecord(value) || value.kind !== 'intent') return null;
  const prompts = count(value.prompts);
  const of = count(value.of);
  const part = share(value.share);
  if (prompts === null || of === null || part === null) return null;
  return { kind: 'intent', prompts, of, share: part };
}

/** The action's play, or null when it has none the web can show. */
export function actionPlay(payload: Record<string, unknown> | null | undefined): ActionPlay | null {
  const play = payload?.play;
  if (!isRecord(play) || !isPlayId(play.id) || typeof play.assetType !== 'string') return null;
  const siteType = (SITE_TYPES as readonly unknown[]).includes(play.siteType)
    ? (play.siteType as SiteType)
    : 'b2b';
  return {
    id: play.id,
    assetType: play.assetType,
    siteType,
    reasons: (Array.isArray(play.reasons) ? play.reasons : [])
      .map(reasonOf)
      .filter((reason): reason is PlayReason => reason !== null),
    supporting: (Array.isArray(play.supporting) ? play.supporting : [])
      .map(optionOf)
      .filter((option): option is PlayOption => option !== null)
      .slice(0, 2),
  };
}
