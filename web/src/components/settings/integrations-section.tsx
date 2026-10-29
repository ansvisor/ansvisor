'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BarChart3, Loader2, Search, ShoppingBag, Unplug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  disconnectIntegration,
  getGscBrandMappings,
  setBrandGscProperty,
  getGaBrandMappings,
  setBrandGaProperty,
  type IntegrationProvider,
  type IntegrationStatus,
} from '@/lib/actions/integrations';
import {
  readGaProperties,
  readGscProperties,
  readIntegrationStatus,
  readIntegrationsConfig,
  isTimeout,
  withReadTimeout,
  type IntegrationFailure,
  type IntegrationResult,
} from '@/lib/integrations-client';
import { matchProperty } from '@/lib/property-match';
import { MERCHANT_CENTER_LABEL } from '@/lib/catalog';
import { CatalogSourcesCard, type CatalogSourcesRead } from './catalog-sources-card';
import { CatalogCategoryPages } from './catalog-category-pages';
import { FramerCard } from './framer-card';
import { MerchantCenterAccounts } from './merchant-center-accounts';
import { WebflowCard } from './webflow-card';
import { WordPressCard } from './wordpress-card';
import { useIntegrationConnect } from '@/hooks/use-integration-connect';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';

/**
 * Settings → Integrations (#577, Google Analytics added in #658).
 *
 * Every OAuth provider shares the same lifecycle — not configured (self-host
 * without Composio env) → not connected → connecting (OAuth popup open,
 * polling) → connected — so the card and its state live in one place and each
 * provider only supplies its labels and any post-connection UI of its own.
 *
 * Stores and marketplaces (#1270): Google Merchant Center connects the same
 * way, then each brand picks its account, whose products land in the
 * product catalog card below it. Content management systems: where Send to
 * CMS puts a brand's pages.
 *
 * Every card reads on its own, from the browser or with a timeout, so a slow
 * or failing one never holds up the rest: each says when it couldn't be read.
 */
