'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { getPromptDemand } from '@/lib/actions/action-center';
import type { Signal } from '@/lib/signals/map';
import { affectedOf, affectedSignals, type Affected } from '@/lib/action-center/affected';
import { actionStory, type ActionStory } from '@/lib/action-center/story';

/** What the story reads of an action. */
export interface StoryAction {
  id: string;
  payload: Record<string, unknown>;
  createdAt: string;
  dueDate: string | null;
}

/**
 * What a drawer works out from an action's signals (AC-003): what the ones it
 * rests on affect item by item, each affected prompt's demand, and
 * the Why and Goal in the action's own terms. Shared by the Actions and the
 * History drawers, so an action reads the same in both. `signals` is null
 * until the caller has read them; `ready` once they and their demand are in,
 * so the Why is written once rather than one way and then another.
 */
export function useActionStory(
  brandId: string,
  action: StoryAction | null,
  signals: Signal[] | null,
): {
  affected: Affected | null;
  volumes: Map<string, number> | null;
  story: ActionStory | null;
  ready: boolean;
} {
  const tStory = useTranslations('actionCenter.actionsPage.drawer.story');
  const format = useFormatter();

  const evidence = useMemo(
    () => (action && signals ? affectedSignals(signals, action.id) : null),
    [action, signals],
  );
  const affected = useMemo(
    () => (action && evidence ? affectedOf(evidence, action.payload ?? {}) : null),
    [action, evidence],
  );

  // Each affected prompt's demand. Best effort: without it the column is left
  // out. Kept with the prompts it was read for, so a read still under way is
  // told apart from one that failed.
  const promptIdsKey = (affected?.prompts ?? [])
    .map((row) => row.id)
    .filter(Boolean)
    .join(',');
  const demandKey = `${brandId}:${promptIdsKey}`;
  const [demand, setDemand] = useState<{
    key: string;
    volumes: Map<string, number> | null;
  } | null>(null);
  useEffect(() => {
    if (!promptIdsKey) return;
    let cancelled = false;
    const key = `${brandId}:${promptIdsKey}`;
    getPromptDemand(brandId, promptIdsKey.split(',')).then(
      (read) => {
        if (!cancelled) setDemand({ key, volumes: new Map(Object.entries(read)) });
      },
      () => {
        if (!cancelled) setDemand({ key, volumes: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [brandId, promptIdsKey]);
  const demandRead = !promptIdsKey || demand?.key === demandKey;
  const volumes = promptIdsKey && demand?.key === demandKey ? demand.volumes : null;

  // The signals and their demand are both in: the Why names the prompts'
  // demand, so it waits for it rather than reading one way and then another.
  const ready = signals !== null && demandRead;

  // Why and Goal in the action's own terms; null for an action a person sent,
  // which carries its own.
  const story = useMemo(
    () =>
      action && evidence
        ? actionStory(
            {
              signals: evidence,
              volumes,
              createdAt: action.createdAt,
              dueDate: action.dueDate,
            },
            tStory,
            {
              day: (date) => format.dateTime(date, { month: 'short', day: 'numeric' }),
              list: (items) => format.list(items, { type: 'conjunction' }),
            },
          )
        : null,
    [action, evidence, volumes, tStory, format],
  );

  return { affected, volumes, story, ready };
}
