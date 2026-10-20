'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { readAssignees } from '@/lib/action-center/assignees';
import {
  DRAFT_STATUSES,
  PAGE_TYPES,
  type ContentDraft,
  type ContentDraftListItem,
  type DraftMethod,
  type DraftStart,
  type DraftStartOptions,
  type DraftStatus,
  type PageType,
} from '@/lib/content/drafts';
import { escapeHtml } from '@/lib/content/attachments';
import { MAX_BODY_HTML_LENGTH, MAX_TITLE_LENGTH } from '@/lib/content/editor';
import { detectPageType, siteTypeOf, type SiteType } from '@/lib/content/page-types';
import { sanitizeDraftHtml } from '@/lib/content/sanitize-draft-html';

/**
 * Content drafts (Content Editor, CE-002), read through the signed-in member's
 * session: RLS (00203) keeps them to the brand's organization.
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
      `id, brand_id, title, page_type, page_type_source, method, status, body_html, author, updated_at, ${BRAND_SITE}`,
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
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(['opportunity', 'prompt', 'topic']), id: z.guid() }),
    z.object({ kind: z.literal('content') }),
  ]),
  bodyHtml: z.string().max(MAX_BODY_HTML_LENGTH).optional(),
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
 * A draft started from New content and Start (CE-003, CE-015), by the
 * signed-in member: the page type they picked, what it is for, and its first
 * text. A new page starts with its title as the H1; content to optimize is
 * checked against the draft allow-list, as a save is.
 */
export async function createContentDraft(brandId: string, start: DraftStart): Promise<string> {
  const parsed = startInput.safeParse(start);
  if (!draftId.safeParse(brandId).success || !parsed.success) throw new Error('invalid');
  const { method, pageType, source, bodyHtml } = parsed.data;
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
      page_type_source: 'user',
      body_html:
        method === 'optimize'
          ? sanitizeDraftHtml(bodyHtml ?? '')
          : title
            ? `<h1>${escapeHtml(title)}</h1>`
            : '',
      opportunity_id: opportunityId,
      prompt_ids: [...new Set(promptIds)].slice(0, MAX_DRAFT_PROMPTS),
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

const saveInput = z.object({
  title: z.string().max(MAX_TITLE_LENGTH),
  bodyHtml: z.string().max(MAX_BODY_HTML_LENGTH),
});

/**
 * The editor's autosave: the body, checked against the draft allow-list
 * again (sanitizeDraftHtml), and the title read from it. Throws
 * 'not_found' when no row changed (another organization's draft, or one that
 * no longer exists), so a save RLS refused isn't reported as saved.
 *
 * Until a person picks the page type, it follows the page (CE-023): detected
 * again from what was saved, and written only while it is still detected, so
 * a pick made meanwhile stays.
 */
export async function saveContentDraft(
  id: string,
  input: { title: string; bodyHtml: string },
): Promise<{ updatedAt: string }> {
  const parsed = saveInput.safeParse(input);
  if (!draftId.safeParse(id).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const bodyHtml = sanitizeDraftHtml(parsed.data.bodyHtml);
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ title: parsed.data.title, body_html: bodyHtml })
    .eq('id', id)
    .select(`updated_at, page_type, page_type_source, ${BRAND_SITE}`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');

  if (data.page_type_source === 'detected') {
    const detected = detectPageType(
      { title: parsed.data.title, html: bodyHtml },
      brandSiteType(data.brands),
    );
    if (detected !== data.page_type) {
      const { error: typeError } = await supabase
        .from('content_drafts')
        .update({ page_type: detected })
        .eq('id', id)
        .eq('page_type_source', 'detected');
      // The page is saved; its type catches up on the next save.
      if (typeError) console.error('Failed to update the detected page type:', typeError.message);
    }
  }
  return { updatedAt: data.updated_at };
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