export function IntegrationsSection() {
  const t = useTranslations('settings');
  // Merchant Center's card shows only where this server offers it (its Composio auth config),
  // as the API's config says: env only, read at once and never behind a status. Until it
  // says so the card isn't there, with no skeleton; a config that can't be read (an older
  // API, or one that is down) offers nothing.
  const [merchantCenterOffered, setMerchantCenterOffered] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void readIntegrationsConfig().then((config) => {
      if (!cancelled) setMerchantCenterOffered(config?.googleMerchantCenter === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // Bumped when a brand adds a Merchant Center account, so the catalog card lists it.
  const [catalogReads, setCatalogReads] = useState(0);
  // The catalog's sources as its card read them, for the picker to mark the accounts added.
  const [catalogSources, setCatalogSources] = useState<CatalogSourcesRead | null>(null);
  // Bumped on each read of a brand's sources after its first (a feed added or synced, a
  // file uploaded, a store connected or removed), so the category pages count their
  // products again. A brand's first read comes with the category pages' own.
  const [categoryReads, setCategoryReads] = useState(0);
  const lastSourcesRead = useRef<CatalogSourcesRead | null>(null);
  const onCatalogSources = useCallback((read: CatalogSourcesRead | null) => {
    setCatalogSources(read);
    const last = lastSourcesRead.current;
    if (!read || read === last) return;
    if (last?.brandId === read.brandId) setCategoryReads((n) => n + 1);
    lastSourcesRead.current = read;
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('integrations')}</CardTitle>
        <CardDescription>{t('integrations_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <IntegrationCard
          provider="google-search-console"
          label="Google Search Console"
          description="Real search queries and impressions for your site — powers prompt suggestions and search-vs-AI insights."
          icon={<Search className="h-5 w-5 text-muted-foreground" />}
          authConfigEnv="COMPOSIO_GSC_AUTH_CONFIG_ID"
        >
          <GscPropertyMapping />
        </IntegrationCard>

        <IntegrationCard
          provider="google-analytics"
          label="Google Analytics"
          description="Sessions and conversions from your GA4 property — the basis for AI traffic history without installing the tracking snippet."
          icon={<BarChart3 className="h-5 w-5 text-muted-foreground" />}
          authConfigEnv="COMPOSIO_GA_AUTH_CONFIG_ID"
        >
          <GaPropertyMapping />
        </IntegrationCard>

        <IntegrationGroup title={t('integrations_stores')}>
          {merchantCenterOffered && (
            <IntegrationCard
              provider="google-merchant-center"
              label={MERCHANT_CENTER_LABEL}
              description={t('merchantCenter.description')}
              icon={<ShoppingBag className="h-5 w-5 text-muted-foreground" />}
              authConfigEnv="COMPOSIO_GMC_AUTH_CONFIG_ID"
            >
              <MerchantCenterAccounts
                sources={catalogSources}
                onConnected={() => setCatalogReads((n) => n + 1)}
              />
            </IntegrationCard>
          )}

          <CatalogSourcesCard refreshKey={catalogReads} onSources={onCatalogSources} />

          <CatalogCategoryPages refreshKey={categoryReads} />
        </IntegrationGroup>

        {/* Send to CMS destinations: a new CMS's card goes in this group. */}
        <IntegrationGroup title={t('integrations_cms')}>
          <WebflowCard />

          <WordPressCard />

          <FramerCard />
        </IntegrationGroup>
      </CardContent>
    </Card>
  );
}

/**
 * A group of integration cards under its heading: a section the heading
 * names, so a screen reader lists the heading and the group by it.
 */
function IntegrationGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h3 id={id} className="pt-2 text-sm font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * One integration row: status badge, Connect / Disconnect, and whatever the
 * provider wants to render once connected (`children`).
 *
 * Its status is read on its own (lib/integrations-client.ts): one that is
 * slow or fails leaves the other cards be, and after its timeout the card
 * says it couldn't check, with Try again in place of the skeleton.
 */
function IntegrationCard({
  provider,
  label,
  description,
  icon,
  authConfigEnv,
  children,
}: {
  provider: IntegrationProvider;
  label: string;
  description: string;
  icon: ReactNode;
  authConfigEnv: string;
  children?: ReactNode;
}) {
  const t = useTranslations('settings');
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  // Why the last read of the status didn't come back, while there's no status.
  const [failure, setFailure] = useState<IntegrationFailure | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const { connecting, connect: handleConnect } = useIntegrationConnect(provider, {
    label,
    callbackUrl: () => `${window.location.origin}/dashboard/settings?tab=integrations`,
    onStatus: setStatus,
  });

  const load = useCallback(async () => {
    setFailure(null);
    const result = await readIntegrationStatus(provider);
    if (result.ok) setStatus(result.value);
    else setFailure(result.reason);
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectIntegration(provider);
      setStatus('not_connected');
      toast.success(`${label} disconnected`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{label}</p>
              {status === 'connected' && (
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                >
                  {t('integrations_connected')}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{description}</p>
          </div>
        </div>

        {status === null && failure ? (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => void load()}>
            {t('integrations_retry')}
          </Button>
        ) : status === null ? (
          <Skeleton className="h-8 w-24" />
        ) : status === 'not_configured' ? (
          <Badge variant="outline" className="text-muted-foreground shrink-0">
            {t('integrations_notConfigured')}
          </Badge>
        ) : status === 'connected' ? (
          <Dialog>
            <DialogTrigger
              render={<Button variant="outline" size="sm" className="gap-2 shrink-0" />}
            >
              <Unplug className="h-3.5 w-3.5" />
              {t('integrations_disconnect')}
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>
                  {t('integrations_disconnect')} {label}
                </DialogTitle>
                <DialogDescription>{t('integrations_disconnectDescription')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  {t('integrations_cancel')}
                </DialogClose>
                <DialogClose
                  render={
                    <Button
                      variant="destructive"
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                    />
                  }
                >
                  {t('integrations_disconnect')}
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Button
            size="sm"
            className="gap-2 shrink-0"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {connecting ? t('integrations_connecting') : t('integrations_connect')}
          </Button>
        )}
      </div>

      {status === null && failure && (
        <p role="status" className="text-xs text-muted-foreground">
          {t(failure === 'timeout' ? 'integrations_statusTimedOut' : 'integrations_statusFailed', {
            label,
          })}
        </p>
      )}

      {status === 'not_configured' && (
        <p className="text-xs text-muted-foreground">
          This server has no Composio credentials for {label}. Set{' '}
          <code className="rounded bg-muted px-1">COMPOSIO_API_KEY</code> and{' '}
          <code className="rounded bg-muted px-1">{authConfigEnv}</code> in the server environment
          to enable it.
        </p>
      )}

      {status === 'connected' && children}
    </div>
  );
}

/**
 * Brand → property mapping (#642, generalised for Analytics in #694).
 *
 * The connection is org-level; each brand picks exactly one property from it.
 * Search Console and Analytics differ only in where a property's site URLs
 * come from — a GSC property *is* a URL, a GA4 property is a numeric id whose
 * URLs live on its web data streams — so both providers render this component
 * and supply their own loaders. Brands whose domain matches exactly one
 * property are premapped automatically; the picker always overrides.
 */
const NONE_VALUE = '__none__';

interface PropertyOption {
  /** Value persisted on the brand row. */
  value: string;
  /** Plain-text label — the trigger renders the selected item's text. */
  label: string;
  /** URLs this property covers, used for the domain auto-match. */
  siteUrls: string[];
}

interface BrandPropertyRow {
  brandId: string;
  brandName: string;
  value: string | null;
  domains: string[];
}

function PropertyMapping({
  sourceName,
  description,
  emptyMessage,
  loadOptions,
  loadRows,
  save,
}: {
  sourceName: string;
  description: string;
  emptyMessage: string;
  loadOptions: () => Promise<IntegrationResult<PropertyOption[]>>;
  loadRows: () => Promise<BrandPropertyRow[]>;
  save: (brandId: string, value: string | null) => Promise<void>;
}) {
  const t = useTranslations('settings');
  const [options, setOptions] = useState<PropertyOption[] | null>(null);
  const [rows, setRows] = useState<BrandPropertyRow[] | null>(null);
  // Why the properties couldn't be read: they took too long, or the API's words.
  const [loadFailed, setLoadFailed] = useState<'timeout' | { message: string } | null>(null);
  const [savingBrandId, setSavingBrandId] = useState<string | null>(null);
  const autoMatched = useRef(false);
  // A read-only workspace (plan not active): picking a property opens the
  // upgrade dialog instead, and nothing is matched by itself.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const load = useCallback(async () => {
    setLoadFailed(null);
    try {
      const [properties, brands] = await Promise.all([loadOptions(), withReadTimeout(loadRows())]);
      if (!properties.ok) {
        setLoadFailed(
          properties.reason === 'timeout'
            ? 'timeout'
            : { message: properties.error ?? 'Failed to load properties' },
        );
        return;
      }
      setOptions(properties.value);
      setRows(brands);
    } catch (err) {
      setLoadFailed(
        isTimeout(err)
          ? 'timeout'
          : { message: err instanceof Error ? err.message : 'Failed to load properties' },
      );
    }
  }, [loadOptions, loadRows]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-match: premap unmapped brands whose domains match exactly one
  // property. Runs once per mount; a failed save (e.g. member role) just
  // leaves the brand unmapped for a manual pick by an admin.
  useEffect(() => {
    if (!options || !rows || autoMatched.current || isLocked) return;
    autoMatched.current = true;
    (async () => {
      for (const row of rows) {
        if (row.value) continue;
        const match = matchProperty(options, row.domains);
        if (!match) continue;
        try {
          await save(row.brandId, match);
          setRows((prev) =>
            (prev ?? []).map((r) => (r.brandId === row.brandId ? { ...r, value: match } : r)),
          );
        } catch (err) {
          console.error(`${sourceName} auto-map failed:`, err);
          return; // likely a permissions error — no point retrying the rest
        }
      }
    })();
  }, [options, rows, save, sourceName, isLocked]);

  const handlePick = async (brandId: string, picked: string) => {
    const value = picked === NONE_VALUE ? null : picked;
    const previous = rows;
    setSavingBrandId(brandId);
    setRows((prev) => (prev ?? []).map((r) => (r.brandId === brandId ? { ...r, value } : r)));
    try {
      await save(brandId, value);
    } catch (err) {
      setRows(previous);
      toast.error(err instanceof Error ? err.message : 'Failed to save property');
    } finally {
      setSavingBrandId(null);
    }
  };

  if (loadFailed) {
    return (
      <div className="rounded-lg border p-4 text-sm">
        <p className="text-muted-foreground">Couldn&apos;t load {sourceName} properties.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {loadFailed === 'timeout' ? t('integrations_propertiesTimedOut') : loadFailed.message}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load}>
          {t('integrations_retry')}
        </Button>
      </div>
    );
  }

  if (!options || !rows) {
    return <Skeleton className="h-24 w-full" />;
  }

  const mappedCount = rows.filter((r) => r.value).length;
  // The trigger renders the *value* unless the Select knows the value → label
  // mapping. Search Console values are the label (a URL), but a GA4 value is a
  // numeric id, which would otherwise show as a bare number once picked.
  const selectItems = [
    { value: NONE_VALUE, label: t('integrations_notMapped') },
    ...options.map((option) => ({ value: option.value, label: option.label })),
  ];

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t('integrations_propertyMapping')}</p>
        <span className="text-xs text-muted-foreground">
          {mappedCount} of {rows.length} brand{rows.length !== 1 ? 's' : ''} mapped
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.brandId} className="flex items-center justify-between gap-3">
            <span className="truncate text-sm">{row.brandName}</span>
            <div className="flex items-center gap-2">
              {savingBrandId === row.brandId && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <Select
                items={selectItems}
                value={row.value ?? null}
                onValueChange={guard(
                  (v: string | null) => void handlePick(row.brandId, v ?? NONE_VALUE),
                  { action: tActions('mapProperties') },
                )}
              >
                <SelectTrigger className="h-8 w-64 text-xs">
                  <SelectValue placeholder={t('integrations_selectProperty')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t('integrations_notMapped')}</SelectItem>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>
      {options.length === 0 && <p className="text-xs text-muted-foreground">{emptyMessage}</p>}
    </div>
  );
}

// Loaders live at module scope so their identity is stable across renders —
// PropertyMapping's effects depend on them.

async function loadGscOptions(): Promise<IntegrationResult<PropertyOption[]>> {
  const result = await readGscProperties();
  if (!result.ok) return result;
  return {
    ok: true,
    value: result.value.map((p) => ({ value: p.siteUrl, label: p.siteUrl, siteUrls: [p.siteUrl] })),
  };
}

async function loadGscRows(): Promise<BrandPropertyRow[]> {
  const mappings = await getGscBrandMappings();
  return mappings.map((m) => ({
    brandId: m.brandId,
    brandName: m.brandName,
    value: m.gscProperty,
    domains: m.domains,
  }));
}

function GscPropertyMapping() {
  return (
    <PropertyMapping
      sourceName="Search Console"
      description="Pick which Search Console property each brand's data comes from. Brands matching a property by domain are mapped automatically."
      emptyMessage="The connected account has no Search Console properties. Add your site in Search Console first, then retry."
      loadOptions={loadGscOptions}
      loadRows={loadGscRows}
      save={setBrandGscProperty}
    />
  );
}

async function loadGaOptions(): Promise<IntegrationResult<PropertyOption[]>> {
  const result = await readGaProperties();
  if (!result.ok) return result;
  return {
    ok: true,
    value: result.value.map((p) => ({
      value: p.propertyId,
      // Display names repeat across accounts ("GA4"), so the id disambiguates.
      label: p.accountName
        ? `${p.displayName} · ${p.accountName} (${p.propertyId})`
        : `${p.displayName} (${p.propertyId})`,
      siteUrls: p.siteUrls,
    })),
  };
}

async function loadGaRows(): Promise<BrandPropertyRow[]> {
  const mappings = await getGaBrandMappings();
  return mappings.map((m) => ({
    brandId: m.brandId,
    brandName: m.brandName,
    value: m.gaPropertyId,
    domains: m.domains,
  }));
}

function GaPropertyMapping() {
  return (
    <PropertyMapping
      sourceName="Analytics"
      description="Pick which GA4 property each brand's data comes from. Brands whose domain matches a property's web data stream are mapped automatically."
      emptyMessage="The connected account has no GA4 properties. Create one in Google Analytics first, then retry."
      loadOptions={loadGaOptions}
      loadRows={loadGaRows}
      save={setBrandGaProperty}
    />
  );
}
