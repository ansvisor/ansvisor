import type { ActionItem } from '@/lib/actions/action-center';

/**
 * Composes what an action row shows from `kind` + `payload`, mirroring the
 * signals display helper: templates live in i18n
 * (actionCenter.actionTexts.<kind>), this module prepares the values and
 * picks the right variant when a payload part is optional.
 */

type Translator = (key: string, values?: Record<string, string | number>) => string;

function num(payload: Record<string, unknown>, key: string): number {
  return Number(payload[key] ?? 0);
}

export function actionTexts(
  action: ActionItem,
  t: Translator,
): { title: string; description: string } {
  const p = action.payload;
  switch (action.kind) {
    case 'recover_visibility': {
      const hasDrop = p.dropFrom !== undefined && p.dropFrom !== null;
      return {
        title: t('recover_visibility.title'),
        description: hasDrop
          ? t('recover_visibility.descriptionWithDrop', {
              from: num(p, 'dropFrom'),
              to: num(p, 'dropTo'),
              prompts: num(p, 'promptCount'),
            })
          : t('recover_visibility.description', { prompts: num(p, 'promptCount') }),
      };
    }
    case 'capture_ai_traffic':
      return {
        title: t('capture_ai_traffic.title', { pages: num(p, 'pageCount') }),
        description: t('capture_ai_traffic.description'),
      };
    case 'convert_mentions':
      return {
        title: t('convert_mentions.title'),
        description: t('convert_mentions.description', { prompts: num(p, 'promptCount') }),
      };
    case 'fix_low_scores':
      return {
        title: t('fix_low_scores.title'),
        description: t('fix_low_scores.description', { pages: num(p, 'pageCount') }),
      };
    case 'close_competitor_gap': {
      const names = Array.isArray(p.competitorNames) ? (p.competitorNames as string[]) : [];
      return {
        title:
          names.length === 1
            ? t('close_competitor_gap.title', { name: names[0] })
            : t('close_competitor_gap.titleMany'),
        description: t('close_competitor_gap.description'),
      };
    }
  }
}

/** Compact evidence chips under the title: signal count plus the kind's own
 *  count (pages, prompts, competitors). */
export function actionContextTags(action: ActionItem, t: Translator): string[] {
  const p = action.payload;
  const tags = [t('tags.signals', { count: action.signalCount })];
  switch (action.kind) {
    case 'recover_visibility':
      if (num(p, 'promptCount') > 0) tags.push(t('tags.prompts', { count: num(p, 'promptCount') }));
      break;
    case 'capture_ai_traffic':
      tags.push(t('tags.pages', { count: num(p, 'pageCount') }));
      break;
    case 'convert_mentions':
      tags.push(t('tags.prompts', { count: num(p, 'promptCount') }));
      break;
    case 'fix_low_scores':
      tags.push(t('tags.pages', { count: num(p, 'pageCount') }));
      break;
    case 'close_competitor_gap': {
      const names = Array.isArray(p.competitorNames) ? (p.competitorNames as string[]) : [];
      if (names[0]) tags.push(names[0]);
      break;
    }
  }
  return tags;
}

const IMPACT_RANK: Record<ActionItem['impact'], number> = { high: 3, medium: 2, low: 1 };

/** Priority: impact first, then weight of evidence, then recency. The
 *  scoring formula stays out of the UI per the brief — this order IS it. */
export function comparePriority(a: ActionItem, b: ActionItem): number {
  return (
    IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] ||
    b.signalCount - a.signalCount ||
    b.updatedAt.localeCompare(a.updatedAt)
  );
}
