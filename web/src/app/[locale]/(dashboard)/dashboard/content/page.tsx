'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Lightbulb,
  Zap,
  Send,
  Check,
  BarChart3,
  Search,
  Loader2,
  RefreshCw,
  ExternalLink,
  X,
  Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';
import { usePlanContext } from '@/components/providers/plan-provider';
import {
  generateOpportunities,
  getGenerationJobStatus,
  getOpportunities,
  updateOpportunityStatus,
  sendToWebhook,
  bulkSendToWebhook,
  bulkUpdateStatus,
} from '@/lib/actions/content';
import type { ContentOpportunity, ContentOpportunityStatus } from '@/types';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { WebhookSettingsDialog } from './_webhook-settings';

const GENERATION_STORAGE_KEY = 'aeo:content-generation';
const GENERATION_TIMEOUT_MS = 3 * 60 * 1000;

interface GenerationJob {
  brandId: string;
  jobId: string;
  startedAt: number;
}

function saveGenerationJob(job: GenerationJob) {
  try {
    localStorage.setItem(GENERATION_STORAGE_KEY, JSON.stringify(job));
  } catch {}
}

function loadGenerationJob(): GenerationJob | null {
  try {
    const raw = localStorage.getItem(GENERATION_STORAGE_KEY);
    if (!raw) return null;
    const job = JSON.parse(raw) as GenerationJob;
    if (Date.now() - job.startedAt > GENERATION_TIMEOUT_MS) {
      localStorage.removeItem(GENERATION_STORAGE_KEY);
      return null;
    }
    return job;
  } catch {
    return null;
  }
}

function clearGenerationJob() {
  try {
    localStorage.removeItem(GENERATION_STORAGE_KEY);
  } catch {}
}

const IMPACT_COLORS: Record<string, string> = {
  high: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  low: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  sent: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  in_progress: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  done: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  dismissed: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
};

