'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { BarChart3, Loader2, Search, Unplug } from 'lucide-react';
import {
  getIntegrationStatus,
  connectIntegration,
  disconnectIntegration,
  getGscProperties,
  getGscBrandMappings,
  setBrandGscProperty,
  type IntegrationProvider,
  type IntegrationStatus,
  type GscProperty,
  type GscBrandMapping,
} from '@/lib/actions/integrations';
import { matchGscProperty } from '@/lib/gsc';

/**
 * Settings → Integrations (#577, Google Analytics added in #658).
 *
 * Every OAuth provider shares the same lifecycle — not configured (self-host
 * without Composio env) → not connected → connecting (OAuth popup open,
 * polling) → connected — so the card and its state live in one place and each
 * provider only supplies its labels and any post-connection UI of its own.
 */
export function IntegrationsSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          Connect external data sources. Connections are shared with your whole organization.
        </CardDescription>
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
        />
      </CardContent>
    </Card>
  );
}

/**
 * One integration row: status badge, Connect / Disconnect, and whatever the
 * provider wants to render once connected (`children`).
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
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollGen = useRef(0);

  const load = useCallback(async () => {
    try {
      const result = await getIntegrationStatus(provider);
      setStatus(result.status);
    } catch (err) {
      console.error(`Failed to load ${provider} status:`, err);
      toast.error('Failed to load integration status');
      setStatus('not_connected');
    }
  }, [provider]);

  useEffect(() => {
    load();
    // Stop any in-flight poll when the card unmounts.
    const gen = pollGen.current;
    return () => {
      if (pollGen.current === gen) pollGen.current++;
    };
  }, [load]);

  const handleConnect = async () => {
    setConnecting(true);
    const gen = ++pollGen.current;
    try {
      const callbackUrl = `${window.location.origin}/dashboard/settings?tab=integrations`;
      const { redirectUrl } = await connectIntegration(provider, callbackUrl);

      const popup = window.open(redirectUrl, `${provider}-oauth`, 'width=560,height=720');
      if (!popup) {
        // Popup blocked — same-tab fallback; status resolves on return.
        window.location.href = redirectUrl;
        return;
      }

      // Poll until Composio reports the account ACTIVE (or ~2 min pass).
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && pollGen.current === gen) {
        await new Promise((r) => setTimeout(r, 3000));
        if (pollGen.current !== gen) return;
        try {
          const result = await getIntegrationStatus(provider);
          if (result.status === 'connected') {
            setStatus('connected');
            toast.success(`${label} connected`);
            popup.close();
            return;
          }
        } catch {
          // transient — keep polling until the deadline
        }
        if (popup.closed) {
          // User closed the window — one final check, then give up quietly.
          const result = await getIntegrationStatus(provider).catch(() => null);
          if (pollGen.current !== gen) return;
          setStatus(result?.status ?? 'not_connected');
          if (result?.status === 'connected') {
            toast.success(`${label} connected`);
          }
          return;
        }
      }
      if (pollGen.current === gen) {
        toast.error('Connection timed out — try again.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start connection');
    } finally {
      if (pollGen.current === gen) setConnecting(false);
    }
  };

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
                  Connected
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{description}</p>
          </div>
        </div>

        {status === null ? (
          <Skeleton className="h-8 w-24" />
        ) : status === 'not_configured' ? (
          <Badge variant="outline" className="text-muted-foreground shrink-0">
            Not configured
          </Badge>
        ) : status === 'connected' ? (
          <Dialog>
            <DialogTrigger
              render={<Button variant="outline" size="sm" className="gap-2 shrink-0" />}
            >
              <Unplug className="h-3.5 w-3.5" />
              Disconnect
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Disconnect {label}</DialogTitle>
                <DialogDescription>
                  The stored connection is removed for the whole organization. You can reconnect at
                  any time.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <DialogClose
                  render={
                    <Button
                      variant="destructive"
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                    />
                  }
                >
                  Disconnect
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
            {connecting ? 'Connecting…' : 'Connect'}
          </Button>
        )}
      </div>

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
 * Brand → property mapping (#642). The connection is org-level; each brand
 * picks exactly one Search Console property. Brands whose domain matches a
 * property unambiguously are premapped automatically.
 */
