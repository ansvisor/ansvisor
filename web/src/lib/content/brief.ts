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

/**
 * The brief rules (2026) a brief plans with, from its version 2 (server
 * content-brief.js, behind CONTENT_BRIEF_RULES): each optional, so a brief
 * from before them reads as it was, and Edit brief keeps them.
 */
/** How a section is best shown: a table for a comparison, steps for a how-to… */
export const BRIEF_FORMATS = ['paragraphs', 'list', 'steps', 'table', 'faq'] as const;
export type BriefFormat = (typeof BRIEF_FORMATS)[number];
/** The kind of source a fact to state needs. */
export const FACT_SOURCES = ['statistic', 'study', 'quote', 'example', 'official'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];
/** Proof to gather: the brand's own, which AI can't find elsewhere. */
export const PROOF_KINDS = ['experience', 'data', 'case', 'test', 'screenshot', 'quote'] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

/** A fact a section states: what, the kind of source it needs, and its source's number (S1…) when one is given. */
export interface BriefFact {
  claim: string;
  source: FactSource;
  ref: string | null;
}

/** A page to link to: its address, the words to link, the section it goes in. */
export interface BriefLink {
  url: string;
  anchor: string;
  section: string | null;
}

export interface BriefSection {
  heading: string;
  keyPoints: string[];
  /** The fan-out the H2 answers, as the Sources tab lists it; null for none. */
  fanout: string | null;
  /** The platform key that ran it (perplexity-web, copilot-web…). */
  platform: string | null;
  /** What the section's first, direct answer must say (answer first). */
  answer?: string;
  format?: BriefFormat | null;
  facts?: BriefFact[];
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
  /** 2 once it plans with the brief rules (2026); absent before. */
  version?: 2;
  /** The page's essentials, for its top. */
  tldr?: string;
  /** What the page says that commodity pages don't. */
  angle?: string;
  /** The brand's own proof to gather; `have` when Brief › Your input has it. */
  proof?: { kind: ProofKind; what: string; have: boolean }[];
  /** Fan-outs kept out: another topic, for another page. */
  leftOut?: string[];
  freshness?: { datedPoint: string | null; checkedLine: boolean; yearInTitle: boolean } | null;
  /** Names as they are written: the brand, its products, the competitors given. */
  entities?: { brand: string; products: string[]; competitors: string[] } | null;
  links?: { internal: BriefLink[]; outbound: BriefLink[] } | null;
}

/** Limits a brief keeps to, the server's (content-brief.js) and the column's (00212). */
export const MAX_BRIEF_SECTIONS = 12;
const text = (max: number) => z.string().trim().max(max);

/**
 * Version 2's limits: the server cuts its brief to them (content-brief.js),
 * so a brief it saves is one the editor reads (a field past one hides the
 * brief). __fixtures__/brief-v2.json is the sample both sides test.
 */
export const BRIEF_V2_LIMITS = {
  answer: 400,
  facts: 4,
  claim: 300,
  ref: 10,
  tldr: 500,
  angle: 500,
  proof: 6,
  proofWhat: 300,
  leftOut: 20,
  leftOutQuery: 300,
  datedPoint: 300,
  entity: 120,
  entities: 10,
  internalLinks: 8,
  outboundLinks: 5,
  url: 2048,
  anchor: 120,
  linkSection: 300,
} as const;
const L = BRIEF_V2_LIMITS;

const linkSchema = z.object({
  url: text(L.url).min(1),
  anchor: text(L.anchor),
  section: text(L.linkSection).nullable(),
});

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
        answer: text(L.answer).optional(),
        format: z.enum(BRIEF_FORMATS).nullable().optional(),
        facts: z
          .array(
            z.object({
              claim: text(L.claim).min(1),
              source: z.enum(FACT_SOURCES),
              ref: text(L.ref).nullable(),
            }),
          )
          .max(L.facts)
          .optional(),
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
  version: z.literal(2).optional(),
  tldr: text(L.tldr).optional(),
  angle: text(L.angle).optional(),
  proof: z
    .array(
      z.object({
        kind: z.enum(PROOF_KINDS),
        what: text(L.proofWhat).min(1),
        have: z.boolean(),
      }),
    )
    .max(L.proof)
    .optional(),
  leftOut: z.array(text(L.leftOutQuery).min(1)).max(L.leftOut).optional(),
  freshness: z
    .object({
      datedPoint: text(L.datedPoint).nullable(),
      checkedLine: z.boolean(),
      yearInTitle: z.boolean(),
    })
    .nullable()
    .optional(),
  entities: z
    .object({
      brand: text(L.entity),
      products: z.array(text(L.entity).min(1)).max(L.entities),
      competitors: z.array(text(L.entity).min(1)).max(L.entities),
    })
    .nullable()
    .optional(),
  links: z
    .object({
      internal: z.array(linkSchema).max(L.internalLinks),
      outbound: z.array(linkSchema).max(L.outboundLinks),
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
