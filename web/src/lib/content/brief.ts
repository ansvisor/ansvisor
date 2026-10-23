import { z } from 'zod';
import type { ContentBrief } from '@/types';
import {
  buildSourceGroups,
  readDraftDoc,
  type DraftSourceChoice,
  type DraftSourcesData,
} from '@/lib/content/sources';

/**
 * The editor's Brief tab (Content Editor CE-007, spec §10): what the page
 * should do — its goal, audience and length, and an outline whose H2s each
 * answer a search AI engines ran (a fan-out) on a platform. Rebuild outline
 * writes it from the sources kept in the Sources tab (server
 * content-brief.js); Edit brief changes it by hand. Stored in
 * content_drafts.brief (00212).
 */

export const BRIEF_ORIGINS = ['rebuild', 'edit', 'opportunity'] as const;
export type BriefOrigin = (typeof BRIEF_ORIGINS)[number];

export interface BriefSection {
  heading: string;
  keyPoints: string[];
  /** The fan-out the H2 answers, as the Sources tab lists it; null for none. */
  fanout: string | null;
  /** The platform key that ran it (perplexity-web, copilot-web…). */
  platform: string | null;
}

export interface DraftBrief {
  goal: string;
  audience: string;
  outline: BriefSection[];
  keywords: string[];
  origin: BriefOrigin;
  /** When Rebuild outline last wrote it. */
  builtAt: string | null;
  /** The sources it was built from, by group. */
  builtFrom: { prompts: number; fanouts: number; pages: number; queries: number } | null;
  /**
   * How long the cited pages are, in characters (the median of those read),
   * and how many were read when it was rebuilt (CE-030); null or absent when
   * none could be.
   */
  citedLength?: { characters: number; pages: number } | null;
}

/** Limits a brief keeps to, the server's (content-brief.js) and the column's (00212). */
export const MAX_BRIEF_SECTIONS = 12;
const text = (max: number) => z.string().trim().max(max);

export const draftBriefSchema = z.object({
  goal: text(500),
  audience: text(500),
  outline: z
    .array(
      z.object({
        heading: text(300).min(1),
        keyPoints: z.array(text(500).min(1)).max(8),
        fanout: text(300).nullable(),
        platform: text(60).nullable(),
      }),
    )
    .max(MAX_BRIEF_SECTIONS),
  keywords: z.array(text(80).min(1)).max(15),
  origin: z.enum(BRIEF_ORIGINS),
  builtAt: z.string().max(40).nullable(),
  builtFrom: z
    .object({
      prompts: z.number().int().min(0),
      fanouts: z.number().int().min(0),
      pages: z.number().int().min(0),
      queries: z.number().int().min(0),
    })
    .nullable(),
  citedLength: z
    .object({
      characters: z.number().int().min(0).max(1_000_000),
      pages: z.number().int().min(1).max(30),
    })
    .nullable()
    .optional(),
});

/** The brief of the opportunity a draft started from, until the draft has its own. */
export function briefFromOpportunity(brief: ContentBrief): DraftBrief {
  return {
    goal: brief.callToAction ?? '',
    audience: '',
    outline: (brief.outline ?? []).map((section) => ({
      heading: section.heading,
      keyPoints: section.keyPoints ?? [],
      fanout: null,
      platform: null,
    })),
    keywords: brief.targetKeywords ?? [],
    origin: 'opportunity',
    builtAt: null,
    builtFrom: null,
  };
}

/** What Rebuild outline sends the server: the sources kept, the page as written, its length. */
export interface RebuildSources {
  promptIds: string[];
  fanouts: { query: string; platforms: string[] }[];
  pages: { url: string; kind: string }[];
  queries: string[];
  headings: string[];
  length: number;
}

/** The most of each the agent takes (content-brief.js rebuildSources). */
export const REBUILD_LIMITS = {
  prompts: 100,
  fanouts: 40,
  pages: 30,
  queries: 20,
  headings: 30,
} as const;

/**
 * The sources a rebuild uses: the ones checked in the Sources tab, as it
 * lists them; the page's H2s and H3s as written now; and the length the
 * rules ask for.
 */
export function rebuildSources(
  data: DraftSourcesData,
  choices: DraftSourceChoice[],
  draft: { title: string; sourceUrl: string | null; html: string; length: number },
): RebuildSources {
  const groups = buildSourceGroups(data, choices, draft);
  const kept = (kind: string) =>
    groups.find((g) => g.kind === kind)?.rows.filter((r) => r.included) ?? [];
  // The server's limits (content-brief.js rebuildSources).
  return {
    promptIds: kept('prompt')
      .map((r) => r.ref)
      .slice(0, REBUILD_LIMITS.prompts),
    fanouts: kept('fanout')
      .flatMap((r) => (r.kind === 'fanout' ? [{ query: r.name, platforms: r.platforms }] : []))
      .slice(0, REBUILD_LIMITS.fanouts),
    pages: kept('cited_page')
      .flatMap((r) => (r.kind === 'cited_page' ? [{ url: r.name, kind: r.category }] : []))
      .slice(0, REBUILD_LIMITS.pages),
    queries: kept('gsc_query')
      .map((r) => r.name)
      .slice(0, REBUILD_LIMITS.queries),
    headings: readDraftDoc(draft.html)
      .headings.filter((h) => h.level > 1 && h.text)
      .map((h) => h.text)
      .slice(0, REBUILD_LIMITS.headings),
    length: draft.length,
  };
}

/** The sources a brief was built from, counted together. */
export function builtFromCount(brief: DraftBrief): number {
  const from = brief.builtFrom;
  return from ? from.prompts + from.fanouts + from.pages + from.queries : 0;
}
