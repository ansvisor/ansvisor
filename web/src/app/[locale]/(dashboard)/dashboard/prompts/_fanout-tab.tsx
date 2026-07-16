'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import {
  getQueryFanout,
  trackFanoutQuery,
  classifyFanoutIntents,
  type QueryFanoutData,
  type FanoutSubQuery,
} from '@/lib/actions/fanout';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import { INTENT_LABELS, INTENT_COLORS } from '@/config/intent-labels';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check, ChevronRight, Plus, Loader2, Search } from 'lucide-react';

function platformLabel(slug: string): string {
  return PLATFORM_LABELS[slug] ?? slug;
}

type View = 'frequency' | 'by-prompt';

interface PromptGroup {
  prompt: { id: string; text: string };
  subQueries: FanoutSubQuery[];
}

type QueryFanoutTabProps = {
  brandId: string;
  onTracked?: () => void | Promise<void>;
};

/**
 * Background intent-classification batch size (#431). One request per chunk:
 * a chunk of 20 cold queries is at most ~4 LLM waves on the server
 * (concurrency 6), comfortably inside the action's 20s fetch timeout —
 * classifying the whole observed set in one request was not (120 cold
 * queries ≈ 40s+, aborted, badges never arrived that session).
 */
const INTENT_CHUNK_SIZE = 20;

/**
 * Server-action failures reach the client with Next's production-masked
 * message ("An error occurred in the Server Components render… A digest
 * property is included…"), which is meaningless to users (#427). Surface the
 * real message only when it survived; otherwise fall back to a friendly one.
 */
function userErrorMessage(err: unknown, fallback: string): string {
  if (
    err instanceof Error &&
    err.message &&
    !/^An error occurred in the Server/i.test(err.message)
  ) {
    return err.message;
  }
  return fallback;
}

