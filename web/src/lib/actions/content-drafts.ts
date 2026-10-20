'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { readAssignees } from '@/lib/action-center/assignees';
import {
  DRAFT_STATUSES,
  type ContentDraft,
  type ContentDraftListItem,
  type DraftMethod,
  type DraftStatus,
} from '@/lib/content/drafts';
import { MAX_BODY_HTML_LENGTH, MAX_TITLE_LENGTH } from '@/lib/content/editor';

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

/** One draft for the editor (CE-004), or null when it isn't the member's to read. */
export async function getContentDraft(id: string): Promise<ContentDraft | null> {
  if (!draftId.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .select('id, brand_id, title, page_type, method, status, body_html, author, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    brandId: data.brand_id,
    title: data.title,
    pageType: data.page_type,
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
  bodyHtml: z.string().max(MAX_BODY_HTML_LENGTH),
});

/**
 * The editor's autosave: the body and the title read from it. Throws
 * 'not_found' when no row changed (another organization's draft, or one that
 * no longer exists), so a save RLS refused isn't reported as saved.
 */
export async function saveContentDraft(
  id: string,
  input: { title: string; bodyHtml: string },
): Promise<{ updatedAt: string }> {
  const parsed = saveInput.safeParse(input);
  if (!draftId.safeParse(id).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ title: parsed.data.title, body_html: parsed.data.bodyHtml })
    .eq('id', id)
    .select('updated_at')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
  return { updatedAt: data.updated_at };
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
