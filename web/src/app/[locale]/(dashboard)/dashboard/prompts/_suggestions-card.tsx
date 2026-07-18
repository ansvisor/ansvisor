'use client';

import { useEffect, useState, useCallback, useTransition } from 'react';
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
  Info,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getPromptSuggestions,
  refreshPromptSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  type PromptSuggestion,
} from '@/lib/actions/prompt-suggestions';

interface Props {
  brandId: string;
  onAccepted?: () => void;
}

/** localStorage key remembering whether the card is expanded across visits. */
const EXPANDED_KEY = 'aeo:prompt-suggestions-expanded';

export function SuggestionsCard({ brandId, onAccepted }: Props) {
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Collapsed by default so the card is a one-line strip and the prompt table
  // stays above the fold; the user's last choice is remembered. Starts false
  // on both server and client (no hydration mismatch), then the effect below
  // restores the stored preference.
  const [expanded, setExpanded] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    try {
      if (localStorage.getItem(EXPANDED_KEY) === '1') setExpanded(true);
    } catch {
      // Storage unavailable (private mode) — stay collapsed.
    }
    if (window.location.hash === '#prompt-opportunities') {
      // Deep links mean "show me the suggestions" — expand (without touching
      // the stored preference) and scroll the card into view.
      setExpanded(true);
      document.getElementById('prompt-opportunities')?.scrollIntoView();
    }
  }, []);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(EXPANDED_KEY, next ? '1' : '0');
      } catch {
        // Preference just won't persist.
      }
      return next;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { suggestions: s } = await getPromptSuggestions(brandId);
      setSuggestions(s);
      setLoaded(true);
    } catch (err) {
      console.error('Failed to load suggestions:', err);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  // Fetch ONLY once the card is actually expanded — never on page load. The
  // collapsed strip must not fire a server action: when this card moved to
  // the All Prompts tab its mount-time call became the FIRST action in
  // Next's serialized queue and every hiccup in it stalled the prompt
  // table's own data fetch behind it (the "table spins forever" bug). While
  // collapsed the card costs zero requests, exactly like before the move.
  useEffect(() => {
    setLoaded(false);
    setSuggestions([]);
  }, [brandId]);

  useEffect(() => {
    if (expanded && !loaded && !loading) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, loaded, brandId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await refreshPromptSuggestions(brandId);
      setSuggestions(fresh);
      setLoaded(true);
      toast.success('Suggestions refreshed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const handleAccept = (s: PromptSuggestion) => {
    setPendingId(s.id);
    startTransition(async () => {
      try {
        await acceptSuggestion(s.id);
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
      <CardHeader className={expanded ? 'pb-3' : 'py-4'}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            className="flex items-center gap-2 text-left"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">Prompt Suggestions</CardTitle>
            <Info
              className="h-3.5 w-3.5 text-muted-foreground cursor-help"
              aria-label="AI-generated prompt ideas based on your brand, existing tracked prompts, and competitors cited in AI answers."
            >
              <title>
                AI-generated prompt ideas based on your brand, existing tracked prompts, and
                competitors cited in AI answers.
              </title>
            </Info>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : loaded && suggestions.length > 0 ? (
              <Badge variant="secondary" className="text-xs tabular-nums">
                {suggestions.length}
              </Badge>
            ) : loaded ? (
              !expanded && (
                <span className="text-xs text-muted-foreground">no new ideas — expand</span>
              )
            ) : (
              !expanded && (
                <span className="text-xs text-muted-foreground">expand for AI prompt ideas</span>
              )
            )}
          </button>
          {expanded && (
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
              {refreshing ? 'Generating…' : 'Refresh'}
            </Button>
          )}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
            <ul className="space-y-2">
              {suggestions.map((s) => {
                const busy = pendingId === s.id;
                return (
                  <li
                    key={s.id}
                    className="group flex items-start gap-3 rounded-lg border bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <p className="text-sm font-medium leading-snug">{s.suggestedText}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {s.topicName && (
                          <Badge variant="outline" className="gap-1 text-xs">
                            <Tag className="h-3 w-3" />
                            {s.topicName}
                          </Badge>
                        )}
                        {s.estVolume != null && s.estVolume > 0 && (
                          <Badge variant="outline" className="gap-1 text-xs tabular-nums">
                            <TrendingUp className="h-3 w-3" />~{s.estVolume.toLocaleString()}/mo
                          </Badge>
                        )}
                      </div>
                      {s.reason && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{s.reason}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
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
        </CardContent>
      )}
    </Card>
  );
}
