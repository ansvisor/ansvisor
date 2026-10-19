'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Code, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/format-relative';
import { useIntegrationConnect } from '@/hooks/use-integration-connect';
import type { IntegrationProvider, SourceState } from '@/lib/actions/integrations';
import type { TrafficSources } from '@/lib/actions/traffic';
import {
  INTEGRATIONS_SETTINGS_PATH,
  googleSourceStatus,
  snippetDetected,
  sourceHost,
} from '@/lib/traffic-sources';

type Tone = 'on' | 'sync' | 'off';

const DOT: Record<Tone, string> = {
  on: 'bg-emerald-500',
  sync: 'bg-amber-500',
  off: 'bg-muted-foreground/30',
};

/** One source: a status dot by the title, a sub-line, and its button. */
function SourceCard({
  tone,
  title,
  line,
  action,
}: {
  tone: Tone;
  title: string;
  line: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 bg-card px-4 py-3">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold" title={title}>
          {title}
        </p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{line}</p>
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/**
 * Google Analytics or Google Search Console: connected with its property and
 * last sync, syncing with how long the first data takes, or a Connect that
 * runs the Settings OAuth flow in a popup, here. Connections stay org-wide.
 */
function GoogleSource({
  provider,
  state,
  domain,
  canConnect,
  onConnected,
}: {
  provider: IntegrationProvider;
  state: SourceState;
  domain: string | undefined;
  canConnect: boolean;
  onConnected: () => void;
}) {
  const t = useTranslations('traffic.sources');
  const tCommon = useTranslations('common');
  const isGa = provider === 'google-analytics';
  const title = isGa ? t('ga') : t('gsc');
  const { connecting, connect } = useIntegrationConnect(provider, {
    label: title,
    callbackUrl: () => window.location.href,
    onStatus: (status) => {
      if (status === 'connected') onConnected();
    },
  });

  const manage = (
    <Link
      href={INTEGRATIONS_SETTINGS_PATH}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-xs')}
    >
      {t('manage')}
    </Link>
  );

  const status = googleSourceStatus(state);
  if (status === 'connected' || status === 'syncing') {
    const host = sourceHost(provider, state.property, domain);
    return (
      <SourceCard
        tone={status === 'connected' ? 'on' : 'sync'}
        title={title}
        line={
          status === 'connected'
            ? t('synced', {
                property: t('property', { host, source: isGa ? 'GA4' : 'GSC' }),
                when: formatRelative(state.lastDataAt, tCommon),
              })
            : isGa
              ? t('syncingGa')
              : t('syncingGsc')
        }
        action={manage}
      />
    );
  }
  if (status === 'unmapped') {
    return <SourceCard tone="off" title={title} line={t('unmapped')} action={manage} />;
  }
  if (status === 'not_configured') {
    return <SourceCard tone="off" title={title} line={t('notConfigured')} />;
  }
  return (
    <SourceCard
      tone="off"
      title={title}
      line={isGa ? t('notConnectedGa') : t('notConnectedGsc')}
      action={
        // A span carries the tooltip: a disabled button gets no hover.
        <span title={canConnect ? undefined : t('connectNotAllowed')}>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={!canConnect || connecting}
            onClick={() => void connect()}
          >
            {connecting && <Loader2 className="h-3 w-3 animate-spin" />}
            {connecting ? t('connecting') : t('connect')}
          </Button>
        </span>
      }
    />
  );
}

/**
 * The data sources strip (AT-001): what feeds the page — the tracking
 * snippet, Google Analytics, Google Search Console and AI bots — and what's
 * missing, with a way to connect it without leaving the page (fixes F8).
 * The snippet's code moves behind its Code button once it sends visits
 * (F3). AI bots come with phase 3 (AT-010), so that card says so for now.
 */
export function SourcesStrip({
  sources,
  domain,
  hasTrackingCode,
  canConnect,
  onShowCode,
  onConnected,
}: {
  /** Null while loading. */
  sources: TrafficSources | null;
  /** The brand's primary domain, for the GA4 property line. */
  domain: string | undefined;
  hasTrackingCode: boolean;
  canConnect: boolean;
  onShowCode: () => void;
  onConnected: () => void;
}) {
  const t = useTranslations('traffic.sources');
  const tCommon = useTranslations('common');

  if (!sources) {
    return <Skeleton className="h-[62px] w-full rounded-xl" />;
  }

  const detected = snippetDetected(sources.snippetLastVisitAt);
  return (
    <section
      aria-label={t('label')}
      // The 1px gaps over the border colour draw the lines between cards, in
      // one row of four on a wide screen and two by two below it.
      className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 min-[75rem]:grid-cols-4"
    >
      <SourceCard
        tone={detected ? 'on' : 'off'}
        title={t('snippet')}
        line={
          detected
            ? t('snippetActive', { when: formatRelative(sources.snippetLastVisitAt, tCommon) })
            : t('snippetNotDetected')
        }
        action={
          hasTrackingCode ? (
            <Button
              variant={detected ? 'outline' : 'default'}
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={onShowCode}
            >
              <Code className="h-3 w-3" />
              {detected ? t('code') : t('install')}
            </Button>
          ) : undefined
        }
      />
      <GoogleSource
        provider="google-analytics"
        state={sources.ga}
        domain={domain}
        canConnect={canConnect}
        onConnected={onConnected}
      />
      <GoogleSource
        provider="google-search-console"
        state={sources.gsc}
        domain={domain}
        canConnect={canConnect}
        onConnected={onConnected}
      />
      <SourceCard tone="off" title={t('bots')} line={t('botsSoon')} />
    </section>
  );
}
