'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Target } from 'lucide-react';
import { getPageOpportunities, type PageOpportunity } from '@/lib/actions/traffic';

/**
 * Pages that carry weight and get nothing from AI engines (#719).
 *
 * Reads the nightly detection run rather than computing anything: the
 * ranking, the signal and the evidence were decided server-side, and
 * recomputing them here would let the card disagree with what the engine
 * stored.
 *
 * Renders nothing at all when there are no findings — a brand without a
 * mapped Analytics property should not meet an empty card explaining a
 * feature it has not connected.
 */

/**
 * How the ranking is described, in the words of the metric that produced it.
 *
 * The engine ranks on whatever the property reports — money where there is
 * money, engagement where there is not — and this is the half that keeps the
 * page honest about which. Calling an engagement rank "your most valuable
 * page" would be a true sentence about the wrong thing.
 */
const SIGNAL_COPY: Record<
  PageOpportunity['valueSignal'],
  { label: string; column: string; explain: string }
> = {
  revenue: {
    label: 'by revenue',
    column: 'Revenue',
    explain: 'Ranked by the revenue these pages produced.',
  },
  transactions: {
    label: 'by orders',
    column: 'Orders',
    explain: 'Ranked by how many orders started on these pages.',
  },
  key_events: {
    label: 'by conversions',
    column: 'Conversions',
    explain: 'Ranked by the conversions Analytics records on these pages.',
  },
  engagement: {
    label: 'by engagement',
    column: 'Engagement',
    explain:
      'Ranked by time on page, because this property reports no revenue or conversions. Set up key events in Analytics to rank these by what they earn instead.',
  },
};

/**
 * Why a page that earns gets nothing from AI engines.
 *
 * The three states need three different actions, and the card exists to say
 * which. A page cited a hundred times that still earns no visit is a
 * click-through problem; a page nothing points at is a coverage gap; a page a
 * prompt targets and no answer cites is a visibility loss. Presenting them
 * identically — which this card did until the engine could tell them apart —
 * sends two customers in three to fix the wrong thing.
 */
const CITATION_COPY: Record<
  Exclude<PageOpportunity['citationState'], null>,
  { label: string; detail: (row: PageOpportunity) => string }
> = {
  cited: {
    label: 'Cited',
    detail: (row) =>
      `${row.citations.toLocaleString()} citation${row.citations === 1 ? '' : 's'} in answers`,
  },
  targeted_not_cited: {
    label: 'Not cited',
    detail: (row) =>
      `${row.targetingPrompts} prompt${row.targetingPrompts === 1 ? '' : 's'} target this page`,
  },
  not_targeted: {
    label: 'No prompt',
    detail: () => 'nothing you track points here',
  },
};

function signalValue(row: PageOpportunity): string {
  if (row.valueSignal === 'revenue') return row.revenue.toLocaleString();
  if (row.valueSignal === 'transactions') return row.transactions.toLocaleString();
  if (row.valueSignal === 'key_events') return row.keyEvents.toLocaleString();
  const minutes = Math.round(row.engagementSeconds / 60);
  return `${minutes.toLocaleString()} min`;
}

export function PageOpportunitiesCard({ brandId }: { brandId: string }) {
  // The loaded rows carry the brand they belong to, rather than a separate
  // loading flag reset inside the effect: resetting state synchronously there
  // costs a cascading render, and comparing the stored brand answers the same
  // question — whose data is this — without one.
  const [loaded, setLoaded] = useState<{ brandId: string; rows: PageOpportunity[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPageOpportunities(brandId)
      .then((rows) => {
        if (!cancelled) setLoaded({ brandId, rows });
      })
      .catch((err) => {
        // Best effort: this card is an addition to the page, and a failure
        // here must not take the traffic analytics down with it.
        console.error('Failed to load page opportunities:', err);
        if (!cancelled) setLoaded({ brandId, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  // While a brand switch is in flight the previous brand's findings must not
  // render under the new brand's name.
  if (loaded?.brandId !== brandId || loaded.rows.length === 0) return null;

  const rows = loaded.rows;
  const copy = SIGNAL_COPY[rows[0].valueSignal];
  const windowDays = rows[0].windowDays;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Target className="h-4 w-4 text-muted-foreground" />
            Pages AI engines aren&apos;t sending traffic to
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            Google Analytics · last {windowDays} days
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {copy.explain} None of these received a visit from an AI assistant in the window, and{' '}
          <span className="font-medium">AI visibility</span> says why: whether answers already cite
          the page, whether a prompt you track points at it, or whether nothing does.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Page</TableHead>
              <TableHead>AI visibility</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">{copy.column}</TableHead>
              <TableHead className="text-right pr-6">Rank {copy.label}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.landingPage} className="hover:bg-muted/50">
                <TableCell className="pl-6 max-w-[280px]">
                  <span className="font-mono text-xs text-muted-foreground line-clamp-1">
                    {row.landingPage}
                  </span>
                </TableCell>
                <TableCell>
                  {/* Null on findings raised before the classification landed:
                      the next nightly run fills them, and saying nothing beats
                      guessing which of the three they are. */}
                  {row.citationState ? (
                    <div className="space-y-0.5">
                      <Badge
                        variant={row.citationState === 'cited' ? 'secondary' : 'outline'}
                        className="text-xs"
                      >
                        {CITATION_COPY[row.citationState].label}
                      </Badge>
                      <div className="text-[10px] text-muted-foreground">
                        {CITATION_COPY[row.citationState].detail(row)}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">&mdash;</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {row.sessions.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-sm">
                  {signalValue(row)}
                </TableCell>
                <TableCell className="text-right pr-6 tabular-nums text-sm text-muted-foreground">
                  #{row.valueRank}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
