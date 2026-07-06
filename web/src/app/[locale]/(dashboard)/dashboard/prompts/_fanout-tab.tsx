'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import {
  getQueryFanout,
  trackFanoutQuery,
  classifyFanoutIntents,
  type QueryFanoutData,
} from '@/lib/actions/fanout';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import { INTENT_LABELS, INTENT_COLORS } from '@/config/intent-labels';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check, Plus, Loader2, Search } from 'lucide-react';

function platformLabel(slug: string): string {
  return PLATFORM_LABELS[slug] ?? slug;
}

export function QueryFanoutTab({ brandId }: { brandId: string }) {
  const [data, setData] = useState<QueryFanoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  // Intent is keyed by the lower-cased sub-query (matches the server cache key).
  const [intents, setIntents] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getQueryFanout(brandId, { days: 30 });
      setData(result);
      // Fill in intents on-demand (cached server-side) — non-blocking, so the
      // table paints immediately and the intent badges appear as they resolve.
      const queries = result.subQueries.map((s) => s.query);
      if (queries.length > 0) {
        classifyFanoutIntents(queries)
          .then((map) => setIntents((prev) => ({ ...prev, ...map })))
          .catch(() => {});
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load query fan-out');
      setData({ subQueries: [], totalObserved: 0 });
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleTrack(query: string) {
    setAddingKey(query.toLowerCase());
    try {
      await trackFanoutQuery(brandId, query);
      toast.success('Added as a tracked prompt');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to track this query');
    } finally {
      setAddingKey(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Query fan-out</CardTitle>
        <p className="text-xs text-muted-foreground">
          The sub-queries answer engines actually ran while building your answers (last 30 days) —
          observed, never predicted. Sorted by how often they were searched. Track any of them with
          the <span className="font-medium">+</span> to measure its own visibility.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : !data || data.subQueries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Search className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No fan-out captured yet</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Fan-out is emitted mostly by <span className="font-medium">Copilot</span> and{' '}
              <span className="font-medium">Perplexity</span>, and only for some queries. Once those
              platforms run for your prompts, the observed sub-queries will appear here.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sub-query</TableHead>
                <TableHead className="w-[160px]">Engine</TableHead>
                <TableHead className="w-[120px] text-right">Times searched</TableHead>
                <TableHead className="w-[220px]">Sourced prompts</TableHead>
                <TableHead className="w-[130px]">Intent</TableHead>
                <TableHead className="w-[64px] text-right">Track</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.subQueries.map((sq) => {
                const key = sq.query.toLowerCase();
                const adding = addingKey === key;
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{sq.query}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {sq.engines.map((e) => (
                          <Badge key={e} variant="secondary" className="text-[10px]">
                            {platformLabel(e)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{sq.timesSearched}</TableCell>
                    <TableCell>
                      <SourcedPrompts prompts={sq.sourcedPrompts} />
                    </TableCell>
                    <TableCell>
                      <IntentBadge intent={intents[key]} />
                    </TableCell>
                    <TableCell className="text-right">
                      {sq.tracked ? (
                        <Badge
                          variant="outline"
                          className="gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"
                          render={
                            sq.trackedPromptId ? (
                              <Link href={`/dashboard/prompts/${sq.trackedPromptId}`} />
                            ) : undefined
                          }
                        >
                          <Check className="h-3 w-3" />
                          Tracked
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={adding}
                          onClick={() => handleTrack(sq.query)}
                          aria-label={`Track "${sq.query}" as a prompt`}
                        >
                          {adding ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SourcedPrompts({ prompts }: { prompts: { id: string; text: string }[] }) {
  if (prompts.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const shown = prompts.slice(0, 2);
  const rest = prompts.slice(2);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((p) => (
        <Link
          key={p.id}
          href={`/dashboard/prompts/${p.id}`}
          title={p.text}
          className="max-w-[160px] truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {p.text}
        </Link>
      ))}
      {rest.length > 0 && (
        <span
          className="text-[11px] text-muted-foreground"
          title={rest.map((p) => p.text).join('\n')}
        >
          +{rest.length}
        </span>
      )}
    </div>
  );
}

function IntentBadge({ intent }: { intent?: string }) {
  // Intents load on-demand (async, cached server-side); show a placeholder
  // until this row's classification resolves.
  if (!intent) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] whitespace-nowrap', INTENT_COLORS[intent] ?? '')}
    >
      {INTENT_LABELS[intent] ?? intent}
    </Badge>
  );
}
