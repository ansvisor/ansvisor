'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, ArrowLeft, Trash2, RefreshCw, AlertCircle } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { getAudit, runAudit, deleteAudit, type AuditResult } from '@/lib/actions/audits';
import { AuditReport } from '@/components/audit/audit-report';

export default function AuditDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const t = useTranslations('audit');
  const router = useRouter();
  const tFailed = t('failed');

  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const genRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAndPoll = useCallback(async () => {
    const gen = ++genRef.current;
    const cancelled = () => genRef.current !== gen;
    setError(null);
    setLoading(true);

    try {
      setTimedOut(false);

      let result = await getAudit(id);

      if (cancelled()) return;

      setAudit(result);
      setLoading(false);

      const deadline = Date.now() + 120_000;

      while (!cancelled() && result.status === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => {
          timerRef.current = setTimeout(resolve, 3000);
        });

        if (cancelled()) return;

        result = await getAudit(id);

        if (cancelled()) return;

        setAudit(result);
      }

      if (!cancelled() && result.status === 'running' && Date.now() >= deadline) {
        setTimedOut(true);
      }

      if (!cancelled() && result.status === 'failed') {
        toast.error(result.error || tFailed);
      }
    } catch (err) {
      if (cancelled()) return;

      const message = err instanceof Error ? err.message : tFailed;

      setError(message);
      setLoading(false);
      toast.error(message);
    }
  }, [id, tFailed]);

  useEffect(() => {
    const startPolling = async () => {
      await loadAndPoll();
    };

    startPolling();

    return () => {
      genRef.current++;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [loadAndPoll]);

  // Advance the running-state stage label so the ~30s wait reads as progress.
  const isRunning = !audit || audit.status === 'running';
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setStage((s) => Math.min(s + 1, 2)), 8000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const handleDelete = async () => {
    try {
      await deleteAudit(id);
      router.push('/dashboard/audit');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tFailed);
    }
  };

  // Re-run the audit on the same URL → navigate to the new audit's detail page.
  const handleRefresh = async () => {
    if (!audit) return;
    setRerunning(true);

    try {
      const started = await runAudit(audit.brandId, audit.url);
      router.push(`/dashboard/audit/${started.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tFailed);
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/audit"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t('title')}
        </Link>
        {audit && (audit.status !== 'running' || timedOut) && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              disabled={rerunning}
              onClick={handleRefresh}
              aria-label={t('reaudit')}
            >
              {rerunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
            <Dialog>
              <DialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={t('deleteAudit')}
                  />
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>{t('deleteAudit')}</DialogTitle>
                  <DialogDescription>{t('deleteConfirm')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
                  <DialogClose render={<Button variant="destructive" onClick={handleDelete} />}>
                    {t('deleteAudit')}
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="text-sm font-medium">{t('stages.fetch')}</div>
            <div className="text-xs text-muted-foreground">~30s</div>
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div className="text-base font-semibold">{t('loadFailed')}</div>
            <p className="max-w-md text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void loadAndPoll()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('retry')}
            </Button>
          </CardContent>
        </Card>
      ) : audit && audit.status === 'running' && timedOut ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="text-sm font-medium">{t('takingLongerThanExpected')}</div>
            <Button onClick={() => void loadAndPoll()}>{t('checkAgain')}</Button>
          </CardContent>
        </Card>
      ) : audit && audit.status === 'running' ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="text-sm font-medium">
              {[t('stages.fetch'), t('stages.analyze'), t('stages.recommend')][stage]}
            </div>
            <div className="text-xs text-muted-foreground">~30s</div>
          </CardContent>
        </Card>
      ) : audit && audit.status === 'failed' ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-destructive">
            {audit.error || tFailed}
          </CardContent>
        </Card>
      ) : audit ? (
        <AuditReport audit={audit} />
      ) : null}
    </div>
  );
}
