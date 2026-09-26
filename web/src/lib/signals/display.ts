import type { Signal } from '@/lib/actions/signals';
import { isLibrarySignalKind } from '@/lib/signals/registry';

/**
 * Composes the display strings a signal row shows from `kind` + `payload`.
 * Titles live in i18n templates (actionCenter.signalTexts.<kind>), not the
 * database — this module only prepares the interpolation values, so the
 * page's search box can match what the user actually reads.
 */

type Translator = (key: string, values?: Record<string, string | number>) => string;

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

/**
 * A library signal's copy: what it is about, named from its targets.
 *
 * The V1 library's detectors all write the same shape — an entity and a list
 * of targets — so their copy needs two values: how many ("11 prompts") for a
 * finding about a group, and which one ("gemini-web", a topic, a domain) for a
 * finding about a single thing.
 */
function librarySignalTexts(signal: Signal, t: Translator): { title: string; description: string } {
  const p = signal.payload ?? {};
  const targets = Array.isArray(p.targets) ? (p.targets as Array<{ label?: string }>) : [];
  const entity = str(p, 'entity');
  const count = entity === '' ? 0 : Math.max(targets.length, Number(signal.currentValue ?? 0));
  const values = {
    targets: entity ? t(`targets.${entity}`, { count }) : '',
    name: targets[0]?.label ?? '',
  };
  return {
    title: t(`${signal.kind}.title`, values),
    description: t(`${signal.kind}.description`, values),
  };
}

export function signalTexts(signal: Signal, t: Translator): { title: string; description: string } {
  if (isLibrarySignalKind(signal.kind)) return librarySignalTexts(signal, t);
  const p = signal.payload;
  const values = ((): Record<string, string | number> => {
    switch (signal.kind) {
      case 'sharp_drop':
      case 'visibility_slipping':
        return { from: signal.previousValue ?? 0, to: signal.currentValue ?? 0 };
      case 'platform_gap':
        return {
          platform: str(p, 'platform'),
          best: str(p, 'bestPlatform'),
          rate: signal.currentValue ?? 0,
          bestRate: signal.previousValue ?? 0,
        };
      case 'competitor_citation_gap':
        return {
          competitor: str(p, 'competitorName'),
          theirs: signal.previousValue ?? 0,
          ours: signal.currentValue ?? 0,
        };
      case 'prompt_gain':
        return { prompt: str(p, 'promptText'), gain: signal.changeValue ?? 0 };
      case 'new_engine':
        return { platform: str(p, 'platform') };
      case 'lost_citations':
        return { prompt: str(p, 'promptText') };
      case 'first_citation':
        return { url: str(p, 'label') || str(p, 'url'), prompt: str(p, 'promptText') };
      case 'competitor_surge':
        return {
          name: str(p, 'competitorName'),
          from: signal.previousValue ?? 0,
          to: signal.currentValue ?? 0,
        };
      case 'competitor_crossed':
      case 'competitor_overtaken':
        return {
          name: str(p, 'competitorName'),
          competitorRate: Number(p.competitorRate ?? 0),
          brandRate: Number(p.brandRate ?? 0),
        };
      case 'page_opportunity':
        return {
          page: str(p, 'landingPage'),
          rank: Number(p.valueRank ?? 0),
          signal: str(p, 'valueSignal').replace('_', ' '),
        };
      case 'uncited_mentions':
        return { count: signal.currentValue ?? 0 };
      case 'audit_low_score':
        return { count: signal.currentValue ?? 0 };
    }
  })();

  return {
    title: t(`${signal.kind}.title`, values),
    description: t(`${signal.kind}.description`, values),
  };
}

/** What the Affected column shows: a compact count label + optional detail. */
export function signalAffected(
  signal: Signal,
  t: Translator,
): { label: string; detail: string | null } {
  const p = signal.payload;
  if (isLibrarySignalKind(signal.kind)) {
    // The count for a group, the thing itself for a single finding.
    const targets = Array.isArray(p.targets) ? (p.targets as Array<{ label?: string }>) : [];
    const entity = str(p, 'entity');
    const count = Math.max(targets.length, Number(signal.currentValue ?? 0));
    if (targets.length === 1) return { label: targets[0]?.label ?? '', detail: null };
    return {
      label: entity ? t(`affected.${entity}`, { count }) : '',
      detail: targets[0]?.label ?? null,
    };
  }
  switch (signal.kind) {
    case 'sharp_drop':
    case 'visibility_slipping':
      return { label: t('affected.allPrompts'), detail: null };
    case 'platform_gap':
      return { label: t('affected.platform'), detail: str(p, 'platform') };
    case 'competitor_citation_gap':
      return { label: t('affected.competitor'), detail: str(p, 'competitorName') };
    case 'prompt_gain':
    case 'lost_citations':
      return { label: t('affected.prompts', { count: 1 }), detail: str(p, 'promptText') };
    case 'new_engine':
      return { label: t('affected.platform'), detail: str(p, 'platform') };
    case 'first_citation':
      return { label: t('affected.urls', { count: 1 }), detail: str(p, 'label') || str(p, 'url') };
    case 'competitor_surge':
    case 'competitor_crossed':
    case 'competitor_overtaken':
      return { label: t('affected.competitor'), detail: str(p, 'competitorName') };
    case 'page_opportunity':
      return { label: t('affected.urls', { count: 1 }), detail: str(p, 'landingPage') };
    case 'uncited_mentions': {
      const count = Array.isArray(p.promptIds) ? p.promptIds.length : (signal.currentValue ?? 0);
      return { label: t('affected.prompts', { count: Number(count) }), detail: null };
    }
    case 'audit_low_score': {
      const urls = Array.isArray(p.urls) ? (p.urls as { url?: string }[]) : [];
      return {
        label: t('affected.urls', { count: Number(signal.currentValue ?? urls.length) }),
        detail: urls[0]?.url ?? null,
      };
    }
  }
}
