'use server';

import { z } from 'zod';
import { API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/server';
import { readAssignees } from '@/lib/action-center/assignees';
import {
  DRAFT_STATUSES,
  PAGE_TYPES,
  type ContentDraft,
  type ContentDraftListItem,
  type ContentOverlap,
  type DraftMethod,
  type DraftStart,
  type DraftStartOptions,
  type DraftStatus,
  type ImportedPage,
  type PageImportError,
  type PageType,
  PAGE_IMPORT_ERRORS,
} from '@/lib/content/drafts';
import { escapeHtml } from '@/lib/content/attachments';
import { IMPACT_PERIODS, type ContentImpact, type ContentResults } from '@/lib/content/impact';
import {
  MAX_BODY_HTML_LENGTH,
  MAX_TITLE_LENGTH,
  bodyHash,
  type SaveDraftResult,
} from '@/lib/content/editor';
import { detectPageType, siteTypeOf, type SiteType } from '@/lib/content/page-types';
import { sanitizeDraftHtml } from '@/lib/content/sanitize-draft-html';
import {
  DRAFT_SOURCE_KINDS,
  SOURCES_DAYS,
  normalizeQuery,
  type DraftSourceChoice,
  type DraftSourceKind,
  type DraftSourcesData,
} from '@/lib/content/sources';

/**
 * Content drafts (Content Editor, CE-002), read through the signed-in member's
 * session: RLS (00204) keeps them to the brand's organization.
 */

/** How many drafts the Library lists, the latest changed first. */
const LIBRARY_LIMIT = 500;

/** The brand's drafts for the Library, with who started each. */
export async function getContentDrafts(brandId: string): Promise<ContentDraftListItem[]> {
  const supabase = await createClient();
  const [userRes, draftsRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('content_drafts')
      .select(
        'id, title, page_type, method, status, author, created_by, score_before, score_after, updated_at',
      )
      .eq('brand_id', brandId)
      .order('updated_at', { ascending: false })
      .limit(LIBRARY_LIMIT),
  ]);
  if (draftsRes.error) throw new Error(draftsRes.error.message);
  const rows = draftsRes.data ?? [];
  const me = userRes.data.user?.id ?? null;

  // A profile is readable only by its owner, so other members are named
  // through the same reader as Action Center's assignees.
  const people = await readAssignees(
    supabase,
    brandId,
    rows.flatMap((row) => (row.created_by ? [row.created_by] : [])),
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    pageType: row.page_type,
    method: row.method as DraftMethod,
    status: draftStatus(row.status),
    author: row.author === 'agent' ? 'agent' : 'user',
    createdBy: row.created_by ? (people.get(row.created_by) ?? null) : null,
    isMine: me !== null && row.created_by === me,
    scoreBefore: row.score_before,
    scoreAfter: row.score_after,
    updatedAt: row.updated_at,
  }));
}

function draftStatus(value: string): DraftStatus {
  return (DRAFT_STATUSES as readonly string[]).includes(value) ? (value as DraftStatus) : 'draft';
}

const draftId = z.guid();

/** What a draft row embeds of its brand: enough to know its site type. */
const BRAND_SITE = 'brands(site_type, industry, shopping_mode_enabled)';

function brandSiteType(
  brand: {
    site_type: string | null;
    industry: string | null;
    shopping_mode_enabled: boolean;
  } | null,
): SiteType {
  return siteTypeOf({
    siteType: brand?.site_type,
    industry: brand?.industry,
    shoppingModeEnabled: brand?.shopping_mode_enabled,
  });
}

