'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, ArrowLeft, Trash2 } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getAudit, deleteAudit, type AuditResult } from '@/lib/actions/audits';
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

  // Load the audit and poll while it's still running.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function loadAndPoll() {
      try {
        let result = await getAudit(id);
        if (cancelled) return;
        setAudit(result);
        setLoading(false);

        const deadline = Date.now() + 120_000;
        while (!cancelled && result.status === 'running' && Date.now() < deadline) {
          await new Promise((r) => {
            timer = setTimeout(r, 3000);
          });
          if (cancelled) return;
          result = await getAudit(id);
          if (cancelled) return;
          setAudit(result);
        }
        if (!cancelled && result.status === 'failed') {
          toast.error(result.error || tFailed);
        }
      } catch (err) {
        if (cancelled) return;
        setLoading(false);
        toast.error(err instanceof Error ? err.message : tFailed);
      }
    }

    loadAndPoll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, tFailed]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/audit"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t('title')}
        </Link>
        {audit && audit.status !== 'running' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            aria-label={t('deleteAudit')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {loading || (audit && audit.status === 'running') ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="text-sm font-medium">
              {loading
                ? t('stages.fetch')
                : [t('stages.fetch'), t('stages.analyze'), t('stages.recommend')][stage]}
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
