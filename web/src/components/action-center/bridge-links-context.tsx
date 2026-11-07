'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pagePath } from '@/lib/content/overlap';

/** Why a page is a link's target (server action-center/bridge-links.js). */
const REASONS = ['sells', 'converts', 'sales_page', 'new_page'] as const;
type Reason = (typeof REASONS)[number];
const SALES_PAGES = ['pricing', 'demo', 'product', 'category', 'feature'] as const;
type SalesPage = (typeof SALES_PAGES)[number];

export interface BridgeLinkPair {
  from: string;
  to: string;
  anchor: string | null;
  reason: Reason | null;
  salesPage: SalesPage | null;
  aiVisits: number;
  citations: number;
  toKeyEvents: number;
  toTransactions: number;
}

const ADDRESS = /^https?:\/\//i;

/** The payload's pairs (payload.linkPairs), read defensively: any may be missing or of the wrong shape. */
export function bridgeLinkPairs(payload: Record<string, unknown>): BridgeLinkPair[] {
  const raw = Array.isArray(payload.linkPairs) ? payload.linkPairs : [];
  return raw.flatMap((item) => {
    const p = (item ?? {}) as Record<string, unknown>;
    if (typeof p.from !== 'string' || typeof p.to !== 'string') return [];
    if (!ADDRESS.test(p.from) || !ADDRESS.test(p.to)) return [];
    return [
      {
        from: p.from,
        to: p.to,
        anchor: typeof p.anchor === 'string' && p.anchor.trim() ? p.anchor.trim() : null,
        reason: (REASONS as readonly unknown[]).includes(p.reason) ? (p.reason as Reason) : null,
        salesPage: (SALES_PAGES as readonly unknown[]).includes(p.salesPage)
          ? (p.salesPage as SalesPage)
          : null,
        aiVisits: Number(p.aiVisits) || 0,
        citations: Number(p.citations) || 0,
        toKeyEvents: Number(p.toKeyEvents) || 0,
        toTransactions: Number(p.toTransactions) || 0,
      },
    ];
  });
}

/** The link plan as text to paste: one line per pair, worded by `line`. */
export function linkPlanText(
  pairs: readonly BridgeLinkPair[],
  line: (pair: BridgeLinkPair) => string,
): string {
  return pairs.map(line).join('\n');
}

/**
 * A bridge links action (G20, AC plan P-10, spec §8): the pages AI sends
 * readers to that rarely convert, each with the page on its topic that
 * converts, and the link text suggested for it. Start now opens each
 * source page in the Content Editor with its link in Your input; Copy link
 * plan gives the pairs to paste where the pages are edited.
 */
export function BridgeLinksContext({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.bridgeLinks');
  const pairs = bridgeLinkPairs(payload);

  const target = (pair: BridgeLinkPair) =>
    pair.reason === 'sells'
      ? t('reasons.sells', { count: pair.toTransactions })
      : pair.reason === 'converts'
        ? t('reasons.converts', { count: pair.toKeyEvents })
        : pair.reason === 'sales_page'
          ? t(`salesPages.${pair.salesPage ?? 'product'}`)
          : pair.reason === 'new_page'
            ? t('reasons.new_page')
            : null;

  const copy = async () => {
    const text = linkPlanText(pairs, (pair) =>
      pair.anchor
        ? t('planLine', { from: pair.from, to: pair.to, anchor: pair.anchor })
        : t('planLineNoAnchor', { from: pair.from, to: pair.to }),
    );
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  return (
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('why')}</p>
      {pairs.length > 0 ? (
        <ul className="space-y-1.5">
          {pairs.map((pair) => {
            const reason = target(pair);
            return (
              <li key={`${pair.from}→${pair.to}`} className="rounded-md border px-3 py-2 text-xs">
                <p className="truncate font-mono" title={pair.from}>
                  {pagePath(pair.from)}
                </p>
                <p className="tabular-nums text-muted-foreground">
                  {t('sourceFigures', { aiVisits: pair.aiVisits, citations: pair.citations })}
                </p>
                <p className="mt-1 truncate font-mono" title={pair.to}>
                  → {pagePath(pair.to)}
                </p>
                {reason && <p className="text-muted-foreground">{reason}</p>}
                {pair.anchor && <p className="mt-1">{t('anchor', { anchor: pair.anchor })}</p>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('none')}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pairs.length === 0}
          onClick={() => void copy()}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          {t('copyPlan')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('startNow')}</p>
      </div>
    </section>
  );
}