/** One draft for the editor (CE-004), or null when it isn't the member's to read. */
export async function getContentDraft(id: string): Promise<ContentDraft | null> {
  if (!draftId.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .select(
      `id, brand_id, title, page_type, page_type_source, method, status, body_html, author, source_url, updated_at, ${BRAND_SITE}`,
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    brandId: data.brand_id,
    title: data.title,
    pageType: data.page_type,
    pageTypeSource: data.page_type_source === 'user' ? 'user' : 'detected',
    siteType: brandSiteType(data.brands),
    sourceUrl: data.source_url,
    method: data.method as DraftMethod,
    status: draftStatus(data.status),
    bodyHtml: data.body_html,
    author: data.author === 'agent' ? 'agent' : 'user',
    updatedAt: data.updated_at,
  };
}

/** Opportunities still open to write for, the highest scored first. */
const OPEN_OPPORTUNITY_STATUSES = ['new', 'reviewed', 'sent', 'in_progress'];

/** How many of each New content lists to pick from. */
const START_LIMIT = 500;

/**
 * What New content (CE-003) offers to start a new page from: the brand's
 * open Content Opportunities, its active tracked prompts and its topics.
 */
export async function getContentStartOptions(brandId: string): Promise<DraftStartOptions> {
  const supabase = await createClient();
  const [opportunities, prompts, topics] = await Promise.all([
    supabase
      .from('content_opportunities')
      .select('id, title, decision, brief')
      .eq('brand_id', brandId)
      .in('status', OPEN_OPPORTUNITY_STATUSES)
      .order('opportunity_score', { ascending: false, nullsFirst: false })
      .limit(START_LIMIT),
    supabase
      .from('prompts')
      .select('id, text, topic_id, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId)
      .eq('is_active', true)
      .order('text')
      .limit(START_LIMIT),
    supabase
      .from('topics')
      .select('id, name')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .order('name'),
  ]);
  const failed = opportunities.error ?? prompts.error ?? topics.error;
  if (failed) throw new Error(failed.message);

  const perTopic = new Map<string, number>();
  for (const p of prompts.data ?? []) {
    if (p.topic_id) perTopic.set(p.topic_id, (perTopic.get(p.topic_id) ?? 0) + 1);
  }
  return {
    opportunities: (opportunities.data ?? []).map((o) => {
      const suggested = (o.brief as { suggestedTitle?: unknown } | null)?.suggestedTitle;
      return {
        id: o.id,
        title: o.title,
        decision: o.decision,
        pageTitle: typeof suggested === 'string' && suggested.trim() ? suggested.trim() : null,
      };
    }),
    prompts: (prompts.data ?? []).map((p) => ({ id: p.id, text: p.text })),
    // A topic with no active prompt has nothing for a page to answer.
    topics: (topics.data ?? [])
      .map((topic) => ({
        id: topic.id,
        name: topic.name,
        promptCount: perTopic.get(topic.id) ?? 0,
      }))
      .filter((topic) => topic.promptCount > 0),
  };
}

const startInput = z.object({
  method: z.enum(['create', 'optimize']),
  // A prompt's text can run longer than a title: cut to fit, not refused.
  title: z.string().max(5_000),
  pageType: z.enum(PAGE_TYPES),
  typePicked: z.boolean().default(false),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(['opportunity', 'prompt', 'topic']), id: z.guid() }),
    z.object({ kind: z.literal('content') }),
  ]),
  bodyHtml: z.string().max(MAX_BODY_HTML_LENGTH).optional(),
  sourceUrl: z
    .string()
    .max(2048)
    .regex(/^https?:\/\//i)
    .optional(),
});

/** The most prompt ids a draft keeps (00206). */
const MAX_DRAFT_PROMPTS = 500;

/**
 * The tracked prompts a page started from this source should answer: an
 * opportunity's (its clusters', or its one prompt), the prompt picked, or a
 * topic's active prompts. Throws 'not_found' for one the member can't read.
 */
