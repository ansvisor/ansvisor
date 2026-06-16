'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Search, Loader2, Trash2, Sparkles } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBrandStore } from '@/stores/use-brand-store';
import {
  runAudit,
  getAudits,
  getAuditQuota,
  deleteAudit,
  type AuditSummary,
  type AuditQuota,
} from '@/lib/actions/audits';
import { pct, scoreColor } from '@/components/audit/audit-report';
import { cn } from '@/lib/utils';

export default function SiteAuditPage() {
  const t = useTranslations('audit');
  const router = useRouter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);

  // Prefill the URL with the active brand's primary domain (read once at init).
  const [url, setUrl] = useState(() => {
    const { brands, activeBrandId: id } = useBrandStore.getState();
    const brand = brands.find((b) => b.id === id);
    const primary = brand?.domains?.find((d) => d.isPrimary) ?? brand?.domains?.[0];
    return primary?.domain ? `https://${primary.domain.replace(/^https?:\/\//, '')}` : '';
  });
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<AuditSummary[]>([]);
  const [quota, setQuota] = useState<AuditQuota | null>(null);

  // Load recent audits + the monthly quota for the active brand.
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    (async () => {
      try {
        const [data, q] = await Promise.all([getAudits(activeBrandId), getAuditQuota()]);
        if (!cancelled) {
          setHistory(data);
          setQuota(q);
        }
      } catch (err) {
        console.error('Failed to load audit history:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  const quotaExhausted = quota !== null && quota.limit !== -1 && quota.remaining <= 0;

  const handleRun = async () => {
    if (!activeBrandId) {
      toast.error(t('noBrand'));
      return;
    }
    if (!url.trim()) {
      toast.error(t('urlRequired'));
      return;
    }
    setRunning(true);
    try {
      // POST returns immediately with a running row; navigate to its detail
      // page, which polls until the audit completes.
      const started = await runAudit(activeBrandId, url.trim());
      router.push(`/dashboard/audit/${started.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('failed'));
      setRunning(false);
    }
  };

  const handleDelete = async (id: string) => {
    const prev = history;
    setHistory((h) => h.filter((a) => a.id !== id));
    try {
      await deleteAudit(id);
    } catch (err) {
      setHistory(prev);
      toast.error(err instanceof Error ? err.message : t('failed'));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {/* Run bar */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <Input
            type="url"
            inputMode="url"
            placeholder="https://example.com/page"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !running && !quotaExhausted && handleRun()}
            disabled={running}
            className="flex-1"
          />
          {quota && quota.limit !== -1 && (
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                quotaExhausted ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {quota.remaining}/{quota.limit} {t('auditsLeft')}
            </span>
          )}
          <Button onClick={handleRun} disabled={running || quotaExhausted} className="shrink-0">
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('running')}
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                {t('runAudit')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {history.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Sparkles className="h-7 w-7 text-primary" />
            <div className="text-base font-semibold">{t('emptyTitle')}</div>
            <p className="max-w-md text-sm text-muted-foreground">{t('emptyBody')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('recent')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-3 border-b py-1 last:border-b-0 hover:bg-muted/40"
              >
                <Link
                  href={`/dashboard/audit/${h.id}`}
                  className="flex flex-1 items-center gap-3 py-2 text-left"
                >
                  <span className="flex-1 truncate text-sm">{h.url}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(h.created_at).toLocaleDateString()}
                  </span>
                  <span
                    className={cn(
                      'w-12 text-right text-sm font-semibold tabular-nums',
                      scoreColor(h.total_score),
                    )}
                  >
                    {h.status === 'completed' ? (pct(h.total_score) ?? '—') : h.status}
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(h.id)}
                  aria-label={t('deleteAudit')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
