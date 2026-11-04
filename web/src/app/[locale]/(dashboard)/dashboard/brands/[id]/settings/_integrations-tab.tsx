'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3, Loader2, Plus, Search, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUserRole } from '@/hooks/use-user-role';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { useBrandStore } from '@/stores/use-brand-store';
import { setBrandGaProperty, setBrandGscProperty } from '@/lib/actions/integrations';
import { formatDate } from '@/lib/format';
import {
  activateBrandSignIn,
  chooseBrandSignIn,
  disconnectBrandSignIn,
  readBrandGaProperties,
  readBrandGoogle,
  readBrandGscProperties,
  startBrandConnect,
  type BrandGoogleProduct,
  type BrandGoogleProvider,
  type BrandSignIn,
} from '@/lib/integrations-client';
import type { Brand } from '@/types';

const LABELS: Record<BrandGoogleProvider, string> = {
  'google-search-console': 'Google Search Console',
  'google-analytics': 'Google Analytics',
};

/** How long a brand's own login waits for Composio to report it active. */
const CONNECT_DEADLINE_MS = 120_000;
const CONNECT_POLL_MS = 3000;

/**
 * Brand settings › Integrations (BRAND-ACCESS §3.3, PR 15): the brand's own
 * Google sign-ins. Each card says which Google account the brand uses (the
 * workspace's, or one of its own), lets an admin or manager use the same
 * account as another brand (D6), connect another Google account or
 * disconnect, and picks the brand's property from that account. The CMS,
 * catalog and AI traffic cards stay in Settings › Integrations, per brand
 * as before.
 */
export function IntegrationsTab({ brand }: { brand: Brand }) {
  const t = useTranslations('brands.settings.integrations');
  const [products, setProducts] = useState<BrandGoogleProduct[] | null | 'failed'>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    void readBrandGoogle(brand.id).then((read) => {
      if (live) setProducts(read.ok ? read.value : 'failed');
    });
    return () => {
      live = false;
    };
  }, [brand.id, version]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {products === null ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : products === 'failed' ? (
          <div role="status" className="space-y-2 text-sm text-muted-foreground">
            <p>{t('loadError')}</p>
            <Button size="sm" variant="outline" onClick={reload}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          products.map((product) => (
            <GoogleCard key={product.provider} brand={brand} product={product} onChanged={reload} />
          ))
        )}
        <p className="text-xs text-muted-foreground">{t('otherIntegrations')}</p>
      </CardContent>
    </Card>
  );
}

