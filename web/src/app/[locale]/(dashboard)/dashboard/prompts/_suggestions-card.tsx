'use client';

import { useEffect, useState, useCallback, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, Plus, X, RefreshCw, Loader2, TrendingUp, Tag, Info } from 'lucide-react';
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

export function SuggestionsCard({ brandId, onAccepted }: Props) {
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const load = useCallback(
    async (autoRefresh = false) => {
      try {
        const { suggestions: s, stale } = await getPromptSuggestions(brandId);
        if (autoRefresh && stale) {
          setRefreshing(true);
          const fresh = await refreshPromptSuggestions(brandId);
          setSuggestions(fresh);
          setRefreshing(false);
        } else {
          setSuggestions(s);
        }
      } catch (err) {
        console.error('Failed to load suggestions:', err);
      } finally {
        setLoading(false);
      }
    },
    [brandId],
  );

  useEffect(() => {
    setLoading(true);
    load(false);
  }, [load]);

  useEffect(() => {
    if (!loading && window.location.hash === '#prompt-opportunities') {
      document.getElementById('prompt-opportunities')?.scrollIntoView();
    }
  }, [loading]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await refreshPromptSuggestions(brandId);
      setSuggestions(fresh);
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
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
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
            {refreshing ? 'Generating…' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
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
    </Card>
  );
}