export function QueryFanoutTab({ brandId, onTracked }: QueryFanoutTabProps) {
  const [data, setData] = useState<QueryFanoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  // Intent is keyed by the lower-cased sub-query (matches the server cache key).
  const [intents, setIntents] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>('frequency');
  const [searchText, setSearchText] = useState('');
  const PAGE_SIZE = 10;

  // Mirror of `intents` for the async classification chain (avoids stale
  // closures), plus a run counter so a reload/brand switch/unmount cancels
  // the previous chain instead of racing it.
  const intentsRef = useRef<Record<string, string>>({});
  const intentRunRef = useRef(0);

  /**
   * Classify intents progressively (#431): the visible page's queries first
   * (the list is frequency-sorted, which is exactly page order), then the
   * rest in background chunks, merging each chunk into state as it resolves.
   * Never awaited by the table load — badges fill in; rows never wait.
   */
  const classifyProgressively = useCallback(async (queries: string[]) => {
    const run = ++intentRunRef.current;
    const pending = queries.filter((q) => !(q.toLowerCase() in intentsRef.current));
    if (pending.length === 0) return;

    const chunks: string[][] = [pending.slice(0, PAGE_SIZE)];
    for (let i = PAGE_SIZE; i < pending.length; i += INTENT_CHUNK_SIZE) {
      chunks.push(pending.slice(i, i + INTENT_CHUNK_SIZE));
    }
    for (const chunk of chunks) {
      if (intentRunRef.current !== run) return;
      try {
        const map = await classifyFanoutIntents(chunk);
        if (intentRunRef.current !== run) return;
        intentsRef.current = { ...intentsRef.current, ...map };
        setIntents(intentsRef.current);
      } catch {
        // A failed/timed-out chunk must not kill the chain — its rows keep
        // the "—" placeholder and the next chunk still gets its shot.
      }
    }
  }, []);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
      }
      try {
        const result = await getQueryFanout(brandId, { days: 30 });
        setData(result);
        void classifyProgressively(result.subQueries.map((s) => s.query));
      } catch (err) {
        console.error('[fanout] load failed', err);
        toast.error(userErrorMessage(err, 'Failed to load query fan-out — please retry.'));
        setData({ subQueries: [], totalObserved: 0 });
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [brandId, classifyProgressively],
  );
  useEffect(() => {
    load();
    // Cancel the in-flight classification chain on unmount/brand switch.
    return () => {
      intentRunRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    setPage(1);
    setSearchText('');
  }, [brandId]);

  useEffect(() => {
    setSearchText('');
  }, [view]);

  // Invert sub-query → prompts into prompt → sub-queries for the "By prompt" view.
  const byPrompt = useMemo<PromptGroup[]>(() => {
    if (!data) return [];
    const map = new Map<string, PromptGroup>();
    for (const sq of data.subQueries) {
      for (const p of sq.sourcedPrompts) {
        if (!map.has(p.id)) {
          map.set(p.id, { prompt: p, subQueries: [] });
        }
        map.get(p.id)!.subQueries.push(sq);
      }
    }
    return [...map.values()].sort((a, b) => b.subQueries.length - a.subQueries.length);
  }, [data]);

  const filteredByPrompt = useMemo<PromptGroup[]>(() => {
    if (!searchText) return byPrompt;
    const lower = searchText.toLowerCase();
    return byPrompt.filter((group) => group.prompt.text.toLowerCase().includes(lower));
  }, [byPrompt, searchText]);

  async function handleTrack(query: string) {
    setAddingKey(query.toLowerCase());
    try {
      const result = await trackFanoutQuery(brandId, query);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      toast.success('Added as a tracked prompt');
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subQueries: prev.subQueries.map((sq) => {
            if (sq.query.toLowerCase() === query.toLowerCase()) {
              return {
                ...sq,
                tracked: true,
                trackedPromptId: result.promptId,
              };
            }
            return sq;
          }),
        };
      });
      await load({ silent: true });
      await onTracked?.();
    } catch (err) {
      console.error('[fanout] track failed', err);
      toast.error(userErrorMessage(err, 'Failed to track this query — please retry.'));
    } finally {
      setAddingKey(null);
    }
  }

  const isEmpty = !data || data.subQueries.length === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-medium">Query Fan-out</CardTitle>
          {!loading && !isEmpty && (
            <div className="flex rounded-md border p-0.5">
              <button
                className={cn(
                  'rounded px-3 py-1 text-xs font-medium transition-colors',
                  view === 'frequency'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setView('frequency')}
              >
                High frequency
              </button>
              <button
                className={cn(
                  'rounded px-3 py-1 text-xs font-medium transition-colors',
                  view === 'by-prompt'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setView('by-prompt')}
              >
                By prompt
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {view === 'by-prompt'
            ? 'Your tracked prompts grouped by the sub-queries their answers actually triggered — expand a prompt to see its observed fan-out.'
            : 'The sub-queries answer engines actually ran while building your answers (last 30 days) — observed, never predicted. Sorted by how often they were searched. Track any of them with the + to measure its own visibility.'}
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState />
        ) : view === 'frequency' ? (
          <HighFrequencyView
            subQueries={data.subQueries}
            intents={intents}
            addingKey={addingKey}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onTrack={handleTrack}
          />
        ) : (
          <ByPromptView
            groups={filteredByPrompt}
            intents={intents}
            addingKey={addingKey}
            onTrack={handleTrack}
            searchText={searchText}
            onSearchChange={setSearchText}
          />
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Search className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm font-medium">No fan-out captured yet</p>
      <p className="max-w-md text-xs text-muted-foreground">
        Fan-out is emitted mostly by <span className="font-medium">Copilot</span> and{' '}
        <span className="font-medium">Perplexity</span>, and only for some queries. Once those
        platforms run for your prompts, the observed sub-queries will appear here.
      </p>
    </div>
  );
}

function HighFrequencyView({
  subQueries,
  intents,
  addingKey,
  page,
  pageSize,
  onPageChange,
  onTrack,
}: {
  subQueries: FanoutSubQuery[];
  intents: Record<string, string>;
  addingKey: string | null;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onTrack: (query: string) => void;
}) {
  const totalPages = Math.ceil(subQueries.length / pageSize);
  const pageRows = subQueries.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
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
          {pageRows.map((sq) => {
            const key = sq.query.toLowerCase();
            return (
              <TableRow key={key}>
                <TableCell className="font-medium">{sq.query}</TableCell>
                <TableCell>
                  <EngineBadges engines={sq.engines} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{sq.timesSearched}</TableCell>
                <TableCell>
                  <SourcedPrompts prompts={sq.sourcedPrompts} />
                </TableCell>
                <TableCell>
                  <IntentBadge intent={intents[key]} />
                </TableCell>
                <TableCell className="text-right">
                  <TrackCell sq={sq} adding={addingKey === key} onTrack={onTrack} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-4">
          {Array.from({ length: totalPages }, (_, i) => {
            const p = i + 1;
            return (
              <Button
                key={p}
                variant={page === p ? 'default' : 'ghost'}
                size="sm"
                className="h-7 w-7 p-0 text-xs"
                onClick={() => onPageChange(p)}
              >
                {p}
              </Button>
            );
          })}
        </div>
      )}
    </>
  );
}

function ByPromptView({
  groups,
  intents,
  addingKey,
  onTrack,
  searchText,
  onSearchChange,
}: {
  groups: PromptGroup[];
  intents: Record<string, string>;
  addingKey: string | null;
  onTrack: (query: string) => void;
  searchText: string;
  onSearchChange: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="relative w-60">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search prompts…"
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Search className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No prompts match your search</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[28px]" />
              <TableHead>Prompt</TableHead>
              <TableHead className="w-[110px] text-right">Sub-queries</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(({ prompt, subQueries }) => {
              const isOpen = expanded.has(prompt.id);
              return (
                <Fragment key={prompt.id}>
                  <TableRow
                    className="cursor-pointer select-none"
                    onClick={() => toggle(prompt.id)}
                  >
                    <TableCell className="pr-0">
                      <ChevronRight
                        className={cn(
                          'h-4 w-4 text-muted-foreground transition-transform duration-150',
                          isOpen && 'rotate-90',
                        )}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{prompt.text}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary" className="tabular-nums text-[10px]">
                        {subQueries.length}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow key={`${prompt.id}-expanded`} className="hover:bg-transparent">
                      <TableCell />
                      <TableCell colSpan={2} className="pb-3 pt-0">
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Sub-query</TableHead>
                                <TableHead className="w-[160px]">Engine</TableHead>
                                <TableHead className="w-[120px] text-right">
                                  Times searched
                                </TableHead>
                                <TableHead className="w-[130px] pl-6">Intent</TableHead>
                                <TableHead className="w-[64px] text-right">Track</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {subQueries.map((sq) => {
                                const key = sq.query.toLowerCase();
                                return (
                                  <TableRow key={key} className="align-middle">
                                    <TableCell className="align-middle font-medium">
                                      {sq.query}
                                    </TableCell>
                                    <TableCell className="align-middle">
                                      <EngineBadges engines={sq.engines} />
                                    </TableCell>
                                    <TableCell className="align-middle text-right tabular-nums">
                                      {sq.timesSearched}
                                    </TableCell>
                                    <TableCell className="align-middle pl-6">
                                      <IntentBadge intent={intents[key]} />
                                    </TableCell>
                                    <TableCell className="align-middle text-right">
                                      <TrackCell
                                        sq={sq}
                                        adding={addingKey === key}
                                        onTrack={onTrack}
                                      />
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function EngineBadges({ engines }: { engines: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {engines.map((e) => (
        <Badge key={e} variant="secondary" className="text-[10px]">
          {platformLabel(e)}
        </Badge>
      ))}
    </div>
  );
}

function TrackCell({
  sq,
  adding,
  onTrack,
}: {
  sq: FanoutSubQuery;
  adding: boolean;
  onTrack: (query: string) => void;
}) {
  if (sq.tracked) {
    return (
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
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={adding}
      onClick={(e) => {
        e.stopPropagation();
        onTrack(sq.query);
      }}
      aria-label={`Track "${sq.query}" as a prompt`}
    >
      {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
    </Button>
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
