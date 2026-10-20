'use server';

import { createClient } from '@/lib/supabase/server';
import { readAssignees } from '@/lib/action-center/assignees';
import {
  DRAFT_STATUSES,
  type ContentDraftListItem,
  type DraftMethod,
  type DraftStatus,
} from '@/lib/content/drafts';

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
    status: (DRAFT_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as DraftStatus)
      : 'draft',
    author: row.author === 'agent' ? 'agent' : 'user',
    createdBy: row.created_by ? (people.get(row.created_by) ?? null) : null,
    isMine: me !== null && row.created_by === me,
    scoreBefore: row.score_before,
    scoreAfter: row.score_after,
    updatedAt: row.updated_at,
  }));
}
