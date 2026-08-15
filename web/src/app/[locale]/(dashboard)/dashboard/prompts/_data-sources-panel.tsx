'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { BarChart3, Check, ExternalLink, Lock, Search, Sparkles, X } from 'lucide-react';
import {
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
  icon: typeof Search;
  iconClass: string;
  state: SourceState;
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
    ])
      .then(([gsc, ga]) => {
        if (cancelled) return;
        setSources([
          {
            key: 'gsc',
            name: 'Google Search Console',
            blurb: 'See query and impression data to find high-opportunity prompts.',
            icon: Search,
            iconClass: 'text-blue-500',
            state: gsc,
          },
          {
            key: 'ga',
            name: 'Google Analytics (GA4)',
            blurb: 'Understand user intent and behaviour to uncover relevant prompts.',
            icon: BarChart3,
            iconClass: 'text-amber-500',
            state: ga,
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

  // Nothing to advertise: a self-host without Composio credentials cannot
  // complete either flow, so offering it would be a dead end.
  const offerable = sources.filter((s) => s.state !== 'not_configured');
  if (offerable.length === 0) return null;

  // Everything already feeding — the suggestion rows carry their own source
  // badges, so a panel repeating that is noise.
  if (offerable.every((s) => s.state === 'feeding')) return null;

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

        <div className="grid gap-3 sm:grid-cols-2">
          {offerable.map((source) => {
            const Icon = source.icon;
            return (
              <div key={source.key} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 shrink-0 ${source.iconClass}`} />
                  <span className="text-sm font-medium">{source.name}</span>
                </div>
                <p className="flex-1 text-xs text-muted-foreground leading-relaxed">
                  {source.blurb}
                </p>
                {source.state === 'feeding' ? (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
                    <Check className="h-3.5 w-3.5" />
                    Connected
                  </span>
                ) : (
                  <Link
                    href={SETTINGS_HREF}
                    className={`${buttonVariants({ variant: 'outline', size: 'sm' })} gap-1.5`}
                  >
                    {source.state === 'connected_unmapped' ? 'Map property' : 'Connect'}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
