'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw, Sparkles, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AddTopicLink, TopicFirstNotice } from '@/components/prompts/topic-first';
import { useWaitingForSpotToast } from '@/components/prompts/waiting-for-spot';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { useUserRole } from '@/hooks/use-user-role';
import { getTopics } from '@/lib/actions/topic';
import { importPrompts } from '@/lib/actions/prompt';
import { SetupDailyLimitError, generatePromptsFromTopics } from '@/lib/ai-brand-setup';
import { isNoTopics } from '@/lib/topics-required';
import { useBrandStore } from '@/stores/use-brand-store';
import type { Brand, Topic } from '@/types';
import { brandLocation, useAllowedEngines } from './_prompt-defaults';
import { SuggestionText } from './_suggestion-text';
import { PROMPTS_PER_TOPIC, matchTopicPrompts, type TopicPromptItem } from './topic-prompts';

/**
 * Generate by topic, on Prompt Suggestions (moved from the brand's Manage
 * prompts page): pick some of the brand's topics, and the same call as that
 * page's AI Generate writes 5 prompts for each. They are listed for review
 * at the top of the suggestions, grouped by topic, each ticked and editable;
 * Add selected saves the ticked ones under their topic, Regenerate writes
 * them again, Dismiss drops them. Nothing is saved until Add selected.
 * For admins and managers, as the API allows; a plan that isn't active opens
 * the upgrade dialog instead.
 */

interface Generated {
  /** Whose: another brand's never show on this one. */
  brandId: string;
  /** The topics picked, as Regenerate asks for them again. */
  topics: Topic[];
  items: TopicPromptItem[];
}

/** The brand as the generation call takes it, cut to its limits there. */
function brandParams(brand: Brand) {
  return {
    brandName: brand.name,
    industry: brand.industry,
    description: brand.description ?? '',
    website: brand.domains.find((d) => d.isPrimary)?.domain ?? '',
    language: brand.language || 'en',
  };
}