async function promptsFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  source: DraftStart['source'],
): Promise<{ promptIds: string[]; opportunityId: string | null }> {
  if (source.kind === 'content') return { promptIds: [], opportunityId: null };

  if (source.kind === 'opportunity') {
    const { data, error } = await supabase
      .from('content_opportunities')
      .select('id, prompt_id, cluster_id, related_cluster_ids')
      .eq('id', source.id)
      .eq('brand_id', brandId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('not_found');
    const clusterIds = [data.cluster_id, ...(data.related_cluster_ids ?? [])].filter(
      (id): id is string => typeof id === 'string',
    );
    if (!clusterIds.length) {
      return { promptIds: data.prompt_id ? [data.prompt_id] : [], opportunityId: data.id };
    }
    const members = await supabase
      .from('prompt_cluster_members')
      .select('prompt_id')
      .in('cluster_id', clusterIds)
      .limit(MAX_DRAFT_PROMPTS);
    if (members.error) throw new Error(members.error.message);
    return { promptIds: (members.data ?? []).map((m) => m.prompt_id), opportunityId: data.id };
  }

  const query = supabase
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId);
  if (source.kind === 'prompt') {
    const { data, error } = await query.eq('id', source.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('not_found');
    return { promptIds: [data.id], opportunityId: null };
  }
  const { data, error } = await query
    .eq('topic_id', source.id)
    .eq('is_active', true)
    .limit(MAX_DRAFT_PROMPTS);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('not_found');
  return { promptIds: data.map((p) => p.id), opportunityId: null };
}

/**
 * A page of the brand's, read for Optimize content › Page URL and for
 * Start's "Optimize this page instead" (CE-003): its main content, title and
 * schema, through the API's guarded fetch, which reads only the brand's own
 * domains and never a private address. A page that can't be read comes back
 * as the reason, not a throw: production hides a server action's errors.
 */
export async function importContentPage(
  brandId: string,
  url: string,
): Promise<{ page: ImportedPage } | { error: PageImportError; status?: number }> {
  if (!draftId.safeParse(brandId).success || !url.trim() || url.length > 2048) {
    return { error: 'invalid_url' };
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-pages/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId, url: url.trim() }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = body.code as PageImportError;
      return {
        error: (PAGE_IMPORT_ERRORS as readonly string[]).includes(code) ? code : 'failed',
        ...(typeof body.status === 'number' && { status: body.status }),
      };
    }
    return {
      page: {
        url: String(body.url),
        title: String(body.title ?? ''),
        html: String(body.html ?? ''),
      },
    };
  } catch (err) {
    console.error('Failed to import a page:', err);
    return { error: 'failed' };
  }
}

/**
 * "Team" in Start (CE-015): the draft sent to the Action Center as an action
 * for someone on the team to write (the API's from-content-draft.js), or the
 * one still open if it was sent already. Returned, not thrown: production
 * hides a server action's errors.
 */
export async function sendContentDraftToActionCenter(
  brandId: string,
  id: string,
): Promise<{ actionId: string; actionNo: number; created: boolean } | { error: string }> {
  if (!draftId.safeParse(brandId).success || !draftId.safeParse(id).success) {
    return { error: 'invalid' };
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/action-center/content-drafts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId, draftId: id }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { error: String(body.details || body.error || `Server error: ${res.status}`) };
    }
    return {
      actionId: String(body.actionId),
      actionNo: Number(body.actionNo),
      created: Boolean(body.created),
    };
  } catch (err) {
    console.error('Failed to send a draft to the Action Center:', err);
    return { error: 'failed' };
  }
}

/**
 * The Impact tab (CE-016): what the page a draft optimizes earns over the
 * last `days` against the `days` before (content_page_impact, 00209). Null
 * when the member can't read the brand.
 */