function GoogleCard({
  brand,
  product,
  onChanged,
}: {
  brand: Brand;
  product: BrandGoogleProduct;
  onChanged: () => void;
}) {
  const t = useTranslations('brands.settings.integrations');
  const { canManage } = useUserRole();
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const { brands } = useBrandStore();
  const [busy, setBusy] = useState<'use' | 'connect' | 'disconnect' | null>(null);
  const pollGen = useRef(0);
  const label = LABELS[product.provider];
  const current = product.current;
  const writable = canManage && !brand.isDemo && product.configured;

  useEffect(() => {
    const gens = pollGen;
    return () => {
      gens.current++;
    };
  }, []);

  const brandNames = (ids: string[]) =>
    ids
      .filter((id) => id !== brand.id)
      .map((id) => brands.find((b) => b.id === id)?.name)
      .filter((name): name is string => Boolean(name));

  const signInName = (signIn: BrandSignIn & { brandIds?: string[] }) => {
    if (signIn.label) return signIn.label;
    if (signIn.accountLevel) return t('workspaceAccount');
    const names = brandNames(signIn.brandIds ?? []);
    return names.length ? t('sameAs', { brands: names.join(', ') }) : t('ownAccount');
  };

  const others = product.usable.filter((u) => u.accountId !== current?.accountId);
  const sharedWith = brandNames(
    product.usable.find((u) => u.accountId === current?.accountId)?.brandIds ?? [],
  );

  async function use(accountId: string) {
    setBusy('use');
    const result = await chooseBrandSignIn(product.provider, brand.id, accountId);
    setBusy(null);
    if (!result.ok) {
      if (result.reason === 'subscription') openUpgrade();
      else toast.error(result.error ?? t('failed'));
      return;
    }
    toast.success(t('switched', { label }));
    onChanged();
  }

  async function connect() {
    setBusy('connect');
    const gen = ++pollGen.current;
    try {
      const started = await startBrandConnect(
        product.provider,
        brand.id,
        `${window.location.origin}${window.location.pathname}?tab=integrations`,
      );
      if (!started.ok) {
        if (started.reason === 'subscription') openUpgrade();
        else toast.error(started.error ?? t('failed'));
        return;
      }
      const popup = window.open(
        started.value.redirectUrl,
        `${product.provider}-brand-oauth`,
        'width=560,height=720',
      );
      if (!popup) {
        window.location.href = started.value.redirectUrl;
        return;
      }
      const deadline = Date.now() + CONNECT_DEADLINE_MS;
      while (Date.now() < deadline && pollGen.current === gen) {
        await new Promise((r) => setTimeout(r, CONNECT_POLL_MS));
        if (pollGen.current !== gen) return;
        const done = await activateBrandSignIn(product.provider, brand.id, started.value.accountId);
        if (done.ok && done.value === 'connected') {
          popup.close();
          toast.success(t('connected', { label }));
          onChanged();
          return;
        }
        if (popup.closed) break;
      }
      if (pollGen.current === gen) toast.error(t('connectUnfinished'));
    } finally {
      if (pollGen.current === gen) setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    const result = await disconnectBrandSignIn(product.provider, brand.id);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error ?? t('failed'));
      return;
    }
    toast.success(t('disconnected', { label }));
    onChanged();
  }

  const Icon = product.provider === 'google-analytics' ? BarChart3 : Search;
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label={label}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{label}</h3>
            {!product.configured ? (
              <Badge variant="outline">{t('notSetUp')}</Badge>
            ) : current?.connected ? (
              <Badge variant="secondary">{t('statusConnected')}</Badge>
            ) : (
              <Badge variant="outline">{t('statusNotConnected')}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {!current
              ? t('none')
              : current.connected
                ? t('uses', { account: signInName(current) })
                : t('needsReconnect')}
          </p>
          {current?.connected && !current.accountLevel && current.connectedAt && (
            <p className="text-xs text-muted-foreground">
              {t('connectedOn', { date: formatDate(current.connectedAt) })}
            </p>
          )}
          {current?.connected && sharedWith.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('alsoUsedBy', { brands: sharedWith.join(', ') })}
            </p>
          )}
        </div>
      </div>

      {writable && (
        <div className="flex flex-wrap items-center gap-2">
          {others.length > 0 && (
            <Select
              items={others.map((o) => ({ value: o.accountId ?? '', label: signInName(o) }))}
              value={null}
              onValueChange={guard((v: string | null) => v && void use(v), {
                action: tActions('connectIntegrations'),
              })}
              disabled={busy !== null}
            >
              <SelectTrigger size="sm" className="w-64" aria-label={t('useSameLabel')}>
                {busy === 'use' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <SelectValue placeholder={t('useSame')} />
                )}
              </SelectTrigger>
              <SelectContent>
                {others.map((o) => (
                  <SelectItem key={o.accountId} value={o.accountId ?? ''}>
                    {signInName(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={guard(connect, { action: tActions('connectIntegrations') })}
          >
            {busy === 'connect' ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-3.5 w-3.5" />
            )}
            {t(current ? 'connectAnother' : 'connect')}
          </Button>
          {current && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={disconnect}
              className="text-muted-foreground"
            >
              {busy === 'disconnect' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unplug className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t('disconnect')}
            </Button>
          )}
        </div>
      )}

      {current?.connected && (
        <PropertyPicker
          brand={brand}
          provider={product.provider}
          value={product.property}
          writable={canManage && !brand.isDemo}
          onSaved={onChanged}
        />
      )}
    </section>
  );
}

/** The brand's property, from the properties of the sign-in it uses. */
function PropertyPicker({
  brand,
  provider,
  value,
  writable,
  onSaved,
}: {
  brand: Brand;
  provider: BrandGoogleProvider;
  value: string | null;
  writable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations('brands.settings.integrations');
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const isGa = provider === 'google-analytics';
  const [options, setOptions] = useState<{ value: string; label: string }[] | null | 'failed'>(
    null,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    const read = isGa
      ? readBrandGaProperties(brand.id).then((r) =>
          r.ok
            ? r.value.map((p) => ({
                value: p.propertyId,
                label: `${p.displayName} (${p.propertyId})`,
              }))
            : 'failed',
        )
      : readBrandGscProperties(brand.id).then((r) =>
          r.ok ? r.value.map((p) => ({ value: p.siteUrl, label: p.siteUrl })) : 'failed',
        );
    void read.then((o) => live && setOptions(o as typeof options));
    return () => {
      live = false;
    };
  }, [brand.id, isGa]);

  async function save(next: string | null) {
    setSaving(true);
    try {
      if (isGa) await setBrandGaProperty(brand.id, next);
      else await setBrandGscProperty(brand.id, next);
      toast.success(t('propertySaved'));
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('failed'));
    } finally {
      setSaving(false);
    }
  }

  const items =
    options && options !== 'failed'
      ? value && !options.some((o) => o.value === value)
        ? [{ value, label: value }, ...options]
        : options
      : value
        ? [{ value, label: value }]
        : [];

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
      <span className="text-muted-foreground">{t(isGa ? 'gaProperty' : 'gscProperty')}</span>
      {options === null ? (
        <Skeleton className="h-8 w-64" />
      ) : (
        <Select
          items={items}
          value={value}
          onValueChange={guard((v: string | null) => void save(v), {
            action: tActions('connectIntegrations'),
          })}
          disabled={!writable || saving || items.length === 0}
        >
          <SelectTrigger
            size="sm"
            className="w-72"
            aria-label={t(isGa ? 'gaProperty' : 'gscProperty')}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SelectValue placeholder={t('pickProperty')} />
            )}
          </SelectTrigger>
          <SelectContent>
            {items.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {options === 'failed' && (
        <span className="text-xs text-muted-foreground">{t('propertiesFailed')}</span>
      )}
    </div>
  );
}