export function GenerateByTopic({
  brandId,
  open,
  onOpenChange,
  onAdded,
  onAddTopic,
  onNoTopics,
}: {
  brandId: string;
  /** The topic picker. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prompts were added: the page reads its prompts and usage again. */
  onAdded?: () => void;
  /** "Add a topic" on a brand without one: the page's Topics tab, with Add Topic open. */
  onAddTopic?: () => void;
  /** The save came back `no_topics` (the topics were removed meanwhile): the card asks for one. */
  onNoTopics: () => void;
}) {
  const t = useTranslations('prompts.suggestions.byTopic');
  const tActions = useTranslations('readOnly.actions');
  const { guard } = useUpgradeGate();
  const { canManage } = useUserRole();
  const brand = useBrandStore((s) => s.brands.find((b) => b.id === brandId) ?? null);
  const { allowedScraperIds, allowedModelIds } = useAllowedEngines(!!brand?.shoppingModeEnabled);
  const showWaiting = useWaitingForSpotToast();
  const headingId = useId();

  // The brand's topics, read each time the picker opens; null while reading.
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [generating, setGenerating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [results, setGenerated] = useState<Generated | null>(null);
  const generated = results?.brandId === brandId ? results : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTopics(null);
    getTopics(brandId)
      .then((list) => {
        if (cancelled) return;
        setTopics(list);
        // Every topic starts picked, as on the brand's page.
        setPicked(new Set(list.map((topic) => topic.id)));
      })
      .catch(() => {
        if (cancelled) return;
        setTopics([]);
        toast.error(t('topicsFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [open, brandId, t]);

  if (!canManage) return null;

  /** Ask for 5 prompts a topic; the list replaces any before it. */
  const generate = async (forTopics: Topic[]) => {
    if (!brand || forTopics.length === 0 || generating) return false;
    setGenerating(true);
    try {
      const { topicPrompts } = await generatePromptsFromTopics(
        brandParams(brand),
        forTopics.map((topic) => topic.name),
      );
      const items = matchTopicPrompts(forTopics, topicPrompts);
      if (items.length === 0) {
        toast.error(t('failed'));
        return false;
      }
      setGenerated({ brandId, topics: forTopics, items });
      toast.success(t('generated', { count: items.length }));
      return true;
    } catch (err) {
      toast.error(err instanceof SetupDailyLimitError ? t('dailyLimit') : t('failed'));
      return false;
    } finally {
      setGenerating(false);
    }
  };

  const pickedTopics = (topics ?? []).filter((topic) => picked.has(topic.id));

  const submitPicker = async () => {
    if (await generate(pickedTopics)) onOpenChange(false);
  };

  const selected = generated?.items.filter((item) => item.on) ?? [];

  /**
   * Save the ticked prompts in one call, the way Add prompt's list does: each
   * under the topic it was written for, by its id (a topic renamed since
   * keeps them; its name only without one), with every engine the plan
   * allows and the brand's location. Past the plan's limit the rest wait for
   * a spot; a prompt the brand already tracks is left out.
   */
  const addSelected = async () => {
    if (!brand || selected.length === 0 || adding) return;
    setAdding(true);
    try {
      const region = brandLocation(brand.region, brand.state);
      const result = await importPrompts(
        brandId,
        selected.map((item, idx) => ({
          idx,
          text: item.text,
          topic: item.topic,
          ...(item.topicId ? { topicId: item.topicId } : {}),
          platforms: allowedScraperIds,
          models: allowedModelIds,
          regions: [region],
        })),
      );
      if ('error' in result) {
        if (isNoTopics(result)) onNoTopics();
        else toast.error(result.error);
        return;
      }
      const added = result.importedIdx.length;
      if (added === 0) {
        toast.error(t('noneAdded'));
        return;
      }
      const waiting = result.waitingIdx?.length ?? 0;
      const skipped = selected.length - added;
      setGenerated(null);
      onAdded?.();
      if (!showWaiting('generate_topics', added - waiting, waiting)) {
        toast.success(
          skipped > 0 ? t('addedSkipped', { count: added, skipped }) : t('added', { count: added }),
          { description: result.analysisStarted ? t('trackingNow') : t('trackingNext') },
        );
      }
    } catch {
      toast.error(t('addFailed'));
    } finally {
      setAdding(false);
    }
  };

  const setItem = (key: string, patch: Partial<TopicPromptItem>) =>
    setGenerated((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
          }
        : prev,
    );

  const groups = generated
    ? generated.topics
        .map((topic) => ({
          topic,
          items: generated.items.filter((item) => item.topicId === topic.id),
        }))
        .filter((group) => group.items.length > 0)
    : [];

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !generating && onOpenChange(next)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description', { count: PROMPTS_PER_TOPIC })}</DialogDescription>
          </DialogHeader>

          {topics === null ? (
            <div className="flex items-center justify-center py-6">
              <Loader2
                className="h-5 w-5 animate-spin text-muted-foreground"
                aria-label={t('loading')}
              />
            </div>
          ) : topics.length === 0 ? (
            <div className="space-y-3">
              <TopicFirstNotice />
              <AddTopicLink onAddTopic={onAddTopic} onClick={() => onOpenChange(false)} />
            </div>
          ) : (
            <fieldset className="space-y-2" disabled={generating}>
              <div className="flex items-center justify-between gap-2">
                <legend className="text-xs font-medium text-muted-foreground">{t('topics')}</legend>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() =>
                    setPicked(
                      picked.size === topics.length
                        ? new Set()
                        : new Set(topics.map((topic) => topic.id)),
                    )
                  }
                >
                  {picked.size === topics.length ? t('pickNone') : t('pickAll')}
                </Button>
              </div>
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                {topics.map((topic) => {
                  const id = `generate-topic-${topic.id}`;
                  return (
                    <li key={topic.id}>
                      <label
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md p-2 text-sm hover:bg-muted/50"
                      >
                        <Checkbox
                          id={id}
                          checked={picked.has(topic.id)}
                          onCheckedChange={(checked) =>
                            setPicked((prev) => {
                              const next = new Set(prev);
                              if (checked === true) next.add(topic.id);
                              else next.delete(topic.id);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0 break-words">{topic.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {t('pickedCount', {
                  topics: picked.size,
                  prompts: picked.size * PROMPTS_PER_TOPIC,
                })}
              </p>
            </fieldset>
          )}

          <DialogFooter>
            <Button variant="outline" disabled={generating} onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            {topics !== null && topics.length > 0 && (
              <Button
                className="gap-2"
                disabled={generating || pickedTopics.length === 0 || !brand}
                onClick={() => void submitPicker()}
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generating ? t('generating') : t('generate')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {generated && groups.length > 0 && (
        <section
          aria-labelledby={headingId}
          data-topic-prompts
          className="mb-4 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:p-4"
        >
          <div className="space-y-0.5">
            <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              {t('reviewTitle', { topics: groups.map((group) => group.topic.name).join(', ') })}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('reviewDescription', { count: PROMPTS_PER_TOPIC })}
            </p>
          </div>

          {groups.map((group) => (
            <div key={group.topic.id} className="space-y-1.5">
              <h4 className="flex items-center gap-1.5">
                <Badge variant="outline" className="gap-1 bg-card text-xs font-normal">
                  <Tag className="h-3 w-3" />
                  {group.topic.name}
                </Badge>
              </h4>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-start gap-2.5 rounded-md border bg-card p-2.5"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={item.on}
                      onCheckedChange={(checked) => setItem(item.key, { on: checked === true })}
                      aria-label={t('include', { text: item.text })}
                    />
                    <SuggestionText
                      className={item.on ? undefined : 'opacity-60'}
                      text={item.text}
                      edited={item.text !== item.original}
                      onChange={(text) => setItem(item.key, { text })}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              className="gap-2"
              disabled={adding || generating || selected.length === 0}
              onClick={guard(() => void addSelected(), { action: tActions('addPrompts') })}
            >
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {adding ? t('adding') : t('addSelected', { count: selected.length })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={adding || generating}
              onClick={guard(() => void generate(generated.topics), {
                action: tActions('generatePrompts'),
              })}
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {generating ? t('generating') : t('regenerate')}
            </Button>
            <Button size="sm" variant="ghost" disabled={adding} onClick={() => setGenerated(null)}>
              {t('dismiss')}
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