export async function getContentImpact(
  brandId: string,
  page: string,
  days: number,
): Promise<ContentImpact | null> {
  if (!impactArgsValid(brandId, page, days)) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('content_page_impact', {
    p_brand_id: brandId,
    p_page: page,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return (data as ContentImpact | null) ?? null;
}

/**
 * The Impact tab's results from AI visits (CE-016): the page's AI visits per
 * AI source over the last `days`, with Google Analytics' key events,
 * purchases and revenue from them (content_page_results, 00210). Null when
 * the member can't read the brand.
 */
export async function getContentResults(
  brandId: string,
  page: string,
  days: number,
): Promise<ContentResults | null> {
  if (!impactArgsValid(brandId, page, days)) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('content_page_results', {
    p_brand_id: brandId,
    p_page: page,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return (data as ContentResults | null) ?? null;
}

/** A brand id, a period the tab offers and a web page's address. */
function impactArgsValid(brandId: string, page: string, days: number): boolean {
  return (
    draftId.safeParse(brandId).success &&
    (IMPACT_PERIODS as readonly number[]).includes(days) &&
    /^https?:\/\//i.test(page)
  );
}

const overlapSource = startInput.shape.source;

/**
 * Start's overlap check (CE-015): the brand's own pages AI cites for the
 * prompts a page started from this source would answer (00207), with prompts
 * in common, citations and Google position. Nothing to check for content
 * brought to optimize: it has no prompts yet.
 */
export async function getContentOverlap(
  brandId: string,
  source: DraftStart['source'],
): Promise<ContentOverlap> {
  const parsed = overlapSource.safeParse(source);
  if (!draftId.safeParse(brandId).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const { promptIds } = await promptsFor(supabase, brandId, parsed.data);
  const prompts = [...new Set(promptIds)];
  if (!prompts.length) return { totalPrompts: 0, pages: [] };
  const { data, error } = await supabase.rpc('content_page_overlap', {
    p_brand_id: brandId,
    p_prompt_ids: prompts,
  });
  if (error) throw new Error(error.message);
  return {
    totalPrompts: prompts.length,
    pages: (data ?? []).map((row) => ({
      url: row.page,
      title: row.title,
      promptsInCommon: row.prompts_in_common,
      citations: Number(row.citations),
      gscPosition: row.gsc_position === null ? null : Number(row.gsc_position),
    })),
  };
}

/**
 * A draft started from New content and Start (CE-003, CE-015), by the
 * signed-in member: its page type, what it is for, and its first text. A new
 * page, or an existing one Start chose to optimize, starts with its title as
 * the H1; content brought to optimize is checked against the draft
 * allow-list, as a save is. A type the person picked stays; Start's guess is
 * stored as detected, so it follows the page (CE-023).
 */
export async function createContentDraft(brandId: string, start: DraftStart): Promise<string> {
  const parsed = startInput.safeParse(start);
  if (!draftId.safeParse(brandId).success || !parsed.success) throw new Error('invalid');
  const { method, pageType, typePicked, source, bodyHtml, sourceUrl } = parsed.data;
  const title = parsed.data.title.trim().slice(0, MAX_TITLE_LENGTH).trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
  const { promptIds, opportunityId } = await promptsFor(supabase, brandId, source);

  const { data, error } = await supabase
    .from('content_drafts')
    .insert({
      brand_id: brandId,
      created_by: user.id,
      method,
      title,
      page_type: pageType,
      page_type_source: typePicked ? 'user' : 'detected',
      body_html:
        bodyHtml !== undefined
          ? sanitizeDraftHtml(bodyHtml)
          : title
            ? `<h1>${escapeHtml(title)}</h1>`
            : '',
      opportunity_id: opportunityId,
      source_url: sourceUrl ?? null,
      prompt_ids: [...new Set(promptIds)].slice(0, MAX_DRAFT_PROMPTS),
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

const saveInput = z.object({
  title: z.string().max(MAX_TITLE_LENGTH),
  bodyHtml: z.string(),
  base: z.object({
    updatedAt: z.string().min(1),
    bodyHash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
});

/** Saves that find the draft written meanwhile, then try again over it. */
const SAVE_ATTEMPTS = 3;

/**
 * The editor's autosave: the body, checked against the draft allow-list
 * again (sanitizeDraftHtml), and the title read from it, written only over
 * the version the editor last saw (`base`). When another write came first,
 * the page tells which kind: the same page means only the draft's other
 * columns changed (Mark ready, its type), and the save goes over them;
 * another page means someone else changed it (another tab, a teammate, the
 * Content Agent), and nothing is overwritten. A save RLS refused, or of a
 * draft that no longer exists, comes back not_found rather than saved.
 *
 * Until a person picks the page type, it follows the page (CE-023): detected
 * again from what was saved, and written only while it is still detected, so
 * a pick made meanwhile stays. That second write makes the version the
 * editor goes on from.
 */
export async function saveContentDraft(
  id: string,
  input: { title: string; bodyHtml: string; base: { updatedAt: string; bodyHash: string } },
): Promise<SaveDraftResult> {
  if (typeof input?.bodyHtml === 'string' && input.bodyHtml.length > MAX_BODY_HTML_LENGTH) {
    return { ok: false, reason: 'too_large' };
  }
  const parsed = saveInput.safeParse(input);
  if (!draftId.safeParse(id).success || !parsed.success) return { ok: false, reason: 'invalid' };
  const { title, base } = parsed.data;
  const bodyHtml = sanitizeDraftHtml(parsed.data.bodyHtml);
  const supabase = await createClient();
  let expected = base.updatedAt;
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from('content_drafts')
      .update({ title, body_html: bodyHtml })
      .eq('id', id)
      .eq('updated_at', expected)
      .select(`updated_at, page_type, page_type_source, ${BRAND_SITE}`)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      let updatedAt: string = data.updated_at;
      if (data.page_type_source === 'detected') {
        const detected = detectPageType({ title, html: bodyHtml }, brandSiteType(data.brands));
        // A page that shows no type keeps the one it had (Start's guess).
        if (detected && detected !== data.page_type) {
          const { data: typed, error: typeError } = await supabase
            .from('content_drafts')
            .update({ page_type: detected })
            .eq('id', id)
            .eq('page_type_source', 'detected')
            .select('updated_at')
            .maybeSingle();
          // The page is saved; its type catches up on the next save.
          if (typeError) {
            console.error('Failed to update the detected page type:', typeError.message);
          } else if (typed) {
            updatedAt = typed.updated_at;
          }
        }
      }
      return { ok: true, updatedAt, bodyHash: await bodyHash(bodyHtml) };
    }

    const { data: current, error: readError } = await supabase
      .from('content_drafts')
      .select('updated_at, body_html')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) return { ok: false, reason: 'not_found' };
    if ((await bodyHash(current.body_html)) !== base.bodyHash) {
      return { ok: false, reason: 'conflict' };
    }
    expected = current.updated_at;
  }
  return { ok: false, reason: 'conflict' };
}

const pageTypeInput = z.enum(PAGE_TYPES);

/**
 * A page type the person picked (CE-023): from now on the draft keeps it,
 * whatever the page says. Throws 'not_found' when no row changed.
 */
export async function setContentDraftPageType(id: string, pageType: PageType): Promise<void> {
  if (!draftId.safeParse(id).success || !pageTypeInput.safeParse(pageType).success) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ page_type: pageType, page_type_source: 'user' })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
}

/**
 * Mark ready: a draft, or an agent's draft in review, is ready to publish.
 * Ansvisor never publishes it; the person does (CE-013 records the URL).
 * Returns the status the draft has after, so a draft already ready or
 * published keeps its own.
 */
export async function markContentDraftReady(id: string): Promise<DraftStatus> {
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ status: 'ready' })
    .eq('id', id)
    .in('status', ['draft', 'in_review'])
    .select('status')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return draftStatus(data.status);
  const current = await getContentDraft(id);
  if (!current) throw new Error('not_found');
  return current.status;
}

/**
 * The Sources tab (CE-008): the brand's data a draft draws on, over the last
 * 30 days (content_draft_sources, 00211), with the person's choices on it.
 * Null when the member can't read the draft.
 */
export async function getDraftSources(
  id: string,
): Promise<{ data: DraftSourcesData; choices: DraftSourceChoice[] } | null> {
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const [sourcesRes, choicesRes] = await Promise.all([
    supabase.rpc('content_draft_sources', { p_draft_id: id, p_days: SOURCES_DAYS }),
    supabase.from('content_draft_sources').select('kind, ref, included, added').eq('draft_id', id),
  ]);
  if (sourcesRes.error) throw new Error(sourcesRes.error.message);
  if (choicesRes.error) throw new Error(choicesRes.error.message);
  if (!sourcesRes.data) return null;
  const kinds: readonly string[] = DRAFT_SOURCE_KINDS;
  return {
    data: sourcesRes.data as unknown as DraftSourcesData,
    choices: (choicesRes.data ?? [])
      .filter((row) => kinds.includes(row.kind))
      .map((row) => ({
        kind: row.kind as DraftSourceKind,
        ref: row.ref,
        included: row.included,
        added: row.added,
      })),
  };
}

const sourceChoice = z.object({
  kind: z.enum(DRAFT_SOURCE_KINDS),
  ref: z.string().min(1).max(2048),
  included: z.boolean(),
});

/** Keeps a source in the draft's sources, or leaves it out (CE-008). */
export async function setDraftSourceIncluded(
  id: string,
  choice: { kind: DraftSourceKind; ref: string; included: boolean },
): Promise<void> {
  const parsed = sourceChoice.safeParse(choice);
  if (!draftId.safeParse(id).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const { error } = await supabase.from('content_draft_sources').upsert(
    {
      draft_id: id,
      kind: parsed.data.kind,
      ref: parsed.data.ref,
      included: parsed.data.included,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'draft_id,kind,ref' },
  );
  if (error) throw new Error(error.message);
}

const addedSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prompt'), promptId: z.guid() }),
  z.object({
    kind: z.literal('cited_page'),
    url: z
      .string()
      .trim()
      .max(2048)
      .refine((url) => {
        try {
          return /^https?:$/.test(new URL(url).protocol);
        } catch {
          return false;
        }
      }),
  }),
  z.object({ kind: z.literal('gsc_query'), query: z.string().trim().min(1).max(2048) }),
]);

export type AddedDraftSource = z.infer<typeof addedSource>;

/**
 * + Add source (CE-008): a prompt joins the draft's prompts (its fan-outs
 * and cited pages follow); a page address or a Search Console query is kept
 * as added by hand. Throws 'not_found' when the draft isn't the member's.
 */
export async function addDraftSource(id: string, source: AddedDraftSource): Promise<void> {
  const parsed = addedSource.safeParse(source);
  if (!draftId.safeParse(id).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const now = new Date().toISOString();

  if (parsed.data.kind === 'prompt') {
    const { promptId } = parsed.data;
    const { data: draft, error } = await supabase
      .from('content_drafts')
      .select('prompt_ids')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!draft) throw new Error('not_found');
    const promptIds: string[] = draft.prompt_ids ?? [];
    if (!promptIds.includes(promptId)) {
      // check_content_draft_links (00206) refuses a prompt of another brand.
      const { error: updateError } = await supabase
        .from('content_drafts')
        .update({ prompt_ids: [...promptIds, promptId] })
        .eq('id', id);
      if (updateError) throw new Error(updateError.message);
    }
    // A prompt left out before is back in.
    const { error: choiceError } = await supabase
      .from('content_draft_sources')
      .update({ included: true, updated_at: now })
      .eq('draft_id', id)
      .eq('kind', 'prompt')
      .eq('ref', promptId);
    if (choiceError) throw new Error(choiceError.message);
    return;
  }

  const ref =
    parsed.data.kind === 'cited_page' ? parsed.data.url : normalizeQuery(parsed.data.query);
  const { error } = await supabase
    .from('content_draft_sources')
    .upsert(
      { draft_id: id, kind: parsed.data.kind, ref, included: true, added: true, updated_at: now },
      { onConflict: 'draft_id,kind,ref' },
    );
  if (error) throw new Error(error.message);
}
