'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Package, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserRole } from '@/hooks/use-user-role';
import { addFeedSource, listCatalogSources, removeCatalogSource } from '@/lib/actions/catalog';
import type { CatalogSource } from '@/lib/catalog';
import { syncCatalogSource, uploadCatalogFile, type CatalogSyncResult } from '@/lib/catalog-client';
import { useBrandStore } from '@/stores/use-brand-store';

/**
 * Product catalog (#1263): where the active brand's catalog comes from, a
 * product feed URL read daily, or a CSV / feed file uploaded. Admins and
 * managers add, sync and remove; members see the sources and how they went.
 */
export function CatalogSourcesCard() {
  const t = useTranslations('settings.catalog');
  const format = useFormatter();
  const { activeBrandId, brands } = useBrandStore();
  const { canManage } = useUserRole();
  const brand = brands.find((b) => b.id === activeBrandId) ?? null;

  // The sources as read for a brand, and when ("synced 3 hours ago"): another
  // brand's never show.
  const [loaded, setLoaded] = useState<{
    brandId: string;
    sources: CatalogSource[] | null;
    at: Date;
  } | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Bumped to read the sources again, after a sync, an add or a removal.
  const [reads, setReads] = useState(0);
  const load = useCallback(() => setReads((n) => n + 1), []);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    listCatalogSources(activeBrandId).then(
      (sources) => {
        if (!cancelled) setLoaded({ brandId: activeBrandId, sources, at: new Date() });
      },
      (err) => {
        console.error('Failed to read the catalog sources:', err);
        if (!cancelled) setLoaded({ brandId: activeBrandId, sources: null, at: new Date() });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, reads]);

  const current = loaded?.brandId === activeBrandId ? loaded : null;
  const sources = current?.sources ?? null;
  const failed = current !== null && current.sources === null;
  const now = current?.at ?? new Date();

  /** Says how a sync went, then reads the sources again. */
  const report = (result: CatalogSyncResult) => {
    if (!result.ok) toast.error(t(`errors.${result.code}`));
    else if (result.status === 'ok') {
      toast.success(t('synced', { count: result.counts?.items ?? 0 }));
    } else toast.error(result.error ?? t('errors.failed'));
    load();
  };

  const add = async () => {
    if (!activeBrandId) return;
    setBusy('add');
    const added = await addFeedSource(activeBrandId, url);
    if (!added.ok) {
      toast.error(t(`errors.${added.code}`));
      setBusy(null);
      return;
    }
    setUrl('');
    // Read it now, so the person sees whether it's a feed.
    report(await syncCatalogSource(added.id));
    setBusy(null);
  };

  const sync = async (id: string) => {
    setBusy(id);
    report(await syncCatalogSource(id));
    setBusy(null);
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('removeConfirm'))) return;
    setBusy(id);
    try {
      await removeCatalogSource(id);
      load();
    } catch {
      toast.error(t('errors.forbidden'));
    }
    setBusy(null);
  };

  const upload = async (file: File | undefined) => {
    if (!file || !activeBrandId) return;
    setBusy('upload');
    report(await uploadCatalogFile(activeBrandId, file));
    setBusy(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Package className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="font-medium">{t('title')}</p>
          <p className="text-sm text-muted-foreground">
            {brand ? t('description', { brand: brand.name }) : t('noBrand')}
          </p>
        </div>
      </div>

      {activeBrandId &&
        (failed ? (
          <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
        ) : sources === null ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {sources.map((source) => (
                  <li key={source.id} className="space-y-1 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className="min-w-0 truncate font-medium"
                        title={source.url ?? undefined}
                      >
                        {source.kind === 'feed_url' ? source.url : t('upload')}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge variant={source.lastStatus === 'ok' ? 'secondary' : 'outline'}>
                          {source.lastStatus ? t(`status.${source.lastStatus}`) : t('status.never')}
                        </Badge>
                        {canManage && source.kind === 'feed_url' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() => sync(source.id)}
                            aria-label={t('syncNow')}
                          >
                            {busy === source.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        {canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() => remove(source.id)}
                            aria-label={t('remove')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('products', { count: source.products })}
                      {source.lastSyncedAt &&
                        ` · ${t('lastSync', { when: format.relativeTime(new Date(source.lastSyncedAt), now) })}`}
                    </p>
                    {source.lastStatus !== 'ok' && source.lastError && (
                      <p className="text-xs text-destructive">{source.lastError}</p>
                    )}
                    {source.lastStatus === 'ok' && (source.lastCounts?.skipped ?? 0) > 0 && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          {t('skipped', { count: source.lastCounts!.skipped })}
                        </summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {source.lastCounts!.errors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canManage ? (
              <div className="space-y-2">
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void add();
                  }}
                >
                  <Input
                    type="url"
                    inputMode="url"
                    placeholder={t('urlPlaceholder')}
                    aria-label={t('urlLabel')}
                    value={url}
                    maxLength={2048}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <Button type="submit" disabled={!url.trim() || busy !== null}>
                    {busy === 'add' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('addFeed')}
                  </Button>
                </form>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".csv,.tsv,.txt,.xml,text/csv,text/plain,application/xml,text/xml"
                    className="hidden"
                    onChange={(e) => void upload(e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => fileInput.current?.click()}
                  >
                    {busy === 'upload' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {t('uploadFile')}
                  </Button>
                  <span className="text-xs text-muted-foreground">{t('uploadHint')}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t('managersOnly')}</p>
            )}
          </>
        ))}
    </div>
  );
}
