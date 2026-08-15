'use client';

import { useEffect, useState, useCallback, useMemo, useTransition, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Plus,
  X,
  RefreshCw,
  Loader2,
  TrendingUp,
  Tag,
  AlertTriangle,
  SearchCheck,
  Shield,
  Search as SearchIcon,
  Trash2,
  BarChart3,
} from 'lucide-react';
import { Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  getPromptSuggestions,
  refreshPromptSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  type PromptSuggestion,
} from '@/lib/actions/prompt-suggestions';
import {
  gaSourceData,
  gscSourceData,
  type GaSuggestionSourceData,
  type GscSuggestionBadge,
} from '@/lib/prompt-suggestion-source';

/**
 * Analytics evidence, in the customer's own numbers (#705). A blind spot is
 * argued from money, momentum from the engines already sending visitors —
 * showing the wrong one would make a true statement about the wrong thing.
 */
function gaEvidence(d: GaSuggestionSourceData): { label: string; tooltip: string } {
  if (d.kind === 'ai_momentum') {
    const engines = d.aiPlatforms.length ? d.aiPlatforms.join(', ') : 'AI assistants';
    return {
      label: `AI traffic · ${d.aiSessions.toLocaleString()} sessions`,
      tooltip: `${engines} already sent ${d.aiSessions.toLocaleString()} visits to ${d.landingPage} in the last 28 days. That topic is demonstrably answerable by an AI engine and you are already a candidate source for it — tracking a prompt around it turns an accident into a measured position.`,
    };
  }
  const earns =
    d.revenue > 0
      ? `${d.revenue.toLocaleString()} in revenue`
      : `${d.keyEvents.toLocaleString()} conversions`;
  return {
    label: `#${d.rank} by ${d.revenue > 0 ? 'revenue' : 'conversions'}`,
    tooltip: `${d.landingPage} produced ${earns} from ${d.sessions.toLocaleString()} sessions in the last 28 days, and nothing you track would surface it in an AI answer. Anyone asking an assistant about this has no way to find you.`,
  };
}

const GSC_BADGES: Record<GscSuggestionBadge, { label: string; tooltip: string }> = {
  protect_traffic: {
    label: 'Protect traffic',
    tooltip:
      'This query drives real clicks to your site today. People increasingly ask AI assistants the same questions — track it so AI answers don\u2019t erode traffic you already earn.',
  },
  capture_demand: {
    label: 'Capture demand',
    tooltip:
      'People search this heavily on Google and you appear in results, but almost nobody clicks through. Being cited in AI answers is a second chance to capture this proven demand.',
  },
  low_competition: {
    label: 'Low competition',
    tooltip:
      'Advertiser competition on this term is low \u2014 becoming the answer AI assistants cite is a cheap win here.',
  },
};

/**
 * Portal-based hover/focus tooltip (same pattern as the Insights InfoTip) —
 * native title attributes are delayed and unreliable, which read as broken.
 */
function HoverTip({ content, children }: { content: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
  }
  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        className="inline-flex cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === 'Escape') hide();
        }}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: pos.x, top: pos.y, transform: 'translateX(-50%)' }}
            className="pointer-events-none fixed z-[9999] w-64 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Where a suggestion came from, as badges (#659).
 *
 * Every suggestion is phrased by our own generation step, so `Ansvisor Agents`
 * is always present; a data source badge joins it when the suggestion was
 * mined from the brand's own Search Console or Analytics rather than from the
 * model alone. Two badges is the honest reading — the data and the phrasing
 * come from different places.
 */
function SourceBadges({ suggestion }: { suggestion: PromptSuggestion }) {
  const gsc = gscSourceData(suggestion);
  const ga = gaSourceData(suggestion);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {gsc && (
        <HoverTip
          content={`From your Google Search Console data — the query "${gsc.query}" got ${gsc.impressions.toLocaleString()} impressions in the last 28 days.`}
        >
          <Badge variant="outline" className="gap-1.5 bg-card text-xs font-normal">
            <SearchCheck className="h-3.5 w-3.5 text-blue-500" />
            Google Search Console
          </Badge>
        </HoverTip>
      )}
      {ga && (
        <HoverTip
          content={`From your Google Analytics — derived from ${ga.pageTitle ? `"${ga.pageTitle}" (${ga.landingPage})` : ga.landingPage}, read from the page itself rather than from its URL or product name.`}
        >
          <Badge variant="outline" className="gap-1.5 bg-card text-xs font-normal">
            <BarChart3 className="h-3.5 w-3.5 text-amber-500" />
            Google Analytics (GA4)
          </Badge>
        </HoverTip>
      )}
      <HoverTip content="Phrased by Ansvisor from your brand, the prompts you already track, and the competitors cited in your AI answers.">
        <Badge variant="outline" className="gap-1.5 bg-card text-xs font-normal">
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
          Ansvisor Agents
        </Badge>
      </HoverTip>
    </div>
  );
}

