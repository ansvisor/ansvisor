'use client';

import { useCallback, useMemo } from 'react';
import { useAiText } from '@/hooks/use-ai-text';
import type { ActionItem } from '@/lib/actions/action-center';

/**
 * An action's written text in the reader's language (LOC-010): a finding sent
 * from Chat and an Improve action carry their own title, "why" and goal, one
 * sent from a content opportunity the opportunity's title, all written in
 * English. `shown(action)` is the action with those payload fields
 * translated once the API has them (the English until then), for
 * actionTexts and actionGoal to word as before. Every other kind is worded
 * by the interface's own copy and comes back as it is.
 */

/** The payload fields with written text, by kind (the API's ACTION_TEXT_FIELDS). */
const ACTION_TEXT_FIELDS: Record<string, readonly string[]> = {
  chat_finding: ['title', 'why', 'goal'],
  prompt_improve: ['title', 'why', 'goal'],
  content_opportunity: ['title'],
};

type ActionWithText = Pick<ActionItem, 'id' | 'kind' | 'payload'>;

export function useActionAiText(actions: readonly (ActionWithText | null | undefined)[]) {
  const ids = useMemo(
    () =>
      actions
        .filter((action): action is ActionWithText => !!action && action.kind in ACTION_TEXT_FIELDS)
        .map((action) => action.id),
    [actions],
  );
  const text = useAiText('action', ids);

  return useCallback(
    <T extends ActionWithText>(action: T): T => {
      const fields = ACTION_TEXT_FIELDS[action.kind];
      const payload = action.payload;
      if (!fields || !payload) return action;
      let changed = false;
      const shown: Record<string, unknown> = { ...payload };
      for (const field of fields) {
        const english = payload[field];
        if (typeof english !== 'string' || !english) continue;
        const translated = text(action.id, field, english);
        if (translated !== english) {
          shown[field] = translated;
          changed = true;
        }
      }
      return changed ? { ...action, payload: shown } : action;
    },
    [text],
  );
}
