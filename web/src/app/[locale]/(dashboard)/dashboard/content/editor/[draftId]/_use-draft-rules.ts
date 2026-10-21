'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getMyRuleSets, saveDraftRules, saveMyRuleSet } from '@/lib/actions/content-drafts';
import { isPageType, type ContentDraft, type PageType } from '@/lib/content/drafts';
import {
  MAX_TEXT_RULES,
  activeRules,
  checkRule,
  effectiveRules,
  readPage,
  ruleLength,
  ruleSet,
  rulesMet,
  textRuleCheck,
  type ActiveRule,
  type DraftRules,
  type RuleContext,
  type RuleStatus,
  type SavedRuleSet,
  type TextRule,
} from '@/lib/content/rules';
import { buildSourceGroups } from '@/lib/content/sources';
import type { DraftReads } from './_use-draft-reads';

export interface DraftRulesState {
  /** The page type whose set applies. */
  setType: PageType | null;
  /** The set the draft's rules come from: Ansvisor's default or the workspace's My rules. */
  source: 'default' | 'mine';
  rules: { rule: ActiveRule; status: RuleStatus }[];
  /** The person's own rules, each checked as a number or by AI (not counted). */
  textRules: { rule: TextRule; check: 'numberCheck' | 'aiCheck' }[];
  /** The page types the workspace has My rules for. */
  mineTypes: PageType[];
  /** My rules have been read: until then a change would leave the workspace's set out. */
  ready: boolean;
  met: number;
  total: number;
  /** The page length the rules ask for. */
  length: number;
  /** Turns a rule on or off, or gives it a value, for this draft. */
  change: (key: string, change: { on?: boolean; value?: string }) => void;
  /** Loads a set into the draft: a type's Ansvisor default, or the workspace's My rules for it. */
  pickSet: (type: PageType, source: 'default' | 'mine') => void;
  /** Adds rules in the person's own words, one per line. */
  addTextRules: (lines: string[]) => void;
  /** Edits a text rule, turns it on or off; an empty text removes it. */
  changeTextRule: (id: string, change: { text?: string; on?: boolean }) => void;
  /** Save as my rules: the draft's choices become the workspace's set for the type. */
  saveAsMine: () => void;
  /** Back to Ansvisor's default set for the type. */
  reset: () => void;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * The draft's rules (CE-009) as the editor reads them: the set for its page
 * type with the person's changes, each checked against the page as written —
 * the header's chip and the Rules tab show the same. A draft no one has set
 * rules on starts from the workspace's My rules for its type, if it has
 * them, read once. The brand's domains, the fan-outs kept and the brief's
 * keywords come from the editor's one read of the sources and the brief
 * (useDraftReads), so a rebuild, an edit or a source checked shows in the
 * rules at once.
 */
export function useDraftRules({
  draft,
  html,
  characters,
  pageType,
  reads,
}: {
  draft: ContentDraft;
  html: string;
  characters: number;
  pageType: string | null;
  reads: Pick<DraftReads, 'brief' | 'sources'>;
}): DraftRulesState {
  const t = useTranslations('contentEditor.editor.rules');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const [choices, setChoices] = useState<DraftRules>(draft.rules);
  const [mine, setMine] = useState<Partial<Record<PageType, SavedRuleSet>>>({});
  const [mineRead, setMineRead] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyRuleSets(draft.brandId)
      .then((sets) => {
        if (!cancelled) setMine(sets);
      })
      .catch((err) => console.error('Failed to read My rules:', err))
      .finally(() => {
        if (!cancelled) setMineRead(true);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.brandId]);

  const sources = reads.sources;
  const ctx = useMemo<RuleContext>(() => {
    if (!sources || sources.failed) return { brandDomains: [], competitorDomains: [], fanouts: [] };
    const fanouts = buildSourceGroups(sources.data, sources.choices, {
      title: draft.title,
      sourceUrl: draft.sourceUrl,
    })
      .find((g) => g.kind === 'fanout')
      ?.rows.filter((r) => r.included)
      .map((r) => r.name);
    return {
      brandDomains: sources.data.brandDomains,
      competitorDomains: sources.data.competitorDomains,
      fanouts: fanouts ?? [],
    };
  }, [sources, draft.title, draft.sourceUrl]);
  const brief = reads.brief;
  const keywords = useMemo(
    () => (brief.status === 'ready' ? (brief.brief?.keywords ?? []) : []),
    [brief],
  );

  const draftType = isPageType(pageType) ? pageType : null;
  const setType = choices.set ?? draftType;
  const effective = useMemo(
    () => effectiveRules(choices, setType ? mine[setType] : undefined),
    [choices, setType, mine],
  );
  const rules = useMemo(
    () => activeRules(ruleSet(setType, { keywords }), effective),
    [setType, keywords, effective],
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

  const save = (next: DraftRules, message: string) => {
    // Before My rules are read, the draft would save Ansvisor's set over the workspace's.
    if (!mineRead) return;
    const before = choices;
    setChoices(next);
    saveDraftRules(draft.id, next)
      .then(() => toast(message))
      .catch((err) => {
        console.error('Failed to save the rules:', err);
        setChoices(before);
        toast.error(t('saveFailed'));
      });
  };
  // A change keeps the set the draft's rules come from.
  const edited = (change: Partial<DraftRules>, message = t('updated')) =>
    save({ ...effective, source: effective.source ?? 'default', ...change }, message);
  const typeName = (type: PageType | null) => (type ? tTypes(type) : '');

  return {
    setType,
    source: effective.source ?? 'default',
    rules: checked,
    textRules: effective.textRules.map((rule) => ({ rule, check: textRuleCheck(rule.text) })),
    mineTypes: (Object.keys(mine) as PageType[]).filter((type) => mine[type]),
    ready: mineRead,
    met,
    total,
    length: ruleLength(rules, setType),
    change: (key, change) =>
      edited({
        overrides: { ...effective.overrides, [key]: { ...effective.overrides[key], ...change } },
      }),
    pickSet: (type, source) => {
      const set = source === 'mine' ? mine[type] : undefined;
      save(
        {
          set: type === draftType ? null : type,
          source,
          overrides: set?.overrides ?? {},
          textRules: set?.textRules ?? [],
        },
        t('setPicked'),
      );
    },
    addTextRules: (lines) => {
      const room = MAX_TEXT_RULES - effective.textRules.length;
      if (room <= 0) {
        toast.error(t('text.tooMany', { max: MAX_TEXT_RULES }));
        return;
      }
      const added = lines.slice(0, room).map((text) => ({ id: newId(), text, on: true }));
      edited(
        { textRules: [...effective.textRules, ...added] },
        t('text.added', { count: added.length }),
      );
    },
    changeTextRule: (id, change) => {
      const removed = change.text !== undefined && !change.text.trim();
      edited(
        {
          textRules: removed
            ? effective.textRules.filter((r) => r.id !== id)
            : effective.textRules.map((r) =>
                r.id === id
                  ? {
                      ...r,
                      ...change,
                      ...(change.text !== undefined && { text: change.text.trim() }),
                    }
                  : r,
              ),
        },
        removed ? t('text.removed') : t('updated'),
      );
    },
    saveAsMine: () => {
      if (!setType) return;
      const set: SavedRuleSet = { overrides: effective.overrides, textRules: effective.textRules };
      saveMyRuleSet(draft.brandId, setType, set)
        .then(() => {
          setMine((prev) => ({ ...prev, [setType]: set }));
          save({ ...effective, source: 'mine' }, t('savedMine', { type: typeName(setType) }));
        })
        .catch((err) => {
          console.error('Failed to save My rules:', err);
          toast.error(t('saveMineFailed'));
        });
    },
    reset: () =>
      save({ set: choices.set, source: 'default', overrides: {}, textRules: [] }, t('resetDone')),
  };
}
