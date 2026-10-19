'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Layers, Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getPromptVolumes } from '@/lib/actions/volumes';
import { aggregatePromptVolumeClusters } from '@/lib/prompt-volume-clusters';
import { useBrandStore } from '@/stores/use-brand-store';
import type { PromptVolume } from '@/types';
import { formatCompactNumber } from '@/lib/format';

export default function SimilarTopicsPage() {
  const { getActiveBrand } = useBrandStore();
  const brand = getActiveBrand();
  const [volumes, setVolumes] = useState<PromptVolume[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!brand?.id) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const { volumes: nextVolumes } = await getPromptVolumes(brand.id);
        if (!cancelled) setVolumes(nextVolumes);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [brand?.id]);

  const clusters = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const all = aggregatePromptVolumeClusters(volumes);

    if (!normalizedSearch) return all;

    return all.filter((cluster) => {
      if (cluster.keyword.toLowerCase().includes(normalizedSearch)) return true;
      return cluster.prompts.some((prompt) => prompt.text.toLowerCase().includes(normalizedSearch));
    });
  }, [search, volumes]);

  const totals = useMemo(
    () => ({
      clusters: aggregatePromptVolumeClusters(volumes).length,
      googleVolume: volumes.reduce((sum, volume) => sum + volume.totalGoogleVolume, 0),
      aiVolume: volumes.reduce((sum, volume) => sum + volume.estAiVolume, 0),
    }),
    [volumes],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-2 sm:p-6">
      <div className="space-y-2">
        <Link
          href="/dashboard/prompts?tab=insights"
          className={buttonVariants({
            variant: 'ghost',
            size: 'sm',
            className: 'gap-2 px-0',
          })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Prompt Insights
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Similar Topics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Keyword clusters aggregated across analyzed prompts.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Topic Clusters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {totals.clusters.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">unique keywords</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Google Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatCompactNumber(totals.googleVolume)}
            </div>
            <p className="text-xs text-muted-foreground">monthly searches</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Est. AI Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatCompactNumber(totals.aiVolume)}
            </div>
            <p className="text-xs text-muted-foreground">monthly AI queries</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">All Similar Topics</CardTitle>
              <Badge variant="secondary">{clusters.length}</Badge>
            </div>
            <div className="relative w-full sm:w-60">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search topics..."
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Topic</TableHead>
                <TableHead className="text-right">Google Vol.</TableHead>
                <TableHead className="text-right">Est. AI Vol.</TableHead>
                <TableHead className="text-center">Prompts</TableHead>
                <TableHead>Top Prompt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                    Loading similar topics...
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                clusters.map((cluster) => {
                  const topPrompt = [...cluster.prompts].sort((a, b) => b.volume - a.volume)[0];

                  return (
                    <TableRow key={cluster.keyword.toLowerCase()}>
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-2">
                          <Layers className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{cluster.keyword}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCompactNumber(cluster.volume)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCompactNumber(cluster.estimatedAiVolume)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{cluster.occurrences}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[360px]">
                        {topPrompt ? (
                          <Link
                            href={`/dashboard/prompts/${topPrompt.id}`}
                            className="line-clamp-2 text-sm text-muted-foreground transition-colors hover:text-primary hover:underline"
                          >
                            {topPrompt.text}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              {!loading && clusters.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                    No similar topics found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
