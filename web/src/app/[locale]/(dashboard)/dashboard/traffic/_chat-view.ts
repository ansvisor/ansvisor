import type { TrafficLog } from '@/lib/actions/traffic';
import { viewRows, type ChatPageView } from '@/lib/chat/page-view';
import { getPlatformName } from '@/lib/traffic-platforms';

/**
 * What Chat's side panel sees of AI Referral Traffic beyond its range and
 * platform (the owner's plan of 2026-11-16, item 8): the visit list's
 * search, and once read, the visits on screen (their landing page and the
 * AI they came from) with how many match. Undefined when there is nothing.
 */
export function trafficChatView(
  search: string,
  visits: { logs: readonly TrafficLog[]; total: number } | null,
): ChatPageView | undefined {
  const view: ChatPageView = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(visits
      ? {
          rows: viewRows(visits.logs, (log) => ({
            ref: log.id,
            label: log.sourcePlatform
              ? `${log.url} · ${getPlatformName(log.sourcePlatform)}`
              : log.url,
          })),
          total: visits.total,
        }
      : {}),
  };
  return Object.keys(view).length > 0 ? view : undefined;
}
