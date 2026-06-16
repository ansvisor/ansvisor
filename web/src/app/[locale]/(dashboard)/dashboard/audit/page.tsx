'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Search,
  Loader2,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Minus,
  Trash2,
  Sparkles,
  Copy,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useBrandStore } from '@/stores/use-brand-store';
import {
  runAudit,
  getAudit,
  getAudits,
  deleteAudit,
  type AuditResult,
  type AuditSignal,
  type AuditSummary,
  type AuditRecommendation,
} from '@/lib/actions/audits';
import { cn } from '@/lib/utils';

// Display order + labels for the five rubric categories (keys come from the
// server's categoryScores). Mirrors the rubric category weights.
const CATEGORY_META: { key: string; label: string; weight: number }[] = [
  { key: 'structure', label: 'Structure', weight: 0.25 },
  { key: 'content', label: 'Content', weight: 0.25 },
  { key: 'authority', label: 'Authority', weight: 0.2 },
  { key: 'eeat', label: 'E-E-A-T', weight: 0.2 },
  { key: 'trust', label: 'Trust', weight: 0.1 },
];

function pct(score: number | null): number | null {
  return score === null ? null : Math.round(score * 100);
}

function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 0.7) return 'text-green-600';
  if (score >= 0.4) return 'text-amber-500';
  return 'text-destructive';
}

function barColor(score: number | null): string {
  if (score === null) return 'bg-muted';
  if (score >= 0.7) return 'bg-green-600';
  if (score >= 0.4) return 'bg-amber-500';
  return 'bg-destructive';
}

const STATUS_ICON = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  na: Minus,
} as const;

const STATUS_COLOR = {
  pass: 'text-green-600',
  warn: 'text-amber-500',
  fail: 'text-destructive',
  na: 'text-muted-foreground',
} as const;

function gradeKey(score: number | null): 'good' | 'needsWork' | 'poor' | null {
  if (score === null) return null;
  if (score >= 0.7) return 'good';
  if (score >= 0.4) return 'needsWork';
  return 'poor';
}

