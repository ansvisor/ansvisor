'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getDraftBrief, getDraftSources, saveDraftRules } from '@/lib/actions/content-drafts';
import { isPageType, type ContentDraft, type PageType } from '@/lib/content/drafts';
import {
  activeRules,
  checkRule,
  readPage,
  ruleLength,
  ruleSet,
  rulesMet,
  type ActiveRule,
  type DraftRules,
  type RuleContext,
  type RuleStatus,
} from '@/lib/content/rules';
import { buildSourceGroups } from '@/lib/content/sources';

export interface DraftRulesState {
  /** The page type whose set applies. */
  setType: PageType | null;
  rules: { rule: ActiveRule; status: RuleStatus }[];
  met: number;
  total: number;
  /** The page length the rules ask for. */
  length: number;
  /** Turns a rule on or off, or gives it a value, for this draft. */
  change: (key: string, change: { on?: boolean; value?: string }) => void;
  /** Applies another page type's set, or the draft's own (null). */
  pickSet: (type: PageType | null) => void;
}

/**
 * The draft's rules (CE-009) as the editor reads them: the set for its page
 * type with the person's changes, each checked against the page as written —
 * the header's chip and the Rules tab show the same. The brand's domains,
 * the fan-outs kept and the brief's keywords are read once.
 */
export function useDraftRules({
  draft,
  html,
  characters,
  pageType,
}: {
  draft: ContentDraft;
  html: string;
  characters: number;
  pageType: string | null;
}): DraftRulesState {
  const t = useTranslations('contentEditor.editor.rules');
  const [choices, setChoices] = useState<DraftRules>(draft.rules);
  const [ctx, setCtx] = useState<RuleContext>({
    brandDomains: [],
    competitorDomains: [],
    fanouts: [],
  });
  const [keywords, setKeywords] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getDraftSources(draft.id), getDraftBrief(draft.id)])
      .then(([sources, brief]) => {
        if (cancelled) return;
        if (sources) {
          const fanouts = buildSourceGroups(sources.data, sources.choices, {
            title: draft.title,
            sourceUrl: draft.sourceUrl,
          })
            .find((g) => g.kind === 'fanout')
            ?.rows.filter((r) => r.included)
            .map((r) => r.name);
          setCtx({
            brandDomains: sources.data.brandDomains,
            competitorDomains: sources.data.competitorDomains,
            fanouts: fanouts ?? [],
          });
        }
        if (brief?.brief) setKeywords(brief.brief.keywords);
      })
      .catch((err) => console.error('Failed to read what the rules check against:', err));
    return () => {
      cancelled = true;
    };
  }, [draft.id, draft.title, draft.sourceUrl]);

  const draftType = isPageType(pageType) ? pageType : null;
  const setType = choices.set ?? draftType;
  const rules = useMemo(
    () => activeRules(ruleSet(setType, { keywords }), choices),
    [setType, keywords, choices],
  );
  // The checks follow the page a beat behind typing.
  const deferredHtml = useDeferredValue(html);
  const deferredCharacters = useDeferredValue(characters);
  const page = useMemo(
    () => readPage(deferredHtml, deferredCharacters),
    [deferredHtml, deferredCharacters],
  );
  const checked = useMemo(
    () => rules.map((rule) => ({ rule, status: checkRule(rule, page, ctx) })),
    [rules, page, ctx],
  );
  const { met, total } = rulesMet(checked);

  const save = (next: DraftRules) => {
    const before = choices;
    setChoices(next);
    saveDraftRules(draft.id, next)
      .then(() => toast(t('updated')))
      .catch((err) => {
        console.error('Failed to save the rules:', err);
        setChoices(before);
        toast.error(t('saveFailed'));
      });
  };

  return {
    setType,
    rules: checked,
    met,
    total,
    length: ruleLength(rules, setType),
    change: (key, change) =>
      save({
        ...choices,
        overrides: { ...choices.overrides, [key]: { ...choices.overrides[key], ...change } },
      }),
    pickSet: (type) => save({ ...choices, set: type }),
  };
}
