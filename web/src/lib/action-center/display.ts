import type { ActionItem } from '@/lib/actions/action-center';
import { isActionKind } from '@/lib/action-center/registry';

/**
 * Composes what an action row shows from `kind` + `payload`, mirroring the
 * signals display helper: templates live in i18n
 * (actionCenter.actionTexts.<kind>), this module prepares the values and
 * picks the right variant when a payload part is optional.
 *
 * The server can raise a kind this build has never heard of — that is the
 * point of the definition registry, which grows on its own release cycle.
 * Such an action is presented generically rather than hidden: the work is
 * real, and a row nobody can read is still better than a row nobody sees.
 */

type Translator = (key: string, values?: Record<string, string | number>) => string;

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function num(payload: Record<string, unknown>, key: string): number {
  return Number(payload[key] ?? 0);
}

/**
 * `expand_platform_visibility` → "Expand platform visibility".
 *
 * Definition ids are written to be read — they are verb phrases naming the
 * work — so the id itself is a better title than any generic string.
 */
export function humanizeKind(kind: string): string {
  const words = kind.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function actionTexts(
  action: ActionItem,
  t: Translator,
): { title: string; description: string } {
  const p = action.payload;
  const kind = action.kind;
  if (!isActionKind(kind)) {
    return {
      title: humanizeKind(kind),
      description: t('unknown.description'),
    };
  }
  switch (kind) {
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
    case 'protect_visibility': {
      const hasDrop = p.dropFrom !== undefined && p.dropFrom !== null;
      return {
        title: t('protect_visibility.title'),
        description: hasDrop
          ? t('protect_visibility.descriptionWithDrop', {
              from: num(p, 'dropFrom'),
              to: num(p, 'dropTo'),
            })
          : t('protect_visibility.description'),
      };
    }
    case 'capture_ai_traffic':
      return {
        title: t('capture_ai_traffic.title', { pages: num(p, 'pageCount') }),
        description: t('capture_ai_traffic.description'),
      };
    case 'expand_platform_visibility':
      return {
        title: t('expand_platform_visibility.title', { platform: str(p, 'platform') }),
        description: t('expand_platform_visibility.description', {
          platform: str(p, 'platform'),
          best: str(p, 'bestPlatform'),
          bestRate: num(p, 'dropFrom'),
          rate: num(p, 'dropTo'),
        }),
      };
    case 'close_citation_gap': {
      const names = Array.isArray(p.competitorNames) ? (p.competitorNames as string[]) : [];
      return {
        title: t('close_citation_gap.title'),
        description: names[0]
          ? t('close_citation_gap.descriptionWithName', {
              competitor: names[0],
              theirs: num(p, 'competitorCitations'),
              ours: num(p, 'citationCount'),
            })
          : t('close_citation_gap.description'),
      };
    }
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

/**
 * What the drawer shows under "Goal".
 *
 * Its own helper rather than an inline `t(`${kind}.goal`)` in two components,
 * because an unknown kind has no goal key and next-intl would render the key
 * itself into the drawer.
 */
export function actionGoal(kind: string, t: Translator): string {
  return isActionKind(kind) ? t(`${kind}.goal`) : t('unknown.goal');
}

/** Compact evidence chips under the title: signal count plus the kind's own
 *  count (pages, prompts, competitors). */
export function actionContextTags(action: ActionItem, t: Translator): string[] {
  const p = action.payload;
  const tags = [t('tags.signals', { count: action.signalCount })];
  if (!isActionKind(action.kind)) return tags;
  switch (action.kind) {
    case 'recover_visibility':
      if (num(p, 'promptCount') > 0) tags.push(t('tags.prompts', { count: num(p, 'promptCount') }));
      break;
    case 'protect_visibility':
      break;
    case 'expand_platform_visibility':
      tags.push(str(p, 'platform'));
      break;
    case 'close_citation_gap': {
      const names = Array.isArray(p.competitorNames) ? (p.competitorNames as string[]) : [];
      if (names[0]) tags.push(names[0]);
      break;
    }
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

/**
 * How a team member is named in an assignee picker.
 *
 * `full_name` is optional on a profile and most of this organization's members
 * have never set one, so the previous fallback — the first eight characters of
 * the user's uuid — put strings like `1d3fb0a2` in the dropdown. Email is the
 * one identifier every member is guaranteed to have and to recognise, which is
 * what the team settings list has always shown.
 */
export function memberLabel(member: { fullName: string | null; email: string }): string {
  return member.fullName?.trim() || member.email;
}

/**
 * A task's text: what the user wrote, or the template it was generated from.
 *
 * Generated tasks carry a `task_key` into actionCenter.actionTasks and no
 * title. Adding or renaming a task writes a title, which wins from then on —
 * the key stays behind so which template a task grew from is still answerable.
 */
export function taskText(
  task: { taskKey: string | null; title: string | null },
  t: Translator,
): string {
  const title = task.title?.trim();
  if (title) return title;
  return task.taskKey ? t(task.taskKey) : '';
}
