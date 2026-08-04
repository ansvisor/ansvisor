'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Loader2, Search, Unplug } from 'lucide-react';
import {
  getGscStatus,
  connectGsc,
  disconnectGsc,
  type GscStatus,
} from '@/lib/actions/integrations';

/**
 * Settings → Integrations (#577). One card per integration — only Google
 * Search Console for now; the list layout takes more cards as they land.
 * Card states: not configured (self-host without Composio env) → not
 * connected → connecting (OAuth popup open, polling) → connected.
 */
export function IntegrationsSection() {
  const [status, setStatus] = useState<GscStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollGen = useRef(0);

  const load = useCallback(async () => {
    try {
      const result = await getGscStatus();
      setStatus(result.status);
    } catch (err) {
      console.error('Failed to load integration status:', err);
      toast.error('Failed to load integration status');
      setStatus('not_connected');
    }
  }, []);

  useEffect(() => {
    load();
    // Stop any in-flight poll when the section unmounts.
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
      const { redirectUrl } = await connectGsc(callbackUrl);

      const popup = window.open(redirectUrl, 'gsc-oauth', 'width=560,height=720');
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
          const result = await getGscStatus();
          if (result.status === 'connected') {
            setStatus('connected');
            toast.success('Google Search Console connected');
            popup.close();
            return;
          }
        } catch {
          // transient — keep polling until the deadline
        }
        if (popup.closed) {
          // User closed the window — one final check, then give up quietly.
          const result = await getGscStatus().catch(() => null);
          if (pollGen.current !== gen) return;
          setStatus(result?.status ?? 'not_connected');
          if (result?.status === 'connected') {
            toast.success('Google Search Console connected');
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
      await disconnectGsc();
      setStatus('not_connected');
      toast.success('Google Search Console disconnected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          Connect external data sources. Connections are shared with your whole organization.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Google Search Console</p>
                {status === 'connected' && (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  >
                    Connected
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                Real search queries and impressions for your site — powers upcoming prompt
                suggestions and search-vs-AI insights.
              </p>
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
                  <DialogTitle>Disconnect Google Search Console</DialogTitle>
                  <DialogDescription>
                    The stored connection is removed for the whole organization. You can reconnect
                    at any time.
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
            This server has no Composio credentials configured. Set{' '}
            <code className="rounded bg-muted px-1">COMPOSIO_API_KEY</code> and{' '}
            <code className="rounded bg-muted px-1">COMPOSIO_GSC_AUTH_CONFIG_ID</code> in the server
            environment to enable integrations.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
