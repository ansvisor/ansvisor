'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BarChart3, FileText, Info, Loader2, Megaphone, PencilRuler } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { getKpiDefinitions, saveKpiFramework } from '@/lib/actions/kpis';
import {
  KPI_KEYS,
  KPI_REGISTRY,
  KPI_TEMPLATES,
  isValidKpiTarget,
  type KpiKey,
  type KpiTemplateKey,
  type KpiTimeframe,
} from '@/lib/kpis/registry';
import { cn } from '@/lib/utils';

const TEMPLATE_ICONS: Record<KpiTemplateKey, React.ComponentType<{ className?: string }>> = {
  ai_search_visibility: BarChart3,
  content_performance: FileText,
  brand_monitoring: Megaphone,
  custom: PencilRuler,
};

const TEMPLATE_ORDER: KpiTemplateKey[] = [
  'ai_search_visibility',
  'content_performance',
  'brand_monitoring',
  'custom',
];

const TIMEFRAMES: KpiTimeframe[] = ['weekly', 'monthly', 'quarterly'];

const UNIT_SUFFIX: Record<string, string> = {
  percent: '%',
  count: '#',
  sessions: '#',
};

interface DraftEntry {
  enabled: boolean;
  /** Kept as the raw input string so a half-typed number isn't clobbered. */
  target: string;
}

type Draft = Record<KpiKey, DraftEntry>;

function templateDraft(template: KpiTemplateKey, previous?: Draft): Draft {
  const inTemplate = new Set(KPI_TEMPLATES[template]);
  return Object.fromEntries(
    KPI_KEYS.map((key) => [
      key,
      {
        enabled: template === 'custom' ? (previous?.[key]?.enabled ?? false) : inTemplate.has(key),
        // A target someone already typed survives switching templates —
        // presets decide what is checked, not what was written.
        target: previous?.[key]?.target ?? String(KPI_REGISTRY[key].defaultTarget),
      },
    ]),
  ) as Draft;
}

/**
 * Configure KPI Framework: pick a template, set targets and a time period,
 * Save & Apply. Two steps, not the mockup's three — frameworks are
 * brand-scoped and the brand is already selected in the app shell, so there
 * is nothing to assign.
 *
 * State resets on every open by refetching the brand's definitions, so a
 * cancelled edit leaves nothing behind.
 */
