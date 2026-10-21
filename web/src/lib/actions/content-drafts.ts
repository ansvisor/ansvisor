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
  type DraftStatus,
  type PageType,
} from '@/lib/content/drafts';
import {
  MAX_BODY_HTML_LENGTH,
  MAX_TITLE_LENGTH,
  bodyHash,
  type SaveDraftResult,
} from '@/lib/content/editor';
import { detectPageType, siteTypeOf, type SiteType } from '@/lib/content/page-types';
import { sanitizeDraftHtml } from '@/lib/content/sanitize-draft-html';

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

/**
 * A blank draft of a new page, started by the signed-in member: what the
 * Library's New content opens until the Start screen (CE-015) asks for the
 * page type and checks for overlaps first.
 */
export async function createContentDraft(brandId: string): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
  const { data, error } = await supabase
    .from('content_drafts')
    .insert({ brand_id: brandId, created_by: user.id })
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
        if (detected !== data.page_type) {
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
