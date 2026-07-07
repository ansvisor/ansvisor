'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { getPromptResultById, type PromptResultWithText } from '@/lib/actions/tracking';
import { Markdown } from '@/components/ui/markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  ExternalLink,
  MessageSquareText,
  Quote,
  Eye,
  Clock,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import { formatSearchQuerySource, visibleSearchQueries } from './query-fanout';

function SentimentBadge({ sentiment }: { sentiment: 'positive' | 'neutral' | 'negative' }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs capitalize',
        sentiment === 'positive' &&
          'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
        sentiment === 'neutral' &&
          'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
        sentiment === 'negative' &&
          'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
      )}
    >
      {sentiment}
    </Badge>
  );
}

export default function ResultDetailPage() {
  const params = useParams();
  const router = useRouter();
  const resultId = params.id as string;

  const [result, setResult] = useState<PromptResultWithText | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const data = await getPromptResultById(resultId);
      if (cancelled) return;
      if (!data) {
        setNotFound(true);
      } else {
        setResult(data);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [resultId]);

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notFound || !result) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <MessageSquareText className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h2 className="text-lg font-semibold">Result not found</h2>
        <p className="text-muted-foreground text-sm mt-1">
          This result may have been deleted or does not exist.
        </p>
        <Button variant="outline" className="mt-6 gap-2" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
          Go back
        </Button>
      </div>
    );
  }

  const searchQueries = visibleSearchQueries(result.searchQueries);

  return (
    <div className="space-y-6 p-2 sm:p-6 max-w-5xl mx-auto">
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 -ml-2 text-muted-foreground hover:text-foreground"
        onClick={() => router.back()}
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>

      {/* Header */}
      <div className="space-y-3">
        <h1 className="text-xl font-semibold leading-snug">{result.promptText}</h1>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {PLATFORM_LABELS[result.platform] ?? result.platform}
          </Badge>
          <SentimentBadge sentiment={result.sentiment} />
          <Badge variant="outline" className="text-xs gap-1">
            <Eye className="h-3 w-3" />
            {result.visibilityScore}/100
          </Badge>
          {result.region && (
            <Badge variant="outline" className="text-xs">
              {result.region}
            </Badge>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <MessageSquareText className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold tabular-nums">{result.mentionCount}</p>
              <p className="text-xs text-muted-foreground">Mentions</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Quote className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold tabular-nums">{result.citationCount}</p>
              <p className="text-xs text-muted-foreground">Brand Citations</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ExternalLink className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold tabular-nums">{result.citations.length}</p>
              <p className="text-xs text-muted-foreground">Total Citations</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Response */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-medium mb-4">AI Response</h2>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <Markdown>{result.response}</Markdown>
          </div>
        </CardContent>
      </Card>

      {/* Citations */}
      {result.citations.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-medium mb-4">Citations ({result.citations.length})</h2>
            <div className="space-y-2">
              {result.citations.map((cite, i) => (
                <a
                  key={i}
                  href={cite.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm hover:bg-muted/50 transition-colors"
                >
                  <ExternalLink className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{cite.title || cite.url}</p>
                    <p className="text-muted-foreground text-xs truncate">{cite.url}</p>
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Query fan-out */}
      {searchQueries.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-medium mb-4">Query fan-out ({searchQueries.length})</h2>
            <div className="space-y-2">
              {searchQueries.map((item, i) => (
                <div key={`${item.query}-${i}`} className="rounded-lg border px-4 py-3 text-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <Search className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <p className="min-w-0 break-words font-medium">{item.query.trim()}</p>
                    </div>
                    <Badge variant="secondary" className="w-fit shrink-0 text-xs">
                      {formatSearchQuerySource(item, result.platform)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timestamp */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground pb-6">
        <Clock className="h-3.5 w-3.5" />
        Checked: {new Date(result.createdAt).toLocaleString()}
      </div>
    </div>
  );
}
