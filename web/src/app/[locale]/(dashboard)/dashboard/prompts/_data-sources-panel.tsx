'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { BarChart3, Check, ExternalLink, Lock, Radar, Search, Sparkles, X } from 'lucide-react';
import {
  getDataForSeoStatus,
  getGaBrandMappings,
  getGscBrandMappings,
  getIntegrationStatus,
  type IntegrationProvider,
} from '@/lib/actions/integrations';

/**
 * What feeds this brand's suggestions, and what could (#659).
 *
 * Suggestions are measurably better when mined from the brand's own data —
 * real Search Console demand and real Analytics behaviour instead of modelled
 * guesses — but the connect flow lives in Settings, where nobody stumbles onto
 * it from here. This is the same flow, surfaced where the benefit is visible.
 *
 * A source only counts as connected when the org is linked AND this brand is
 * mapped to a property. Connected-but-unmapped silently produces nothing, so
 * it gets its own wording rather than a tick.
 */

type SourceState = 'not_configured' | 'not_connected' | 'connected_unmapped' | 'feeding';

interface Source {
  key: string;
  name: string;
  blurb: string;
  /** Official mark under web/public. Falls back to `icon` when absent. */
  logo: string;
  icon: typeof Search;
  iconClass: string;
  state: SourceState;
  /**
   * False for sources the customer does not connect themselves. DataForSEO is
   * our own key — it powers keyword and competition data for everyone on the
   * plan, so it has a state to report but nothing to click.
   */
  connectable: boolean;
}

const SETTINGS_HREF = '/dashboard/settings?tab=integrations';

/** Remembered across visits: a dismissed panel should stay dismissed. */
const DISMISSED_KEY = 'aeo:suggestion-sources-dismissed';

async function resolveState(provider: IntegrationProvider, brandId: string): Promise<SourceState> {
  const status = await getIntegrationStatus(provider);
  if (!status.configured) return 'not_configured';
  if (status.status !== 'connected') return 'not_connected';

  const mappings =
    provider === 'google-search-console'
      ? (await getGscBrandMappings()).map((m) => ({ brandId: m.brandId, mapped: !!m.gscProperty }))
      : (await getGaBrandMappings()).map((m) => ({ brandId: m.brandId, mapped: !!m.gaPropertyId }));

  return mappings.find((m) => m.brandId === brandId)?.mapped ? 'feeding' : 'connected_unmapped';
}

/**
 * The provider's own mark, falling back to a generic icon.
 *
 * Rendered as an <img> against web/public rather than inlined, matching how
 * platform logos already work here — and the fallback means a deployment
 * missing the asset shows a sensible icon instead of a broken image.
 */
function SourceMark({ source }: { source: Source }) {
  const [failed, setFailed] = useState(false);
  const Icon = source.icon;

  if (failed) return <Icon className={`h-4 w-4 shrink-0 ${source.iconClass}`} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source.logo}
      alt=""
      aria-hidden="true"
      className="h-4 w-4 shrink-0 object-contain"
      onError={() => setFailed(true)}
    />
  );
}

export function DataSourcesPanel({ brandId }: { brandId: string }) {
  const [sources, setSources] = useState<Source[] | null>(null);
  // Read during the initial render rather than from an effect: setting it in
  // an effect dismisses on a second pass, so a previously hidden panel flashes
  // into view before disappearing again.
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      resolveState('google-search-console', brandId),
      resolveState('google-analytics', brandId),
      getDataForSeoStatus()
        .then((r) => r.configured)
        .catch(() => false),
    ])
      .then(([gsc, ga, dataForSeo]) => {
        if (cancelled) return;
        setSources([
          {
            key: 'gsc',
            name: 'Google Search Console',
            blurb: 'See query and impression data to find high-opportunity prompts.',
            logo: '/google-search-console.svg',
            icon: Search,
            iconClass: 'text-blue-500',
            state: gsc,
            connectable: true,
          },
          {
            key: 'ga',
            name: 'Google Analytics (GA4)',
            blurb: 'Understand user intent and behaviour to uncover relevant prompts.',
            logo: '/google-analytics.svg',
            icon: BarChart3,
            iconClass: 'text-amber-500',
            state: ga,
            connectable: true,
          },
          {
            key: 'dataforseo',
            name: 'DataForSEO',
            blurb: 'Uncover keyword and SERP data to find content gaps.',
            logo: '/dataforseo.svg',
            icon: Radar,
            iconClass: 'text-violet-500',
            state: dataForSeo ? 'feeding' : 'not_configured',
            connectable: false,
          },
        ]);
      })
      .catch(() => {
        // Best effort: a status failure must never delay or break the
        // suggestions themselves, so the panel simply stays hidden.
        if (!cancelled) setSources([]);
      });

    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Preference just won't persist.
    }
  }, []);

  if (dismissed || sources === null) return null;

  // A source the deployment has no credentials for is dropped rather than
  // shown as unavailable: on a self-host without them there is no flow to
  // complete, and offering one would be a dead end.
  const visible = sources.filter((s) => s.state !== 'not_configured');
  if (visible.length === 0) return null;

  // The panel stays put once everything is connected. It is the standing
  // answer to "what is behind these suggestions", not a prompt to act, and a
  // reader who connected a source last month should still be able to see that
  // it is the one doing the work. Dismissing it is the way to hide it.

  return (
    <div className="relative rounded-lg border bg-muted/20 p-4">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide data sources"
        className="absolute right-3 top-3 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_1fr]">
        <div className="flex gap-3 pr-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </span>
          <div className="space-y-2">
            <p className="text-sm font-medium leading-snug">Enable smarter prompt suggestions</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Connect your data sources to surface the most valuable prompt opportunities.
            </p>
            <Link href={SETTINGS_HREF} className={buttonVariants({ size: 'sm' })}>
              Connect data sources
            </Link>
            <p className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
              <Lock className="h-3 w-3" />
              Your data is secure and never shared.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((source) => (
            <div key={source.key} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
              <div className="flex items-center gap-2">
                <SourceMark source={source} />
                <span className="text-sm font-medium">{source.name}</span>
              </div>
              <p className="flex-1 text-xs text-muted-foreground leading-relaxed">{source.blurb}</p>
              {source.state === 'feeding' ? (
                <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
                  <Check className="h-3.5 w-3.5" />
                  {source.connectable ? 'Connected' : 'Enabled'}
                </span>
              ) : !source.connectable ? null : (
                <Link
                  href={SETTINGS_HREF}
                  className={`${buttonVariants({ variant: 'outline', size: 'sm' })} gap-1.5`}
                >
                  {source.state === 'connected_unmapped' ? 'Map property' : 'Connect'}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
