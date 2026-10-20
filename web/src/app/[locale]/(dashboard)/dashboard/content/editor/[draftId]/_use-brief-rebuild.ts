'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { addDraftPrompts, getDraftSources, rebuildDraftBrief } from '@/lib/actions/content-drafts';
import { builtFromCount, rebuildSources, type DraftBrief } from '@/lib/content/brief';
import type { ContentDraft } from '@/lib/content/drafts';
import type { DraftSourceChoice, DraftSourcesData } from '@/lib/content/sources';

/** The page as written now: a rebuild reads its headings and length. */
export interface PageNow {
  title: string;
  html: string;
  pageType: string | null;
}

/**
 * Rebuild outline (CE-007), from the Brief tab, Sources' "Rebuild with
 * selection" or Impact's "Use lost prompts": the sources kept (as the
 * Sources tab has them, or read afresh), the page as written now, and the
 * brief the server writes from them, metered from the AI usage budget.
 */
export function useBriefRebuild({
  draft,
  pageNow,
  onRebuilt,
}: {
  draft: ContentDraft;
  pageNow: () => PageNow;
  onRebuilt: (brief: DraftBrief) => void;
}) {
  const t = useTranslations('contentEditor.editor.brief');
  const [rebuilding, setRebuilding] = useState(false);

  const rebuild = async (
    options: {
      sources?: { data: DraftSourcesData; choices: DraftSourceChoice[] };
      addPrompts?: string[];
    } = {},
  ): Promise<boolean> => {
    setRebuilding(true);
    try {
      if (options.addPrompts?.length) await addDraftPrompts(draft.id, options.addPrompts);
      const read = options.sources ?? (await getDraftSources(draft.id));
      if (!read) throw new Error('not_found');
      const page = pageNow();
      const result = await rebuildDraftBrief(
        draft.id,
        draft.brandId,
        rebuildSources(read.data, read.choices, {
          title: page.title,
          sourceUrl: draft.sourceUrl,
          html: page.html,
          pageType: page.pageType,
        }),
      );
      if ('error' in result) {
        toast.error(t(`rebuildErrors.${result.error}`));
        return false;
      }
      toast.success(t('rebuilt', { count: builtFromCount(result.brief) }));
      onRebuilt(result.brief);
      return true;
    } catch (err) {
      console.error('Failed to rebuild the brief:', err);
      toast.error(t('rebuildErrors.failed'));
      return false;
    } finally {
      setRebuilding(false);
    }
  };

  return { rebuilding, rebuild };
}