function ScoreGauge({ score }: { score: number | null }) {
  const p = pct(score) ?? 0;
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const dash = (p / 100) * circ;
  const stroke =
    score === null
      ? 'stroke-muted-foreground'
      : score >= 0.7
        ? 'stroke-green-600'
        : score >= 0.4
          ? 'stroke-amber-500'
          : 'stroke-destructive';
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="10" className="stroke-muted" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className={cn('transition-all duration-700', stroke)}
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-4xl font-bold tabular-nums', scoreColor(score))}>
          {pct(score) ?? '—'}
        </span>
        <span className="text-[11px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

function DraftBlock({ draft }: { draft: string }) {
  const copy = () => {
    navigator.clipboard.writeText(draft).then(
      () => toast.success('Copied'),
      () => toast.error('Copy failed'),
    );
  };
  return (
    <div className="relative rounded-md border bg-muted/50 p-3">
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1 h-7 w-7"
        onClick={copy}
        aria-label="Copy draft"
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <pre className="whitespace-pre-wrap pr-8 text-xs leading-relaxed text-foreground">
        {draft}
      </pre>
    </div>
  );
}

function SignalRow({
  signal,
  recommendation,
}: {
  signal: AuditSignal;
  recommendation?: AuditRecommendation;
}) {
  const [open, setOpen] = useState(false);
  const Icon = STATUS_ICON[signal.status] ?? Minus;

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 py-3 text-left hover:bg-muted/40"
        aria-expanded={open}
      >
        <Icon className={cn('h-4 w-4 shrink-0', STATUS_COLOR[signal.status])} />
        <span className="flex-1 text-sm font-medium">{signal.label}</span>
        {signal.impactTier && (
          <Badge
            variant={signal.impactTier === 'high' ? 'default' : 'secondary'}
            className="text-[10px]"
          >
            {signal.impactTier}
          </Badge>
        )}
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="space-y-2 pb-4 pl-7 text-sm text-muted-foreground">
          {typeof signal.evidence?.reason === 'string' && signal.evidence.reason && (
            <p>
              <span className="font-medium text-foreground">Finding: </span>
              {signal.evidence.reason as string}
            </p>
          )}
          {signal.what && <p>{signal.what}</p>}
          {signal.why && (
            <p>
              <span className="font-medium text-foreground">Why: </span>
              {signal.why}
            </p>
          )}
          {/* Prefer the page-specific AI recommendation when we have one; fall
              back to the rubric's generic fix otherwise. */}
          {recommendation ? (
            <div className="space-y-2">
              <p>
                <span className="inline-flex items-center gap-1 font-medium text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> Recommended fix:
                </span>{' '}
                {recommendation.recommendation}
              </p>
              {recommendation.draft && <DraftBlock draft={recommendation.draft} />}
            </div>
          ) : (
            signal.status !== 'pass' &&
            signal.howToFix && (
              <p>
                <span className="font-medium text-foreground">Fix: </span>
                {signal.howToFix}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function RecommendationItem({ rec }: { rec: AuditRecommendation }) {
  return (
    <div className="space-y-2 border-b py-4 last:border-b-0">
      <div className="flex items-center gap-2">
        <Badge variant={rec.priority === 'high' ? 'default' : 'secondary'} className="text-[10px]">
          {rec.priority}
        </Badge>
        <span className="text-sm font-medium">{rec.label}</span>
      </div>
      <p className="text-sm text-muted-foreground">{rec.recommendation}</p>
      {rec.draft && <DraftBlock draft={rec.draft} />}
    </div>
  );
}

function AuditReport({ audit }: { audit: AuditResult }) {
  const t = useTranslations('audit');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const recBySignal = new Map(audit.recommendations.map((r) => [r.signalKey, r]));

  const counts = audit.signals.reduce(
    (acc, s) => {
      if (s.status === 'pass') acc.pass += 1;
      else if (s.status === 'warn') acc.warn += 1;
      else if (s.status === 'fail') acc.fail += 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
  const hasIssues = counts.fail + counts.warn > 0;
  const grade = gradeKey(audit.totalScore);

  const visibleSignals = (cat: string) =>
    audit.signals.filter(
      (s) => s.category === cat && (!onlyIssues || s.status === 'fail' || s.status === 'warn'),
    );

  return (
    <div className="space-y-6">
      {/* Headline: gauge + grade + pass/warn/fail summary */}
      <Card>
        <CardContent className="flex flex-col items-center gap-6 py-6 sm:flex-row sm:items-center">
          <ScoreGauge score={audit.totalScore} />
          <div className="flex-1 space-y-2 text-center sm:text-left">
            <div className="text-sm font-medium break-all">{audit.finalUrl || audit.url}</div>
            {grade && (
              <div className={cn('text-lg font-semibold', scoreColor(audit.totalScore))}>
                {t(`grade.${grade}`)}
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              <span className="inline-flex items-center gap-1 rounded-full bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> {counts.pass} {t('summary.passed')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" /> {counts.warn} {t('summary.warnings')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                <XCircle className="h-3.5 w-3.5" /> {counts.fail} {t('summary.failed')}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {audit.signalsEvaluated}/{audit.signalsTotal} signals evaluated
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI fix recommendations */}
      {audit.recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {[...audit.recommendations]
              .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
              .map((rec, i) => (
                <RecommendationItem key={`${rec.signalKey}-${i}`} rec={rec} />
              ))}
          </CardContent>
        </Card>
      )}

      {/* Category breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Category breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {CATEGORY_META.map((cat) => {
            const cs = audit.categoryScores[cat.key];
            const score = cs?.score ?? null;
            const p = pct(score);
            return (
              <div key={cat.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{cat.label}</span>
                  <span className="text-muted-foreground">
                    {p === null ? 'n/a' : `${p}/100`}
                    {cs ? ` · ${cs.evaluated}/${cs.total}` : ''}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full transition-all', barColor(score))}
                    style={{ width: `${p ?? 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Signals header + issues-only filter */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Signals</h2>
        <Button variant="outline" size="sm" onClick={() => setOnlyIssues((v) => !v)}>
          {onlyIssues ? t('allSignals') : t('onlyIssues')}
        </Button>
      </div>

      {onlyIssues && !hasIssues ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('noIssues')}
          </CardContent>
        </Card>
      ) : (
        CATEGORY_META.map((cat) => {
          const sigs = visibleSignals(cat.key);
          if (sigs.length === 0) return null;
          return (
            <Card key={cat.key}>
              <CardHeader>
                <CardTitle className="text-base">{cat.label}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {sigs.map((s) => (
                  <SignalRow key={s.key} signal={s} recommendation={recBySignal.get(s.key)} />
                ))}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

export default function SiteAuditPage() {
  const t = useTranslations('audit');
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId) ?? null);

  const [url, setUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(0);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [history, setHistory] = useState<AuditSummary[]>([]);

  // Advance the running-state stage label so the ~30s wait reads as progress.
  useEffect(() => {
    if (!running) {
      setStage(0);
      return;
    }
    const id = setInterval(() => setStage((s) => Math.min(s + 1, 2)), 8000);
    return () => clearInterval(id);
  }, [running]);

  // Prefill the URL with the brand's primary domain.
  useEffect(() => {
    if (!activeBrand) return;
    const primary = activeBrand.domains?.find((d) => d.isPrimary) ?? activeBrand.domains?.[0];
    if (primary?.domain) setUrl(`https://${primary.domain.replace(/^https?:\/\//, '')}`);
  }, [activeBrand]);

  const loadHistory = useCallback(async () => {
    if (!activeBrandId) return;
    try {
      setHistory(await getAudits(activeBrandId));
    } catch (err) {
      console.error('Failed to load audit history:', err);
    }
  }, [activeBrandId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

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
    setAudit(null);
    try {
      // The audit runs in the background; poll until it flips to completed/failed.
      const started = await runAudit(activeBrandId, url.trim());
      let result = started;
      const deadline = Date.now() + 120_000; // give up after 2 minutes
      while (result.status === 'running' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        result = await getAudit(started.id);
      }
      setAudit(result);
      if (result.status === 'failed') {
        toast.error(result.error || t('failed'));
      }
      loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('failed'));
    } finally {
      setRunning(false);
    }
  };

  const handleOpen = async (id: string) => {
    setRunning(true);
    try {
      setAudit(await getAudit(id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('failed'));
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async (id: string) => {
    // Optimistic removal; restore on failure.
    const prev = history;
    setHistory((h) => h.filter((a) => a.id !== id));
    if (audit?.id === id) setAudit(null);
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
            onKeyDown={(e) => e.key === 'Enter' && !running && handleRun()}
            disabled={running}
            className="flex-1"
          />
          <Button onClick={handleRun} disabled={running} className="shrink-0">
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

      {running && !audit && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="text-sm font-medium">
              {[t('stages.fetch'), t('stages.analyze'), t('stages.recommend')][stage]}
            </div>
            <div className="text-xs text-muted-foreground">~30s</div>
          </CardContent>
        </Card>
      )}

      {!running && !audit && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Sparkles className="h-7 w-7 text-primary" />
            <div className="text-base font-semibold">{t('emptyTitle')}</div>
            <p className="max-w-md text-sm text-muted-foreground">{t('emptyBody')}</p>
          </CardContent>
        </Card>
      )}

      {audit && <AuditReport audit={audit} />}

      {/* Recent audits */}
      {history.length > 0 && (
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
                <button
                  type="button"
                  onClick={() => handleOpen(h.id)}
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
                </button>
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
