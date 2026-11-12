'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowLeftRight, Check, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Settings › MCP & API Keys › Connected apps (MCP over OAuth, #2141; the
 * approved mockup's screens 7 to 9): the AI apps the person connected by
 * signing in, each with what it may do, and Disconnect. Hidden while MCP over
 * OAuth is off (the list answers 404), so it tells the section whether app
 * sign-in is on (onAvailable).
 */

interface ConnectedApp {
  id: string;
  name: string | null;
  host: string;
  recognised: boolean;
  loopback: boolean;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
}

type Access = 'ok' | 'trial' | 'ended' | 'no_workspace';

interface Loaded {
  connections: ConnectedApp[];
  access: Access;
  isAdmin: boolean;
}

function Tile({ app }: { app: ConnectedApp }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
        app.recognised
          ? 'bg-[#efe9df] text-[#3d2f22] dark:bg-white/10 dark:text-foreground'
          : 'border border-dashed bg-muted text-muted-foreground',
      )}
    >
      {(app.name?.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'plain'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tone === 'ok' &&
          'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
        tone === 'warn' &&
          'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
        tone === 'plain' && 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

export function ConnectedAppsCard({
  endpoint,
  onAvailable,
}: {
  /** The MCP endpoint's address, for the empty state. */
  endpoint: string;
  /** Called once the list answers: true while app sign-in is on. */
  onAvailable?: (available: boolean) => void;
}) {
  const t = useTranslations('settings.connectedApps');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [hidden, setHidden] = useState(false);
  const [confirm, setConfirm] = useState<ConnectedApp | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/oauth/connections');
      const body = (await res.json().catch(() => null)) as Partial<Loaded> | null;
      if (!res.ok || !body || !Array.isArray(body.connections)) {
        setHidden(true);
        onAvailable?.(false);
        return;
      }
      setLoaded({
        connections: body.connections,
        access: body.access ?? 'ok',
        isAdmin: !!body.isAdmin,
      });
      onAvailable?.(true);
    } catch {
      setHidden(true);
      onAvailable?.(false);
    }
  }, [onAvailable]);

  useEffect(() => {
    void load();
  }, [load]);

  const appName = (app: ConnectedApp) => app.name ?? t('anApp');

  const disconnect = async (app: ConnectedApp) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/oauth/connections/${app.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(t('disconnectFailed'));
      toast.success(t('disconnected', { app: appName(app) }));
      setConfirm(null);
      await load();
    } catch {
      toast.error(t('disconnectFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;

  return (
    <Card data-slot="connected-apps">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!loaded ? (
          <Skeleton className="h-14 w-full" />
        ) : loaded.connections.length === 0 ? (
          <p className="rounded-md border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            {t('empty')}
            <br />
            {t.rich('emptyHint', {
              url: endpoint,
              b: (chunks) => <b className="font-medium text-foreground">{chunks}</b>,
            })}
          </p>
        ) : (
          <>
            <div className="divide-y rounded-md border bg-card">
              {loaded.connections.map((app) => (
                <div key={app.id} className="flex flex-wrap items-center gap-3 p-3">
                  <Tile app={app} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{appName(app)}</span>
                      {app.recognised ? (
                        <Pill tone="ok">
                          <Check className="h-3 w-3" />
                          {t('recognised')}
                        </Pill>
                      ) : (
                        <Pill tone="warn">
                          <AlertTriangle className="h-3 w-3" />
                          {t('unchecked')}
                        </Pill>
                      )}
                      <Pill tone="plain">
                        {app.scopes.includes('mcp:write') ? t('readWrite') : t('readOnly')}
                      </Pill>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[
                        app.loopback
                          ? t('viaComputer', { host: app.host })
                          : t('via', { host: app.host }),
                        t('connected', { date: formatDate(app.created_at) }),
                        app.last_used_at
                          ? t('lastUsed', { date: formatDate(app.last_used_at) })
                          : t('notUsed'),
                      ].join(' · ')}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setConfirm(app)}>
                    {t('disconnect')}
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t('idleNote')}</p>
          </>
        )}

        {loaded && loaded.access !== 'ok' && loaded.access !== 'no_workspace' && (
          <div
            data-slot="connected-apps-plan"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300"
          >
            <p>
              {loaded.access === 'trial' ? t('trialNote') : t('endedNote')}
              {!loaded.isAdmin && <> {t('askAdmin')}</>}
            </p>
            {loaded.isAdmin && (
              <Link
                href="/dashboard/settings/billing"
                className={buttonVariants({ size: 'sm', className: 'shrink-0' })}
              >
                {t('choosePlan')}
              </Link>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirm && t('disconnectTitle', { app: appName(confirm) })}</DialogTitle>
            <DialogDescription>
              {confirm && t('disconnectBody', { app: appName(confirm) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>
              {t('cancel')}
            </DialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => confirm && void disconnect(confirm)}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('disconnect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