const NONE_VALUE = '__none__';

function GscPropertyMapping() {
  const [properties, setProperties] = useState<GscProperty[] | null>(null);
  const [mappings, setMappings] = useState<GscBrandMapping[] | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [savingBrandId, setSavingBrandId] = useState<string | null>(null);
  const autoMatched = useRef(false);

  const load = useCallback(async () => {
    setLoadFailed(null);
    try {
      const [props, brands] = await Promise.all([getGscProperties(), getGscBrandMappings()]);
      setProperties(props);
      setMappings(brands);
    } catch (err) {
      setLoadFailed(err instanceof Error ? err.message : 'Failed to load properties');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-match: premap unmapped brands whose domains match exactly one
  // property. Runs once per mount; a failed save (e.g. member role) just
  // leaves the brand unmapped for a manual pick by an admin.
  useEffect(() => {
    if (!properties || !mappings || autoMatched.current) return;
    autoMatched.current = true;
    const propertyUrls = properties.map((p) => p.siteUrl);
    (async () => {
      for (const m of mappings) {
        if (m.gscProperty) continue;
        const match = matchGscProperty(propertyUrls, m.domains);
        if (!match) continue;
        try {
          await setBrandGscProperty(m.brandId, match);
          setMappings((prev) =>
            (prev ?? []).map((row) =>
              row.brandId === m.brandId ? { ...row, gscProperty: match } : row,
            ),
          );
        } catch (err) {
          console.error('GSC auto-map failed:', err);
          return; // likely a permissions error — no point retrying the rest
        }
      }
    })();
  }, [properties, mappings]);

  const handlePick = async (brandId: string, value: string) => {
    const property = value === NONE_VALUE ? null : value;
    const previous = mappings;
    setSavingBrandId(brandId);
    setMappings((prev) =>
      (prev ?? []).map((row) =>
        row.brandId === brandId ? { ...row, gscProperty: property } : row,
      ),
    );
    try {
      await setBrandGscProperty(brandId, property);
    } catch (err) {
      setMappings(previous);
      toast.error(err instanceof Error ? err.message : 'Failed to save property');
    } finally {
      setSavingBrandId(null);
    }
  };

  if (loadFailed) {
    return (
      <div className="rounded-lg border p-4 text-sm">
        <p className="text-muted-foreground">Couldn&apos;t load Search Console properties.</p>
        <p className="mt-1 text-xs text-muted-foreground">{loadFailed}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  if (!properties || !mappings) {
    return <Skeleton className="h-24 w-full" />;
  }

  const mappedCount = mappings.filter((m) => m.gscProperty).length;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Property mapping</p>
        <span className="text-xs text-muted-foreground">
          {mappedCount} of {mappings.length} brand{mappings.length !== 1 ? 's' : ''} mapped
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Pick which Search Console property each brand&apos;s data comes from. Brands matching a
        property by domain are mapped automatically.
      </p>
      <div className="space-y-2">
        {mappings.map((m) => (
          <div key={m.brandId} className="flex items-center justify-between gap-3">
            <span className="truncate text-sm">{m.brandName}</span>
            <div className="flex items-center gap-2">
              {savingBrandId === m.brandId && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <Select
                value={m.gscProperty ?? null}
                onValueChange={(v) => handlePick(m.brandId, v ?? NONE_VALUE)}
              >
                <SelectTrigger className="h-8 w-64 text-xs">
                  <SelectValue placeholder="Select a property" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>Not mapped</SelectItem>
                  {properties.map((p) => (
                    <SelectItem key={p.siteUrl} value={p.siteUrl}>
                      {p.siteUrl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>
      {properties.length === 0 && (
        <p className="text-xs text-muted-foreground">
          The connected account has no Search Console properties. Add your site in Search Console
          first, then retry.
        </p>
      )}
    </div>
  );
}