function KpiCard({
  title,
  icon: Icon,
  value,
  sub,
}: {
  title: string;
  icon: React.ElementType;
  value: React.ReactNode;
  sub: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p className="text-xs mt-1 text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

export default function ContentPage() {
  const t = useTranslations('content');
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const { isCloud } = usePlanContext();

  const [opportunities, setOpportunities] = useState<ContentOpportunity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [impactFilter, setImpactFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);

  const [webhookOpen, setWebhookOpen] = useState(false);
  const pollRef = useRef(false);

  const loadData = useCallback(
    async (silent = false) => {
      if (!activeBrandId) {
        setOpportunities([]);
        setTotal(0);
        setLoading(false);
        return;
      }

      if (!silent) setLoading(true);
      setSelectedIds(new Set());
      try {
        const filters: Record<string, string> = {};
        if (statusFilter !== 'all') filters.status = statusFilter;
        if (impactFilter !== 'all') filters.impact = impactFilter;
        if (typeFilter !== 'all') filters.type = typeFilter;

        const data = await getOpportunities(activeBrandId, {
          ...filters,
          limit: 100,
          sort: 'score',
        });
        setOpportunities(data.opportunities);
        setTotal(data.total);
        return data.total;
      } catch (err) {
        console.error('Failed to load opportunities:', err);
        toast.error('Failed to load content opportunities');
        return 0;
      } finally {
        setLoading(false);
      }
    },
    [activeBrandId, statusFilter, impactFilter, typeFilter],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pollJob = useCallback(
    (jobId: string, startedAt: number) => {
      pollRef.current = true;
      setGenerating(true);

      const poll = async () => {
        while (pollRef.current) {
          await new Promise((r) => setTimeout(r, 3000));
          if (!pollRef.current) break;
          try {
            const status = await getGenerationJobStatus(jobId);

            if (status.status === 'completed') {
              pollRef.current = false;
              clearGenerationJob();
              setGenerating(false);
              toast.success(`Generated ${status.result?.generated ?? 0} opportunities`);
              loadData();
              break;
            }

            if (status.status === 'failed') {
              pollRef.current = false;
              clearGenerationJob();
              setGenerating(false);
              toast.error(status.failedReason || 'Generation failed — please try again');
              break;
            }

            if (Date.now() - startedAt > GENERATION_TIMEOUT_MS) {
              pollRef.current = false;
              clearGenerationJob();
              setGenerating(false);
              toast.error('Generation timed out — please try again');
              break;
            }
          } catch {
            // keep polling
          }
        }
      };

      poll();
    },
    [loadData],
  );

  // Restore generation state from localStorage on mount
  useEffect(() => {
    if (!activeBrandId) return;
    const saved = loadGenerationJob();
    if (!saved || saved.brandId !== activeBrandId) return;

    pollJob(saved.jobId, saved.startedAt);
    return () => {
      pollRef.current = false;
    };
  }, [activeBrandId, pollJob]);

  const handleGenerate = async () => {
    if (!activeBrandId) return;
    try {
      const { jobId } = await generateOpportunities(activeBrandId);
      const startedAt = Date.now();
      saveGenerationJob({ brandId: activeBrandId, jobId, startedAt });
      pollJob(jobId, startedAt);
    } catch (err) {
      console.error('Generate failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to generate opportunities');
      setGenerating(false);
    }
  };

  const handleSendWebhook = async (id: string) => {
    setSendingId(id);
    try {
      await sendToWebhook(id);
      toast.success('Sent to workflow!');
      await loadData(true);
    } catch (err) {
      console.error('Webhook send failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSendingId(null);
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await updateOpportunityStatus(id, 'dismissed');
      toast.success('Opportunity dismissed');
      await loadData(true);
    } catch (err) {
      console.error('Dismiss failed:', err);
      toast.error('Failed to dismiss');
    }
  };

  const handleBulkSend = async () => {
    setBulkSending(true);
    try {
      const result = await bulkSendToWebhook(Array.from(selectedIds));
      toast.success(`Sent ${result.sent} opportunities to workflow`);
      if (result.failed > 0) toast.error(`${result.failed} failed to send`);
      setSelectedIds(new Set());
      await loadData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk send failed');
    } finally {
      setBulkSending(false);
    }
  };

  const handleBulkDone = async () => {
    setBulkSending(true);

    try {
      const ids = Array.from(selectedIds);

      const result = await bulkUpdateStatus(ids, 'done');

      toast.success(`Marked ${result.updated} opportunities as done`);

      setSelectedIds(new Set());

      await loadData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk update failed');
    } finally {
      setBulkSending(false);
    }
  };

  const handleBulkDismiss = async () => {
    setBulkSending(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await bulkUpdateStatus(ids, 'dismissed');
      toast.success(`Dismissed ${result.updated} opportunities`);
      setSelectedIds(new Set());
      await loadData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk dismiss failed');
    } finally {
      setBulkSending(false);
    }
  };

  const filtered = opportunities.filter(
    (o) =>
      o.title.toLowerCase().includes(search.toLowerCase()) ||
      (o.description || '').toLowerCase().includes(search.toLowerCase()),
  );

  const highImpact = opportunities.filter((o) => o.impact === 'high').length;
  const sentCount = opportunities.filter(
    (o) => o.status === 'sent' || o.status === 'in_progress' || o.status === 'done',
  ).length;
  const avgScore =
    opportunities.length > 0
      ? Math.round(opportunities.reduce((s, o) => s + o.opportunityScore, 0) / opportunities.length)
      : 0;

  if (!activeBrandId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Select a brand to view content opportunities.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setWebhookOpen(true)}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Settings2 className="h-4 w-4" />
            {t('webhook.title')}
          </Button>
          {!isCloud && (
            <Button
              onClick={handleGenerate}
              disabled={generating || loading}
              size="sm"
              className="gap-2"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : opportunities.length > 0 ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Lightbulb className="h-4 w-4" />
              )}
              {generating
                ? t('generating')
                : opportunities.length > 0
                  ? t('regenerate')
                  : t('generate')}
            </Button>
          )}
        </div>
      </div>

      {loading && opportunities.length === 0 ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : opportunities.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Lightbulb className="h-12 w-12 text-muted-foreground/40" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">{t('noOpportunities')}</p>
              <p className="text-xs text-muted-foreground">{t('noOpportunitiesHint')}</p>
            </div>
            <Button onClick={handleGenerate} disabled={generating} size="sm" className="gap-2">
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Lightbulb className="h-4 w-4" />
              )}
              {generating ? t('generating') : t('generate')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard
              title={t('kpi.total')}
              icon={Lightbulb}
              value={total}
              sub={`${filtered.length} shown`}
            />
            <KpiCard
              title={t('kpi.highImpact')}
              icon={Zap}
              value={highImpact}
              sub="opportunities"
            />
            <KpiCard title={t('kpi.avgScore')} icon={BarChart3} value={avgScore} sub="out of 100" />
            <KpiCard
              title={t('kpi.sentToWorkflow')}
              icon={Send}
              value={sentCount}
              sub="sent or in progress"
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-medium">{t('opportunities')}</CardTitle>
                  <Badge
                    variant="outline"
                    className="text-xs border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  >
                    {total} Available
                  </Badge>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative w-48">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-8 h-8 text-xs"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
                    <SelectTrigger className="h-8 w-[130px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('filters.allStatuses')}</SelectItem>
                      <SelectItem value="new">{t('status.new')}</SelectItem>
                      <SelectItem value="sent">{t('status.sent')}</SelectItem>
                      <SelectItem value="in_progress">{t('status.in_progress')}</SelectItem>
                      <SelectItem value="done">{t('status.done')}</SelectItem>
                      <SelectItem value="dismissed">{t('status.dismissed')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={impactFilter} onValueChange={(v) => v && setImpactFilter(v)}>
                    <SelectTrigger className="h-8 w-[120px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('filters.allImpacts')}</SelectItem>
                      <SelectItem value="high">{t('impact.high')}</SelectItem>
                      <SelectItem value="medium">{t('impact.medium')}</SelectItem>
                      <SelectItem value="low">{t('impact.low')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
                    <SelectTrigger className="h-8 w-[110px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('filters.allTypes')}</SelectItem>
                      <SelectItem value="owned">{t('type.owned')}</SelectItem>
                      <SelectItem value="earned">{t('type.earned')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
                <span className="text-xs text-muted-foreground">
                  {t('bulk.selected', { count: selectedIds.size })}
                </span>
                <div className="flex items-center gap-1 ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={handleBulkSend}
                    disabled={bulkSending}
                  >
                    {bulkSending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                    {t('bulk.sendAll')}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={handleBulkDone}
                    disabled={bulkSending}
                  >
                    <Check className="h-3 w-3" />
                    Done
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5 text-muted-foreground"
                    onClick={handleBulkDismiss}
                    disabled={bulkSending}
                  >
                    <X className="h-3 w-3" />
                    {t('bulk.dismissAll')}
                  </Button>
                </div>
              </div>
            )}
            <CardContent className="p-0">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4">
                      <Checkbox
                        checked={filtered.length > 0 && selectedIds.size === filtered.length}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedIds(new Set(filtered.map((o) => o.id)));
                          } else {
                            setSelectedIds(new Set());
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead className="pl-6 w-[40%]">{t('table.action')}</TableHead>
                    <TableHead className="text-center">{t('table.type')}</TableHead>
                    <TableHead className="text-center">{t('table.impact')}</TableHead>
                    <TableHead className="text-center">{t('table.score')}</TableHead>
                    <TableHead className="text-center">{t('table.status')}</TableHead>
                    <TableHead className="text-right pr-6">{t('table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((opp) => (
                    <TableRow key={opp.id} className="hover:bg-muted/50">
                      <TableCell className="w-10 pl-4">
                        <Checkbox
                          checked={selectedIds.has(opp.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedIds);
                            if (checked) next.add(opp.id);
                            else next.delete(opp.id);
                            setSelectedIds(next);
                          }}
                        />
                      </TableCell>
                      <TableCell className="pl-6 max-w-0">
                        <Link
                          href={`/dashboard/content/${opp.id}`}
                          className="block hover:underline"
                        >
                          <p className="text-sm font-medium line-clamp-1">{opp.title}</p>
                          {opp.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {opp.description}
                            </p>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs">
                          {t(`type.${opp.type}` as 'type.owned' | 'type.earned')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn('text-xs', IMPACT_COLORS[opp.impact])}
                        >
                          {t(
                            `impact.${opp.impact}` as
                              | 'impact.high'
                              | 'impact.medium'
                              | 'impact.low',
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="tabular-nums font-semibold text-sm">
                          {Math.round(opp.opportunityScore)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn('text-xs whitespace-nowrap', STATUS_COLORS[opp.status])}
                        >
                          {t(`status.${opp.status}` as `status.${ContentOpportunityStatus}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex items-center justify-end gap-1">
                          {opp.status === 'new' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => handleSendWebhook(opp.id)}
                                disabled={sendingId === opp.id}
                              >
                                {sendingId === opp.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Send className="h-3 w-3" />
                                )}
                                Send
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground"
                                onClick={() => handleDismiss(opp.id)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                          <Link href={`/dashboard/content/${opp.id}`}>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length === 0 && (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No opportunities match your filters.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <WebhookSettingsDialog
        open={webhookOpen}
        onOpenChange={setWebhookOpen}
        brandId={activeBrandId}
      />
    </div>
  );
}