export function KpiFrameworkDrawer({
  brandId,
  open,
  onOpenChange,
  onSaved,
}: {
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations('actionCenter.drawer');
  const tRegistry = useTranslations('actionCenter.registry');

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [template, setTemplate] = useState<KpiTemplateKey>('ai_search_visibility');
  const [timeframe, setTimeframe] = useState<KpiTimeframe>('monthly');
  const [draft, setDraft] = useState<Draft>(() => templateDraft('ai_search_visibility'));
  const [showAll, setShowAll] = useState(false);

  const prefill = useCallback(async () => {
    setIsLoading(true);
    try {
      const definitions = await getKpiDefinitions(brandId);
      if (definitions.length === 0) {
        setTemplate('ai_search_visibility');
        setTimeframe('monthly');
        setDraft(templateDraft('ai_search_visibility'));
        setShowAll(false);
        return;
      }
      // An existing framework opens as what it is — the user's own set —
      // rather than snapping back to a template's checkboxes.
      const byKey = new Map(definitions.map((d) => [d.kpiKey, d]));
      setTemplate('custom');
      setTimeframe(definitions.find((d) => d.isActive)?.timeframe ?? 'monthly');
      setDraft(
        Object.fromEntries(
          KPI_KEYS.map((key) => {
            const existing = byKey.get(key);
            return [
              key,
              {
                enabled: existing?.isActive ?? false,
                target: String(existing?.target ?? KPI_REGISTRY[key].defaultTarget),
              },
            ];
          }),
        ) as Draft,
      );
      setShowAll(false);
    } catch {
      toast.error(t('loadFailed'));
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  }, [brandId, onOpenChange, t]);

  useEffect(() => {
    if (open) void prefill();
  }, [open, prefill]);

  const entries = useMemo(
    () =>
      KPI_KEYS.filter((key) => draft[key]?.enabled).map((key) => ({
        key,
        target: Number(draft[key].target),
      })),
    [draft],
  );
  const invalidKeys = useMemo(
    () => new Set(entries.filter((e) => !isValidKpiTarget(e.key, e.target)).map((e) => e.key)),
    [entries],
  );
  const canSave = !isLoading && !isSaving && entries.length > 0 && invalidKeys.size === 0;

  // The template's KPIs always show; the rest sit behind "Show all KPIs".
  // Anything already enabled shows regardless — a hidden checked row would
  // be saved without being visible.
  const templateKeys = new Set(KPI_TEMPLATES[template]);
  const visibleKeys = KPI_KEYS.filter(
    (key) => showAll || templateKeys.has(key) || draft[key]?.enabled || template === 'custom',
  );
  const hiddenCount = KPI_KEYS.length - visibleKeys.length;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveKpiFramework(brandId, timeframe, entries);
      onOpenChange(false);
      onSaved();
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
            <section>
              <h3 className="text-sm font-semibold">{t('steps.template.title')}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('steps.template.description')}
              </p>
              <div className="mt-3 space-y-2">
                {TEMPLATE_ORDER.map((key) => {
                  const Icon = TEMPLATE_ICONS[key];
                  const isAvailable = key === 'custom' || KPI_TEMPLATES[key].length > 0;
                  const isSelected = template === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!isAvailable}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setTemplate(key);
                        setDraft((prev) => templateDraft(key, prev));
                      }}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                        isSelected
                          ? 'border-foreground/40 bg-muted/60'
                          : 'hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50',
                      )}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t(`templates.${key}.name`)}</p>
                        <p className="text-xs text-muted-foreground">
                          {isAvailable
                            ? t(`templates.${key}.description`)
                            : t('templates.notAvailable')}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold">{t('steps.goals.title')}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('steps.goals.description')}</p>

              <div className="mt-3">
                <Label htmlFor="kpi-timeframe" className="text-xs text-muted-foreground">
                  {t('timePeriod')}
                </Label>
                <Select
                  value={timeframe}
                  onValueChange={(v) => setTimeframe(v as KpiTimeframe)}
                >
                  <SelectTrigger id="kpi-timeframe" className="mt-1 h-9 w-full text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEFRAMES.map((tf) => (
                      <SelectItem key={tf} value={tf}>
                        {t(`timeframes.${tf}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <p className="mt-4 text-xs font-medium text-muted-foreground">{t('targets')}</p>
              <div className="mt-2 space-y-2">
                {visibleKeys.map((key) => {
                  const entry = draft[key];
                  const isInvalid = entry.enabled && invalidKeys.has(key);
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <Checkbox
                        id={`kpi-enable-${key}`}
                        checked={entry.enabled}
                        onCheckedChange={(checked) =>
                          setDraft((prev) => ({
                            ...prev,
                            [key]: { ...prev[key], enabled: checked === true },
                          }))
                        }
                      />
                      <Label
                        htmlFor={`kpi-enable-${key}`}
                        className="min-w-0 flex-1 truncate text-sm font-normal"
                      >
                        {tRegistry(`${key}.name`)}
                      </Label>
                      <div className="relative w-28">
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={entry.target}
                          disabled={!entry.enabled}
                          aria-label={t('targetAria', { name: tRegistry(`${key}.name`) })}
                          aria-invalid={isInvalid || undefined}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], target: e.target.value },
                            }))
                          }
                          className={cn('h-9 pr-7 text-sm', isInvalid && 'border-destructive')}
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
                          {UNIT_SUFFIX[KPI_REGISTRY[key].unit]}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {invalidKeys.size > 0 && (
                <p className="mt-2 text-xs text-destructive">{t('invalidTarget')}</p>
              )}
              {hiddenCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => setShowAll(true)}
                >
                  {t('showAll', { count: hiddenCount })}
                </Button>
              )}
            </section>

            <div className="flex gap-2.5 rounded-lg border bg-muted/40 p-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium">{t('callout.title')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('callout.description')}</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
