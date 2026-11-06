import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { ContentBrief } from '@/types';
import { briefFromOpportunity, draftBriefSchema, type DraftBrief } from './brief';
import {
  DRAFT_SOURCE_KINDS,
  SOURCES_DAYS,
  type DraftSourceChoice,
  type DraftSourceKind,
  type DraftSourcesData,
} from './sources';

/**
 * A draft's brief and sources as the Content Editor reads them (CE-007,
 * CE-008), with the client given: the member's (lib/actions/content-drafts.ts
 * getDraftBrief, getDraftSources) or the service role's for Chat's page
 * checks (draft-rules-read.ts). One read, so the rules count the same
 * everywhere.
 */

/**
 * The draft's brief: its own, else its opportunity's. Null when the draft
 * can't be read, or its own brief can't be (said as a failed read, never as
 * the opportunity's or none, so Edit brief can't write over it).
 */
export async function readDraftBriefWith(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ brief: DraftBrief | null } | null> {
  const { data: draft, error } = await supabase
    .from('content_drafts')
    .select('brief, opportunity_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) return null;
  const own = draftBriefSchema.safeParse(draft.brief);
  if (own.success) return { brief: own.data };
  if (draft.brief != null) {
    console.error('The draft brief can’t be read:', own.error.issues.slice(0, 3));
    return null;
  }
  if (!draft.opportunity_id) return { brief: null };
  const { data: opportunity, error: oppError } = await supabase
    .from('content_opportunities')
    .select('brief')
    .eq('id', draft.opportunity_id)
    .maybeSingle();
  if (oppError) throw new Error(oppError.message);
  const brief = opportunity?.brief as ContentBrief | null | undefined;
  return { brief: brief?.outline ? briefFromOpportunity(brief) : null };
}

/**
 * The brand's data a draft draws on, over the last 30 days
 * (content_draft_sources, 00211), with the person's choices on it. Null when
 * the draft can't be read.
 */
export async function readDraftSourcesWith(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ data: DraftSourcesData; choices: DraftSourceChoice[] } | null> {
  const [sourcesRes, choicesRes, trustedRes] = await Promise.all([
    supabase.rpc('content_draft_sources', { p_draft_id: id, p_days: SOURCES_DAYS }),
    supabase.from('content_draft_sources').select('kind, ref, included, added').eq('draft_id', id),
    // The sites the draft's brand trusts (00449). A database before it, or a
    // read that fails, trusts none: Trust reads the page as before.
    supabase.from('content_drafts').select('brands(trusted_sources)').eq('id', id).maybeSingle(),
  ]);
  if (sourcesRes.error) throw new Error(sourcesRes.error.message);
  if (choicesRes.error) throw new Error(choicesRes.error.message);
  if (!sourcesRes.data) return null;
  const kinds: readonly string[] = DRAFT_SOURCE_KINDS;
  const trusted = trustedRes.error ? null : trustedRes.data?.brands?.trusted_sources;
  return {
    data: {
      ...(sourcesRes.data as unknown as DraftSourcesData),
      trustedDomains: Array.isArray(trusted) ? trusted : [],
    },
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