/** Which data source a row carries, for the source filter. */
type SourceFilter = 'all' | 'gsc' | 'ga' | 'agents';

const SOURCE_FILTER_LABELS: Record<SourceFilter, string> = {
  all: 'All sources',
  gsc: 'Google Search Console',
  ga: 'Google Analytics (GA4)',
  agents: 'Ansvisor Agents only',
};

interface Props {
  brandId: string;
  onAccepted?: () => void;
}

export function SuggestionsCard({ brandId, onAccepted }: Props) {
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [clearing, setClearing] = useState(false);
  const [, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { suggestions: s } = await getPromptSuggestions(brandId);
      setSuggestions(s);
      setLoaded(true);
    } catch (err) {
      console.error('Failed to load suggestions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load suggestions');
      toast.error('Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setLoaded(false);
    setSuggestions([]);
    setError(null);
  }, [brandId]);

  // Fetching on mount is safe here because this component only mounts when
  // the Suggestions tab is open — the tab click is the user asking for it.
  // It must not move back above a tab boundary: as an always-mounted card its
  // request became the first entry in Next's serialised server-action queue,
  // and every hiccup in it stalled the prompt table's own fetch behind it.
  useEffect(() => {
    if (!loaded && !loading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, brandId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await refreshPromptSuggestions(brandId);
      setSuggestions(fresh);
      setLoaded(true);
      setError(null);
      toast.success('Suggestions refreshed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suggestions.filter((s) => {
      if (sourceFilter === 'gsc' && !gscSourceData(s)) return false;
      if (sourceFilter === 'ga' && !gaSourceData(s)) return false;
      if (sourceFilter === 'agents' && (gscSourceData(s) || gaSourceData(s))) return false;
      if (!q) return true;
      return (
        s.suggestedText.toLowerCase().includes(q) ||
        (s.topicName ?? '').toLowerCase().includes(q) ||
        (s.reason ?? '').toLowerCase().includes(q)
      );
    });
  }, [suggestions, sourceFilter, search]);

  /**
   * Dismiss everything on screen. Kept to what is actually listed rather than
   * "every suggestion for this brand": dismissing a Search Console or
   * Analytics row keeps that query or page out of the pool for 30 days, so
   * clearing a filtered view must not silently suppress rows the user never
   * looked at.
   */
  const handleClearAll = () => {
    const doomed = visible;
    if (doomed.length === 0) return;
    setClearing(true);
    const ids = new Set(doomed.map((d) => d.id));
    setSuggestions((prev) => prev.filter((x) => !ids.has(x.id)));
    Promise.allSettled(doomed.map((d) => dismissSuggestion(d.id)))
      .then((results) => {
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          toast.error(`${failed} suggestion${failed === 1 ? '' : 's'} could not be dismissed`);
          load();
        }
      })
      .finally(() => setClearing(false));
  };

  const handleAccept = (s: PromptSuggestion) => {
    setPendingId(s.id);
    startTransition(async () => {
      try {
        const result = await acceptSuggestion(s.id);
        if ('error' in result) {
          toast.error(result.error);
          return;
        }
        setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
        onAccepted?.();
        toast.success('Prompt added to your tracked list');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add');
      } finally {
        setPendingId(null);
      }
    });
  };

  const handleDismiss = (s: PromptSuggestion) => {
    setPendingId(s.id);
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    dismissSuggestion(s.id)
      .catch(() => {
        // Roll back on failure
        setSuggestions((prev) => [...prev, s]);
        toast.error('Failed to dismiss');
      })
      .finally(() => setPendingId(null));
  };

  return (
    <Card id="prompt-opportunities">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold">Prompt Suggestions</CardTitle>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : (
                loaded &&
                suggestions.length > 0 && (
                  <Badge variant="secondary" className="text-xs tabular-nums">
                    {suggestions.length}
                  </Badge>
                )
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              AI-driven suggestions based on your data and industry trends.
            </p>
          </div>

          {loaded && suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={sourceFilter}
                onValueChange={(v) => setSourceFilter((v as SourceFilter) ?? 'all')}
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="All sources">
                    {(value) => SOURCE_FILTER_LABELS[(value as SourceFilter) ?? 'all']}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SOURCE_FILTER_LABELS) as SourceFilter[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {SOURCE_FILTER_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative w-52">
                <SearchIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search prompts…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>

              <Button
                onClick={handleRefresh}
                disabled={refreshing}
                size="sm"
                variant="outline"
                className="gap-2"
              >
                {refreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {refreshing ? 'Generating…' : 'New'}
              </Button>

              <Button
                onClick={handleClearAll}
                disabled={clearing || visible.length === 0}
                size="sm"
                variant="outline"
                className="gap-2 text-muted-foreground"
                title="Dismiss every suggestion listed below"
              >
                {clearing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Clear All
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive/60 mb-2" />
            <p className="text-sm font-medium mb-1">Couldn&apos;t load suggestions</p>
            <p className="text-xs text-muted-foreground mb-3 max-w-sm">{error}</p>
            <Button onClick={load} disabled={loading} size="sm" variant="outline" className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm font-medium mb-1">No suggestions right now</p>
            <p className="text-xs text-muted-foreground mb-3 max-w-sm">
              Click refresh to generate new prompt ideas tailored to your brand and competitor
              activity.
            </p>
            <Button onClick={handleRefresh} disabled={refreshing} size="sm" className="gap-2">
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Generate Suggestions
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Column headings, so the source column reads as a column rather
                than as loose badges beside the text. */}
            <div className="hidden gap-3 px-3 text-xs text-muted-foreground sm:grid sm:grid-cols-[2.25rem_1fr_18rem_5rem]">
              <span />
              <span>Prompt</span>
              <span>Source</span>
              <span />
            </div>

            {visible.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No suggestions match this filter.
              </p>
            ) : (
              <ul className="space-y-2">
                {visible.map((s, index) => {
                  const busy = pendingId === s.id;
                  const gsc = gscSourceData(s);
                  const ga = gaSourceData(s);
                  return (
                    <li
                      key={s.id}
                      className="grid items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/30 sm:grid-cols-[2.25rem_1fr_18rem_5rem]"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>

                      <div className="min-w-0 space-y-1.5">
                        <p className="text-sm font-medium leading-snug">{s.suggestedText}</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {s.topicName && (
                            <Badge variant="outline" className="gap-1 text-xs font-normal">
                              <Tag className="h-3 w-3" />
                              {s.topicName}
                            </Badge>
                          )}
                          {/* Measured rows carry real figures — showing the
                              modelled estimate beside measured data reads as a
                              contradiction. */}
                          {gsc ? (
                            <Badge
                              variant="outline"
                              className="gap-1 text-xs font-normal tabular-nums"
                            >
                              <TrendingUp className="h-3 w-3" />
                              {gsc.impressions.toLocaleString()} impr/mo
                            </Badge>
                          ) : ga ? (
                            <HoverTip content={gaEvidence(ga).tooltip}>
                              <Badge
                                variant="outline"
                                className="gap-1 text-xs font-normal tabular-nums"
                              >
                                <TrendingUp className="h-3 w-3" />
                                {gaEvidence(ga).label}
                              </Badge>
                            </HoverTip>
                          ) : (
                            s.estVolume != null &&
                            s.estVolume > 0 && (
                              <Badge
                                variant="outline"
                                className="gap-1 text-xs font-normal tabular-nums"
                              >
                                <TrendingUp className="h-3 w-3" />~{s.estVolume.toLocaleString()}/mo
                              </Badge>
                            )
                          )}
                          {gsc?.badge && (
                            <HoverTip content={GSC_BADGES[gsc.badge].tooltip}>
                              <Badge variant="outline" className="text-xs font-normal">
                                {GSC_BADGES[gsc.badge].label}
                              </Badge>
                            </HoverTip>
                          )}
                        </div>
                        {s.reason && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {s.reason}
                          </p>
                        )}
                      </div>

                      <SourceBadges suggestion={s} />

                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          onClick={() => handleAccept(s)}
                          disabled={busy}
                          title="Add to tracked prompts"
                          aria-label="Add to tracked prompts"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => handleDismiss(s)}
                          disabled={busy}
                          title="Dismiss suggestion"
                          aria-label="Dismiss suggestion"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
